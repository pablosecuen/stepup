// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceSeriesDeletion.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceRule } from '../../types/index.ts';
import { generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { buildDeletedCalendarLessonMutation } from '../calendarRecurrenceMutations.ts';
import { buildDeleteRecurrenceSeriesFromLesson, removeFutureUncompletedMaterializations, sanitizeMaterializationsByRuleBounds, truncateStudentRecurrencesFromDate } from '../calendarRecurrenceSplit.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const timezone = 'America/Argentina/Buenos_Aires';

// Semanal, sábado 10:00, arranca el lunes 2026-07-06. La ocurrencia del
// sábado 2026-07-18 es la que el docente cancela y desde la que pide
// "eliminar esta y todas las siguientes".
const weeklyRule: RecurrenceRule = {
  recurrenceId: 'weekly-1',
  studentId: 'student-1',
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 5, hour: 10, minute: 0, durationMinutes: 60 }] }],
  modality: 'presencial',
  timezone,
  startDate: '2026-07-06',
  endDate: null,
  status: 'active',
};

// Segunda regla activa y concurrente del mismo alumno (TeacherFlow modela
// una sola serie futura por alumno; ambas deben cortarse juntas).
const concurrentRule: RecurrenceRule = {
  ...weeklyRule,
  recurrenceId: 'weekly-2',
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 16, minute: 0, durationMinutes: 45 }] }],
};

// Regla del mismo alumno que todavía no arrancó cuando se pide el corte.
const notStartedRule: RecurrenceRule = {
  ...weeklyRule,
  recurrenceId: 'weekly-not-started',
  startDate: '2026-08-03',
};

// Regla ya finalizada por estado antes del corte: no debe tocarse.
const alreadyEndedRule: RecurrenceRule = {
  ...weeklyRule,
  recurrenceId: 'weekly-ended',
  status: 'ended',
};

// Regla ya vencida por fecha antes del corte: no debe tocarse.
const expiredRule: RecurrenceRule = {
  ...weeklyRule,
  recurrenceId: 'weekly-expired',
  endDate: '2026-07-01',
};

// Regla de otro alumno: nunca debe modificarse.
const otherStudentRule: RecurrenceRule = {
  ...weeklyRule,
  recurrenceId: 'weekly-other-student',
  studentId: 'student-2',
};

function makeLesson(overrides: Partial<CalendarLesson> & { id: string; start: string }): CalendarLesson {
  return {
    studentId: 'student-1',
    studentName: 'Alumna Uno',
    level: 'B1',
    participants: [{ studentId: 'student-1', studentName: 'Alumna Uno', level: 'B1' }],
    lessonType: 'individual',
    end: new Date(new Date(overrides.start).getTime() + 60 * 60_000).toISOString(),
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  };
}

const lessonBeforeCutoff = makeLesson({
  id: 'before-cutoff',
  start: '2026-07-11T13:00:00.000Z',
  status: 'scheduled',
  recurrenceId: 'weekly-1',
  recurrenceOccurrenceKey: 'weekly-1:w0:c0:d5:t1000:s0',
});

const triggerLesson = makeLesson({
  id: 'trigger-cancelled',
  start: '2026-07-18T13:00:00.000Z',
  status: 'cancelled',
  recurrenceId: 'weekly-1',
  recurrenceOccurrenceKey: 'weekly-1:w1:c0:d5:t1000:s0',
});

const futureCancelledSameRule = makeLesson({
  id: 'future-cancelled',
  start: '2026-07-25T13:00:00.000Z',
  status: 'cancelled',
  recurrenceId: 'weekly-1',
  recurrenceOccurrenceKey: 'weekly-1:w2:c0:d5:t1000:s0',
});

const futureRescheduledSameRule = makeLesson({
  id: 'future-rescheduled',
  start: '2026-08-05T13:00:00.000Z',
  status: 'rescheduled',
  recurrenceId: 'weekly-1',
  recurrenceOccurrenceKey: 'weekly-1:w3:c0:d5:t1000:s0',
  recurrenceOriginalStart: '2026-08-01T13:00:00.000Z',
});

const futureCompletedSameRule = makeLesson({
  id: 'future-completed',
  start: '2026-07-25T13:00:00.000Z',
  status: 'completed',
  recurrenceId: 'weekly-1',
  recurrenceOccurrenceKey: 'weekly-1:w2:c0:d5:t1300:s1',
});

const futureConcurrentRuleLesson = makeLesson({
  id: 'future-concurrent',
  start: '2026-07-20T19:00:00.000Z',
  status: 'scheduled',
  recurrenceId: 'weekly-2',
  recurrenceOccurrenceKey: 'weekly-2:w2:c0:d1:t1600:s0',
});

const otherStudentLesson = makeLesson({
  id: 'other-student',
  studentId: 'student-2',
  studentName: 'Otro Alumno',
  start: '2026-07-25T13:00:00.000Z',
  status: 'scheduled',
  recurrenceId: 'weekly-other-student',
  recurrenceOccurrenceKey: 'weekly-other-student:w2:c0:d5:t1000:s0',
});

const allRules = [
  weeklyRule,
  concurrentRule,
  notStartedRule,
  alreadyEndedRule,
  expiredRule,
  otherStudentRule,
];

const allLessons = [
  lessonBeforeCutoff,
  triggerLesson,
  futureCancelledSameRule,
  futureRescheduledSameRule,
  futureCompletedSameRule,
  futureConcurrentRuleLesson,
  otherStudentLesson,
];

test('serie semanal cortada el 18/07 termina el 17/07', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  const truncated = result.rules.find((rule) => rule.recurrenceId === 'weekly-1');
  assertEqual(result.effectiveDate, '2026-07-18', 'fecha lógica de la ocurrencia');
  assertEqual(truncated?.endDate, '2026-07-17', 'corte inclusivo el día anterior');
  assertEqual(truncated?.status, 'active', 'conserva estado para mostrar historial');
});

test('no se generan ocurrencias posteriores al corte', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  const truncated = result.rules.find((rule) => rule.recurrenceId === 'weekly-1')!;
  const occurrences = generateOccurrences(
    truncated,
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-08-15T00:00:00.000Z')
  );
  assert(
    occurrences.every((occurrence) => occurrence.start < '2026-07-18'),
    'ninguna ocurrencia cae en o después del 18/07'
  );
  assert(occurrences.length > 0, 'conserva ocurrencias anteriores generables');
});

test('se conserva una clase anterior al corte', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  assert(
    result.lessons.some((item) => item.id === 'before-cutoff'),
    'la clase del 11/07 se conserva'
  );
});

test('se eliminan materializaciones futuras, incluidas canceladas y reprogramadas', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  assert(!result.lessons.some((item) => item.id === 'trigger-cancelled'), 'quita la tarjeta disparadora');
  assert(!result.lessons.some((item) => item.id === 'future-cancelled'), 'quita cancelada futura de la misma serie');
  assert(
    !result.lessons.some((item) => item.id === 'future-rescheduled'),
    'quita reprogramada cuya fecha lógica original cae en el tramo eliminado'
  );
});

test('se cortan reglas concurrentes del mismo alumno', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  const concurrent = result.rules.find((rule) => rule.recurrenceId === 'weekly-2');
  assertEqual(concurrent?.endDate, '2026-07-17', 'segunda regla activa también se corta');
  assert(
    !result.lessons.some((item) => item.id === 'future-concurrent'),
    'libera el horario de la regla concurrente'
  );
});

test('una regla que todavía no comenzó queda ended sin endDate inválido', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  const future = result.rules.find((rule) => rule.recurrenceId === 'weekly-not-started');
  assertEqual(future?.status, 'ended', 'se cierra por estado');
  assertEqual(future?.endDate, null, 'no fabrica un endDate anterior a startDate');
});

test('no se modifican reglas ya finalizadas o vencidas antes de la fecha', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  assertEqual(
    result.rules.find((rule) => rule.recurrenceId === 'weekly-ended'),
    alreadyEndedRule,
    'regla ya finalizada queda intacta'
  );
  assertEqual(
    result.rules.find((rule) => rule.recurrenceId === 'weekly-expired'),
    expiredRule,
    'regla ya vencida queda intacta'
  );
});

test('no se modifica la serie de otro alumno', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  assertEqual(
    result.rules.find((rule) => rule.recurrenceId === 'weekly-other-student'),
    otherStudentRule,
    'regla de otro alumno queda intacta'
  );
  assert(
    result.lessons.some((item) => item.id === 'other-student'),
    'clase de otro alumno se conserva'
  );
});

test('las clases completadas se conservan aunque caigan en el tramo eliminado', () => {
  const result = buildDeleteRecurrenceSeriesFromLesson({
    lesson: triggerLesson,
    rules: allRules,
    lessons: allLessons,
  });
  assert(
    result.lessons.some((item) => item.id === 'future-completed'),
    'el registro pedagógico completado no se borra'
  );
});

test('removeFutureUncompletedMaterializations nunca borra un registro completado', () => {
  const cleaned = removeFutureUncompletedMaterializations(
    [futureCompletedSameRule, futureCancelledSameRule],
    ['weekly-1'],
    '2026-07-18',
    timezone
  );
  assertEqual(cleaned.length, 1, 'sólo sobrevive la completada');
  assertEqual(cleaned[0].id, 'future-completed', 'preserva el registro pedagógico');
});

test('sanitizeMaterializationsByRuleBounds preserva completadas fuera del endDate', () => {
  const boundedRule: RecurrenceRule = { ...weeklyRule, endDate: '2026-07-17' };
  const cleaned = sanitizeMaterializationsByRuleBounds(
    [futureCompletedSameRule, futureCancelledSameRule],
    [boundedRule]
  );
  assert(cleaned.some((item) => item.id === 'future-completed'), 'no purga la completada al hidratar');
  assert(!cleaned.some((item) => item.id === 'future-cancelled'), 'sí purga la cancelada fuera de rango');
});

test('eliminar sólo esta clase sigue creando una exclusión persistente', () => {
  const deleted = buildDeletedCalendarLessonMutation(
    [triggerLesson],
    [],
    triggerLesson,
    '2026-07-18T12:00:00.000Z'
  );
  assertEqual(deleted.lessons.length, 0, 'quita únicamente la tarjeta');
  assertEqual(deleted.exceptions.length, 1, 'crea una excepción');
  assertEqual(deleted.exceptions[0].type, 'excluded', 'excluye la ocurrencia para siempre');
  assertEqual(deleted.exceptions[0].occurrenceKey, triggerLesson.recurrenceOccurrenceKey, 'misma ocurrencia');
});

test('una clase suelta o legacy no puede eliminar la serie', () => {
  const looseLesson = makeLesson({
    id: 'loose',
    start: '2026-07-18T13:00:00.000Z',
    status: 'cancelled',
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
  });
  let rejected = false;
  try {
    buildDeleteRecurrenceSeriesFromLesson({ lesson: looseLesson, rules: allRules, lessons: allLessons });
  } catch {
    rejected = true;
  }
  assert(rejected, 'exige identidad recurrente completa');
});

test('no permite eliminar la serie de una clase que no está cancelada', () => {
  const scheduledLesson = { ...triggerLesson, status: 'scheduled' as const };
  let rejected = false;
  try {
    buildDeleteRecurrenceSeriesFromLesson({ lesson: scheduledLesson, rules: allRules, lessons: allLessons });
  } catch {
    rejected = true;
  }
  assert(rejected, 'exige cancelación previa, igual que eliminar sólo esta clase');

  const completedLesson = { ...triggerLesson, status: 'completed' as const };
  let rejectedCompleted = false;
  try {
    buildDeleteRecurrenceSeriesFromLesson({ lesson: completedLesson, rules: allRules, lessons: allLessons });
  } catch {
    rejectedCompleted = true;
  }
  assert(rejectedCompleted, 'nunca opera sobre una clase completada');
});

test('rechaza truncar cuando no encuentra la regla de la clase', () => {
  const orphanTrigger = { ...triggerLesson, recurrenceId: 'missing-rule' };
  let rejected = false;
  try {
    buildDeleteRecurrenceSeriesFromLesson({ lesson: orphanTrigger, rules: allRules, lessons: allLessons });
  } catch {
    rejected = true;
  }
  assert(rejected, 'sin regla ancla no hay fecha efectiva confiable');
});

test('truncateStudentRecurrencesFromDate no muta las reglas de entrada', () => {
  truncateStudentRecurrencesFromDate({
    rules: allRules,
    studentId: 'student-1',
    effectiveDate: '2026-07-18',
  });
  assertEqual(weeklyRule.endDate, null, 'la regla original no se muta');
  assertEqual(weeklyRule.status, 'active', 'el estado original no se muta');
});
