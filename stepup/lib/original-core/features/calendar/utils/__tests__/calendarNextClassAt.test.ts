// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarNextClassAt.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../types/index.ts';
import { calculateCurrentOrNextClass, calculateNextClassAt, classifyLessonTiming, planNextClassAtRepairs, resolveDisplayableNextClassAt, selectCurrentOrNextOccurrence } from '../calendarNextClassAt.ts';
import { formatNextClassLabel } from '../../../students/utils/format.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const student = { id: 'student-1', status: 'activo' as const };

const looseLesson: CalendarLesson = {
  id: 'loose',
  studentId: student.id,
  studentName: 'Alumno Uno',
  level: 'B1',
  participants: [{ studentId: student.id, studentName: 'Alumno Uno', level: 'B1' }],
  lessonType: 'individual',
  start: '2026-07-20T21:00:00.000Z',
  end: '2026-07-20T22:00:00.000Z',
  modality: 'presencial',
  status: 'scheduled',
  color: '#fff',
  overlapAllowed: false,
  overlapGroupId: null,
  isRecurring: false,
  recurrenceId: null,
  recurrenceOccurrenceKey: null,
  recurrenceIndex: null,
  recurrenceOriginalStart: null,
};

const recurringRule: RecurrenceRule = {
  recurrenceId: 'rule-next',
  studentId: student.id,
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [
    { weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] },
  ],
  modality: 'presencial',
  timezone: 'America/Argentina/Buenos_Aires',
  startDate: '2026-07-13',
  endDate: null,
  status: 'active',
};

test('devuelve null sin candidatos', () => {
  assertEqual(
    calculateNextClassAt(student, [], [], [], new Date('2026-07-13T22:00:00.000Z')),
    null,
    'sin próxima clase'
  );
});

test('elige la más cercana entre suelta y recurrente', () => {
  assertEqual(
    calculateNextClassAt(
      student,
      [looseLesson],
      [recurringRule],
      [],
      new Date('2026-07-13T22:00:00.000Z')
    ),
    '2026-07-20T21:00:00.000Z',
    'misma fecha más cercana'
  );
});

test('ignora ocurrencia recurrente cancelada', () => {
  const firstKey = 'rule-next:w1:c0:d0:t1800:s0';
  assertEqual(
    calculateNextClassAt(
      student,
      [],
      [recurringRule],
      [
        {
          occurrenceKey: firstKey,
          recurrenceId: 'rule-next',
          type: 'cancelled',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      new Date('2026-07-13T22:00:00.000Z')
    ),
    '2026-07-27T21:00:00.000Z',
    'salta la cancelada'
  );
});

test('alumno no activo no tiene próxima clase', () => {
  assertEqual(
    calculateNextClassAt(
      { id: student.id, status: 'pausado' },
      [looseLesson],
      [recurringRule],
      [],
      new Date('2026-07-13T22:00:00.000Z')
    ),
    null,
    'pausado'
  );
});

// ============================================================================
// Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" PASADA Y RECURRENCIAS
// FUTURAS AUSENTES): pruebas obligatorias de la lista de 18 escenarios.
// Identidades `qa_*` y reloj siempre inyectado — nunca nombres/fechas reales.
// ============================================================================

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const REMOTE_PAST_ISO = '2000-01-01T00:00:00.000Z';
const REMOTE_FUTURE_ISO = '2099-01-01T00:00:00.000Z';

function qaLesson(overrides: Partial<CalendarLesson> & { id: string; studentId: string; start: string; end: string }): CalendarLesson {
  return {
    studentName: 'Alumno QA',
    level: 'B1',
    participants: [{ studentId: overrides.studentId, studentName: 'Alumno QA', level: 'B1' }],
    lessonType: 'individual',
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  };
}

function qaRule(overrides: Partial<RecurrenceRule> & { recurrenceId: string; studentId: string; weeks: RecurrenceRule['weeks'] }): RecurrenceRule {
  return {
    type: 'weekly',
    cycleLengthWeeks: 1,
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-13', // lunes verificado (misma base que `recurringRule` de arriba)
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

// --- 1) nextClassAt pasado se descarta / invariante: nunca start <= now -----
test('1) resolveDisplayableNextClassAt: una fecha pasada se descarta, nunca se muestra como próxima', () => {
  assertEqual(
    resolveDisplayableNextClassAt(REMOTE_PAST_ISO, new Date('2026-08-20T00:00:00.000Z')),
    null,
    'fecha pasada -> null'
  );
});

test('1b) resolveDisplayableNextClassAt: exactamente "ahora" (ni un instante después) tampoco cuenta como próxima', () => {
  const now = new Date('2026-08-20T18:00:00.000Z');
  assertEqual(resolveDisplayableNextClassAt(now.toISOString(), now), null, 'estrictamente posterior, nunca igual');
});

test('1c) resolveDisplayableNextClassAt: una fecha futura real se conserva tal cual (nunca se reemplaza por otra)', () => {
  assertEqual(
    resolveDisplayableNextClassAt(REMOTE_FUTURE_ISO, new Date('2026-08-20T00:00:00.000Z')),
    REMOTE_FUTURE_ISO,
    'fecha futura -> se conserva'
  );
});

test('1d) resolveDisplayableNextClassAt: null se mantiene null', () => {
  assertEqual(resolveDisplayableNextClassAt(null, new Date('2026-08-20T00:00:00.000Z')), null, 'null -> null');
});

// --- 2) alumno con próxima clase futura: muestra la futura más cercana -----
test('2) calculateNextClassAt: entre varias clases sueltas futuras, elige la más cercana a "ahora"', () => {
  const qaStudent = { id: 'qa_multi', status: 'activo' as const };
  const now = new Date('2026-08-01T12:00:00.000Z');
  const lessons: CalendarLesson[] = [
    qaLesson({ id: 'qa_l1', studentId: qaStudent.id, start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' }),
    qaLesson({ id: 'qa_l2', studentId: qaStudent.id, start: '2026-08-05T15:00:00.000Z', end: '2026-08-05T16:00:00.000Z' }),
    qaLesson({ id: 'qa_l3', studentId: qaStudent.id, start: '2026-08-20T15:00:00.000Z', end: '2026-08-20T16:00:00.000Z' }),
  ];
  const result = calculateNextClassAt(qaStudent, lessons, [], [], now);
  assertEqual(result, '2026-08-05T15:00:00.000Z', 'elige la más cercana, no la primera de la lista ni la última');
  assert(result !== null && new Date(result).getTime() > now.getTime(), 'invariante: el resultado siempre es estrictamente posterior a "ahora"');
});

// --- 3) sin clases futuras: "Sin próxima clase programada" ------------------
test('3) calculateNextClassAt: sin ninguna clase ni regla -> null', () => {
  assertEqual(calculateNextClassAt({ id: 'qa_none', status: 'activo' }, [], [], [], new Date('2026-08-20T00:00:00.000Z')), null, 'sin candidatos');
});

test('3b) formatNextClassLabel: null (o vencido) muestra el texto exacto pedido, nunca una fecha vieja', () => {
  assertEqual(formatNextClassLabel(null), 'Sin próxima clase programada', 'texto exacto para ausencia de próxima clase');
});

// --- 4) serie semanal activa sin fecha final continúa varias semanas -------
test('4) calculateNextClassAt: serie semanal sin endDate sigue generando clases muchas semanas después (nunca se corta tras la primera semana)', () => {
  const qaStudent = { id: 'qa_ongoing', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_ongoing_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  // 6 semanas después de la primera ocurrencia (2026-07-20), ya pasado el
  // turno de esa semana (24/08 18:00 ART) — si la serie "muriera" tras la
  // primera semana, esto daría null en vez de la semana siguiente real.
  const now = new Date('2026-08-24T22:00:00.000Z');
  const result = calculateNextClassAt(qaStudent, [], [rule], [], now);
  assertEqual(result, '2026-08-31T21:00:00.000Z', 'sigue generando la semana siguiente, indefinidamente');
  assert(result !== null && new Date(result).getTime() > now.getTime(), 'invariante: estrictamente futuro');
});

// --- 5) serie con dos días semanales elige correctamente el siguiente ------
const qaTwoDayRule = qaRule({
  recurrenceId: 'qa_two_day_rule',
  studentId: 'qa_two_day',
  weeks: [
    {
      weekIndex: 0,
      sessions: [
        { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }, // lunes
        { weekday: 3, hour: 17, minute: 0, durationMinutes: 60 }, // jueves
      ],
    },
  ],
});

test('5) calculateNextClassAt: con lunes y jueves, justo después del lunes elige el jueves de la misma semana', () => {
  const result = calculateNextClassAt(
    { id: 'qa_two_day', status: 'activo' },
    [],
    [qaTwoDayRule],
    [],
    new Date('2026-07-13T22:00:00.000Z') // después del lunes 18:00 ART
  );
  assertEqual(result, '2026-07-16T20:00:00.000Z', 'elige el jueves de esa semana, no salta directo al lunes siguiente');
});

test('5b) calculateNextClassAt: justo después del jueves elige el lunes de la semana siguiente', () => {
  const result = calculateNextClassAt(
    { id: 'qa_two_day', status: 'activo' },
    [],
    [qaTwoDayRule],
    [],
    new Date('2026-07-16T21:00:00.000Z') // después del jueves 17:00 ART
  );
  assertEqual(result, '2026-07-20T21:00:00.000Z', 'elige el lunes siguiente');
});

// --- 6) clase cancelada no cuenta -------------------------------------------
test('6) calculateNextClassAt: la ocurrencia cancelada de una semana se salta, pero el otro día de la misma semana sigue contando', () => {
  const cancelledThursdayKey = 'qa_two_day_rule:w0:c0:d3:t1700:s1';
  const result = calculateNextClassAt(
    { id: 'qa_two_day', status: 'activo' },
    [],
    [qaTwoDayRule],
    [
      {
        occurrenceKey: cancelledThursdayKey,
        recurrenceId: 'qa_two_day_rule',
        type: 'cancelled',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    new Date('2026-07-13T22:00:00.000Z')
  );
  assertEqual(result, '2026-07-20T21:00:00.000Z', 'salta el jueves cancelado y va directo al lunes siguiente');
});

test('6b) calculateNextClassAt: una clase materializada con status "cancelled" nunca cuenta como candidata', () => {
  const qaStudent = { id: 'qa_cancelled_lesson', status: 'activo' as const };
  const lessons: CalendarLesson[] = [
    qaLesson({ id: 'qa_cancel_1', studentId: qaStudent.id, start: '2026-08-05T15:00:00.000Z', end: '2026-08-05T16:00:00.000Z', status: 'cancelled' }),
    qaLesson({ id: 'qa_cancel_2', studentId: qaStudent.id, start: '2026-08-12T15:00:00.000Z', end: '2026-08-12T16:00:00.000Z', status: 'scheduled' }),
  ];
  assertEqual(
    calculateNextClassAt(qaStudent, lessons, [], [], new Date('2026-08-01T00:00:00.000Z')),
    '2026-08-12T15:00:00.000Z',
    'ignora la cancelada, cuenta sólo la agendada'
  );
});

// --- 7) clase reprogramada cuenta la nueva fecha ----------------------------
test('7) calculateNextClassAt: una ocurrencia recurrente reprogramada nunca cuenta con su fecha vieja; cuenta la clase reprogramada con su fecha nueva', () => {
  const qaStudent = { id: 'qa_reschedule', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_reschedule_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const originalOccurrenceKey = 'qa_reschedule_rule:w1:c0:d0:t1800:s0'; // 2026-07-20
  const rescheduledLesson = qaLesson({
    id: 'qa_reschedule_new',
    studentId: qaStudent.id,
    start: '2026-07-22T20:00:00.000Z', // nueva fecha, día distinto
    end: '2026-07-22T21:00:00.000Z',
    status: 'rescheduled',
  });
  const result = calculateNextClassAt(
    qaStudent,
    [rescheduledLesson],
    [rule],
    [
      {
        occurrenceKey: originalOccurrenceKey,
        recurrenceId: 'qa_reschedule_rule',
        type: 'rescheduled',
        replacementLessonId: 'qa_reschedule_new',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    new Date('2026-07-13T22:00:00.000Z')
  );
  assertEqual(result, '2026-07-22T20:00:00.000Z', 'cuenta la fecha nueva, nunca la original reprogramada');
});

// --- 8) editar futuras: no conserva una fecha del tramo anterior ------------
test('8) calculateNextClassAt: tras "editar futuras" (split en predecesora/sucesora), nunca devuelve un horario del tramo anterior ya finalizado', () => {
  const qaStudent = { id: 'qa_split', status: 'activo' as const };
  const predecessor = qaRule({
    recurrenceId: 'qa_pred',
    studentId: qaStudent.id,
    startDate: '2026-07-13',
    endDate: '2026-08-09', // termina antes del lunes 10/08
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const successor = qaRule({
    recurrenceId: 'qa_succ',
    studentId: qaStudent.id,
    startDate: '2026-08-10', // lunes siguiente
    endDate: null,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 19, minute: 0, durationMinutes: 60 }] }], // horario NUEVO (19:00, no 18:00)
  });
  const now = new Date('2026-08-05T00:00:00.000Z');
  const result = calculateNextClassAt(qaStudent, [], [predecessor, successor], [], now);
  assertEqual(result, '2026-08-10T22:00:00.000Z', 'usa el horario de la sucesora (19:00 ART), nunca el de la predecesora ya finalizada (18:00 ART)');
});

// --- 9) serie pausada/finalizada no genera próximas indebidas --------------
test('9) calculateNextClassAt: una regla en pausa nunca genera próximas clases', () => {
  const rule = qaRule({
    recurrenceId: 'qa_paused_rule',
    studentId: 'qa_paused_student',
    status: 'paused',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  assertEqual(
    calculateNextClassAt({ id: 'qa_paused_student', status: 'activo' }, [], [rule], [], new Date('2026-07-13T00:00:00.000Z')),
    null,
    'pausada -> ninguna próxima'
  );
});

test('9b) calculateNextClassAt: una regla finalizada nunca genera próximas clases', () => {
  const rule = qaRule({
    recurrenceId: 'qa_ended_rule',
    studentId: 'qa_ended_student',
    status: 'ended',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  assertEqual(
    calculateNextClassAt({ id: 'qa_ended_student', status: 'activo' }, [], [rule], [], new Date('2026-07-13T00:00:00.000Z')),
    null,
    'finalizada -> ninguna próxima'
  );
});

// --- 10/11/12) participantIds: agregado / quitado / clase grupal -----------
const qaGroupRule = qaRule({
  recurrenceId: 'qa_group_rule',
  studentId: 'qa_group_a',
  participantIds: ['qa_group_a', 'qa_group_b'],
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
});

test('10) calculateNextClassAt: un alumno agregado a una serie grupal (participantIds) recibe las ocurrencias futuras', () => {
  const now = new Date('2026-07-13T22:00:00.000Z');
  const result = calculateNextClassAt({ id: 'qa_group_b', status: 'activo' }, [], [qaGroupRule], [], now);
  assertEqual(result, '2026-07-20T21:00:00.000Z', 'el segundo participante también recibe la ocurrencia futura');
});

test('11) calculateNextClassAt: un alumno que ya no está en participantIds deja de recibir las ocurrencias', () => {
  const now = new Date('2026-07-13T22:00:00.000Z');
  const result = calculateNextClassAt({ id: 'qa_group_c', status: 'activo' }, [], [qaGroupRule], [], now);
  assertEqual(result, null, 'quien no está en participantIds no recibe nada de esta serie');
});

test('12) calculateNextClassAt: en una clase grupal, TODOS los participantes reciben exactamente la misma próxima clase válida', () => {
  const now = new Date('2026-07-13T22:00:00.000Z');
  const forA = calculateNextClassAt({ id: 'qa_group_a', status: 'activo' }, [], [qaGroupRule], [], now);
  const forB = calculateNextClassAt({ id: 'qa_group_b', status: 'activo' }, [], [qaGroupRule], [], now);
  assertEqual(forA, forB, 'misma fecha para ambos participantes');
  assert(forA !== null, 'ninguno de los dos queda sin próxima clase');
});

// --- 13) reemplazo de cancelación no contamina al alumno original ----------
test('13) calculateNextClassAt: el reemplazo de una clase cancelada de OTRO alumno nunca contamina la próxima clase del alumno original', () => {
  const cancelledOriginal = qaLesson({
    id: 'qa_orig_cancelled',
    studentId: 'qa_original',
    start: '2026-08-05T15:00:00.000Z',
    end: '2026-08-05T16:00:00.000Z',
    status: 'cancelled',
  });
  const replacementForSomeoneElse = qaLesson({
    id: 'qa_replacement',
    studentId: 'qa_replacement_student',
    start: '2026-08-06T15:00:00.000Z',
    end: '2026-08-06T16:00:00.000Z',
    status: 'scheduled',
    freedByLessonId: 'qa_orig_cancelled',
  });
  const originalOwnFutureLesson = qaLesson({
    id: 'qa_orig_future',
    studentId: 'qa_original',
    start: '2026-08-20T15:00:00.000Z',
    end: '2026-08-20T16:00:00.000Z',
    status: 'scheduled',
  });
  const lessons = [cancelledOriginal, replacementForSomeoneElse, originalOwnFutureLesson];
  const now = new Date('2026-08-01T00:00:00.000Z');

  assertEqual(
    calculateNextClassAt({ id: 'qa_original', status: 'activo' }, lessons, [], [], now),
    '2026-08-20T15:00:00.000Z',
    'el alumno original recibe SU propia próxima clase, nunca la fecha del reemplazo ajeno'
  );
  assertEqual(
    calculateNextClassAt({ id: 'qa_replacement_student', status: 'activo' }, lessons, [], [], now),
    '2026-08-06T15:00:00.000Z',
    'el alumno del reemplazo sí recibe su propia clase'
  );
});

// --- 14) cambio de mes y año -------------------------------------------------
test('14) calculateNextClassAt: cruza correctamente de diciembre a enero del año siguiente', () => {
  const rule = qaRule({
    recurrenceId: 'qa_year_boundary_rule',
    studentId: 'qa_year_boundary',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  // 2026-12-28 es lunes (24 semanas exactas después del 2026-07-13); "ahora"
  // se ubica después de esa clase, así que la siguiente cae en enero de 2027.
  const now = new Date('2026-12-30T23:00:00.000Z');
  const result = calculateNextClassAt({ id: 'qa_year_boundary', status: 'activo' }, [], [rule], [], now);
  assertEqual(result, '2027-01-04T21:00:00.000Z', 'la próxima clase cruza al año siguiente correctamente');
  assert(result !== null && new Date(result).getUTCFullYear() === 2027, 'cae en el año siguiente');
});

// --- 15) casos cercanos a medianoche en America/Argentina/Buenos_Aires -----
test('15) calculateNextClassAt: una sesión a las 23:30 ART se resuelve del lado correcto de la medianoche (UTC ya es día siguiente)', () => {
  const rule = qaRule({
    recurrenceId: 'qa_midnight_rule',
    studentId: 'qa_midnight',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 23, minute: 30, durationMinutes: 60 }] }],
  });
  // "ahora" = lunes 23:00 ART = martes 02:00 UTC (ya cruzó la medianoche en UTC,
  // pero en Buenos Aires todavía es lunes a la noche).
  const now = new Date('2026-07-14T02:00:00.000Z');
  const result = calculateNextClassAt({ id: 'qa_midnight', status: 'activo' }, [], [rule], [], now);
  assertEqual(result, '2026-07-14T02:30:00.000Z', 'la sesión de las 23:30 ART (mismo lunes) sigue siendo la próxima clase');
  assert(result !== null && new Date(result).getTime() > now.getTime(), 'invariante: estrictamente futuro incluso cerca de la medianoche');
});

// --- 16/17) hidratación con nextClassAt antiguo / restauración de respaldo --
// (`planNextClassAtRepairs` es el mismo núcleo puro que usa
// `repairStaleNextClassAtForAllStudents` tanto al hidratar la app como al
// restaurar un respaldo — ver `calendarNextClassAtSync.ts`.)
test('16) planNextClassAtRepairs: un nextClassAt vencido (hidratación con dato viejo) se detecta y se recalcula al valor real', () => {
  const rule = qaRule({
    recurrenceId: 'qa_repair_rule',
    studentId: 'qa_stale',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const now = new Date('2026-07-13T22:00:00.000Z');
  const repairs = planNextClassAtRepairs(
    [{ id: 'qa_stale', status: 'activo', nextClassAt: '2020-01-01T00:00:00.000Z' }],
    [],
    [rule],
    [],
    now
  );
  assertEqual(repairs.length, 1, 'detecta exactamente un alumno para reparar');
  assertEqual(repairs[0].currentNextClassAt, '2020-01-01T00:00:00.000Z', 'conserva el valor viejo para diagnóstico');
  assertEqual(repairs[0].canonicalNextClassAt, '2026-07-20T21:00:00.000Z', 'recalcula el valor real vigente');
});

test('16b) planNextClassAtRepairs: un nextClassAt ya correcto no genera ninguna reparación (idempotente, nunca escribe de más)', () => {
  const rule = qaRule({
    recurrenceId: 'qa_repair_rule_ok',
    studentId: 'qa_correct',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const now = new Date('2026-07-13T22:00:00.000Z');
  const repairs = planNextClassAtRepairs(
    [
      {
        id: 'qa_correct',
        status: 'activo',
        nextClassAt: '2026-07-20T21:00:00.000Z',
        // Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES
        // DE QUE TERMINE LA CLASE EN CURSO): idempotencia real ahora exige
        // que TAMBIÉN esté al día `nextClassEndAt` (60 minutos después del
        // inicio, la duración real de esta regla) — si no, sí habría algo
        // legítimo que reparar.
        nextClassEndAt: '2026-07-20T22:00:00.000Z',
      },
    ],
    [],
    [rule],
    [],
    now
  );
  assertEqual(repairs.length, 0, 'ya está al día, no hay nada que reparar');
});

test('16c) planNextClassAtRepairs: un alumno pausado con un nextClassAt persistido (inconsistente con su estado) se repara a null', () => {
  const now = new Date('2026-07-13T22:00:00.000Z');
  const repairs = planNextClassAtRepairs(
    [{ id: 'qa_paused_stale', status: 'pausado', nextClassAt: '2099-01-01T00:00:00.000Z' }],
    [],
    [],
    [],
    now
  );
  assertEqual(repairs.length, 1, 'un alumno pausado nunca debería tener nextClassAt persistido');
  assertEqual(repairs[0].canonicalNextClassAt, null, 'se repara a null, no a otra fecha inventada');
});

test('17) planNextClassAtRepairs: tras restaurar un respaldo, recalcula el nextClassAt de los alumnos restaurados usando las clases/reglas restauradas', () => {
  // Simula el snapshot que ya llega hidratado tras `syncInMemoryStores`
  // (alumnos = `backup.students`, reglas = `backup.recurrenceRules`, etc.):
  // mismo núcleo que usa `restoreService.ts` al llamar
  // `repairStaleNextClassAtForAllStudents(backup.calendarLessons, ...)`.
  const restoredRule = qaRule({
    recurrenceId: 'qa_restore_rule',
    studentId: 'qa_restored_student',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const restoredStudents = [
    { id: 'qa_restored_student', status: 'activo' as const, nextClassAt: '2019-05-01T00:00:00.000Z' },
  ];
  const now = new Date('2026-07-13T22:00:00.000Z');
  const repairs = planNextClassAtRepairs(restoredStudents, [], [restoredRule], [], now);
  assertEqual(repairs.length, 1, 'detecta el dato heredado del respaldo como vencido');
  assertEqual(repairs[0].canonicalNextClassAt, '2026-07-20T21:00:00.000Z', 'lo recalcula con las reglas ya restauradas');
});

// --- 18) coherencia entre listado/perfil/Home/calendario --------------------
test('18) coherencia: resolveDisplayableNextClassAt y formatNextClassLabel (listado) coinciden en el mismo veredicto pasado/futuro que el filtro de Inicio (start > now)', () => {
  const nowReal = Date.now();
  assertEqual(resolveDisplayableNextClassAt(REMOTE_PAST_ISO), null, 'guard: fecha pasada -> null');
  assertEqual(formatNextClassLabel(REMOTE_PAST_ISO), 'Sin próxima clase programada', 'listado: misma fecha pasada -> mismo texto de ausencia');
  assert(new Date(REMOTE_PAST_ISO).getTime() < nowReal, 'Home (filtro start > now): esa fecha también es pasada para el dashboard');

  const displayableFuture = resolveDisplayableNextClassAt(REMOTE_FUTURE_ISO);
  assertEqual(displayableFuture, REMOTE_FUTURE_ISO, 'guard: fecha futura -> se conserva');
  assert(formatNextClassLabel(REMOTE_FUTURE_ISO) !== 'Sin próxima clase programada', 'listado: la misma fecha futura sí se muestra');
  assert(new Date(REMOTE_FUTURE_ISO).getTime() > nowReal, 'Home (filtro start > now): esa fecha también es futura para el dashboard');
});

// --- invariante final: ninguna "próxima clase" puede cumplir start <= now --
// Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
// TERMINE LA CLASE EN CURSO): esta invariante sigue siendo válida para los 3
// casos de acá abajo (ninguno tiene una clase EN CURSO al momento `now`
// elegido) — pero ya NO es una regla global: desde esta corrección,
// `calculateNextClassAt` SÍ puede devolver un `start <= now` cuando esa
// ocurrencia sigue en curso (`start <= now < end`) — ver la sección "P0)
// PRÓXIMA CLASE EN CURSO" más abajo para esos casos, cubiertos aparte.
test('invariante final: en todos los escenarios anteriores, ninguna próxima clase devuelta cumple start <= now', () => {
  const cases: Array<{ now: Date; result: string | null }> = [
    { now: new Date('2026-08-01T12:00:00.000Z'), result: calculateNextClassAt({ id: 'qa_multi', status: 'activo' }, [
      qaLesson({ id: 'qa_l1', studentId: 'qa_multi', start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' }),
      qaLesson({ id: 'qa_l2', studentId: 'qa_multi', start: '2026-08-05T15:00:00.000Z', end: '2026-08-05T16:00:00.000Z' }),
    ], [], [], new Date('2026-08-01T12:00:00.000Z')) },
    { now: new Date('2026-08-24T22:00:00.000Z'), result: calculateNextClassAt({ id: 'qa_ongoing', status: 'activo' }, [], [qaRule({
      recurrenceId: 'qa_ongoing_rule', studentId: 'qa_ongoing',
      weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    })], [], new Date('2026-08-24T22:00:00.000Z')) },
    { now: new Date('2026-12-30T23:00:00.000Z'), result: calculateNextClassAt({ id: 'qa_year_boundary', status: 'activo' }, [], [qaRule({
      recurrenceId: 'qa_year_boundary_rule', studentId: 'qa_year_boundary',
      weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    })], [], new Date('2026-12-30T23:00:00.000Z')) },
  ];

  cases.forEach(({ now, result }, index) => {
    assert(result !== null, `caso ${index}: debería haber una próxima clase`);
    assert(
      result !== null && new Date(result).getTime() > now.getTime(),
      `caso ${index}: la próxima clase (${result}) nunca puede ser <= ahora (${now.toISOString()})`
    );
  });
});

// ============================================================================
// Corrección P0 (a pedido de Joaquín — PROMEDIOS REALES Y PRÓXIMA CLASE,
// segunda ronda — "después de dictar o registrar una clase de hoy, algunos
// alumnos muestran 'Sin datos' o conservan una fecha pasada"): escenarios
// adicionales de la lista de 20 no cubiertos por la ronda anterior.
// ============================================================================

// --- 2) Clase registrada hoy + siguiente ocurrencia recurrente -------------
test('P0-2) calculateNextClassAt: la clase de hoy recién registrada (completed) ya no cuenta — la próxima es la siguiente ocurrencia recurrente real', () => {
  const qaStudent = { id: 'qa_registered_today', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_registered_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  // La clase de HOY (2026-07-13, lunes) ya se registró como completada —
  // mismo efecto real que `completeCalendarLessonService.ts` tras "Registrar
  // clase". "Ahora" está apenas después de esa clase.
  const registeredToday = qaLesson({
    id: 'qa_completed_today',
    studentId: qaStudent.id,
    start: '2026-07-13T21:00:00.000Z',
    end: '2026-07-13T22:00:00.000Z',
    status: 'completed',
  });
  const now = new Date('2026-07-13T22:30:00.000Z');
  const result = calculateNextClassAt(qaStudent, [registeredToday], [rule], [], now);
  assertEqual(result, '2026-07-20T21:00:00.000Z', 'la próxima es la ocurrencia recurrente de la semana siguiente, nunca "Sin datos" ni la clase ya registrada');
});

// --- 8) Ciclo personalizado (2 semanas, distinto día/hora cada semana) -----
test('P0-8) calculateNextClassAt: ciclo personalizado de 2 semanas elige correctamente según la posición real del ciclo', () => {
  const qaStudent = { id: 'qa_custom_cycle', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_custom_cycle_rule',
    studentId: qaStudent.id,
    cycleLengthWeeks: 2,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }, // semana 0: martes
      { weekIndex: 1, sessions: [{ weekday: 2, hour: 17, minute: 0, durationMinutes: 60 }] }, // semana 1: miércoles
    ],
  });
  // Semana 0 (empieza 2026-07-13): el martes 14/07 18:00 ART = 21:00 UTC.
  const resultWeek0 = calculateNextClassAt(qaStudent, [], [rule], [], new Date('2026-07-13T12:00:00.000Z'));
  assertEqual(resultWeek0, '2026-07-14T21:00:00.000Z', 'semana 0 del ciclo: martes');

  // Semana 1 (empieza 2026-07-20): el miércoles 22/07 17:00 ART = 20:00 UTC.
  const resultWeek1 = calculateNextClassAt(qaStudent, [], [rule], [], new Date('2026-07-20T12:00:00.000Z'));
  assertEqual(resultWeek1, '2026-07-22T20:00:00.000Z', 'semana 1 del ciclo: miércoles, horario distinto');
});

// --- 11) Ocurrencia virtual y materializada duplicadas: una sola ----------
test('P0-11) calculateNextClassAt: si una ocurrencia ya está materializada (y reprogramada a otro horario), nunca cuenta dos veces (ni la virtual del molde ni la real por separado)', () => {
  const qaStudent = { id: 'qa_dedup', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_dedup_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  // La ocurrencia del 20/07 (semana 1) ya fue materializada, con un ajuste
  // real de horario (18:15 en vez de 18:00) — mismo occurrenceKey que
  // generaría la regla.
  const materialized = qaLesson({
    id: 'qa_materialized_1',
    studentId: qaStudent.id,
    start: '2026-07-20T21:15:00.000Z',
    end: '2026-07-20T22:15:00.000Z',
    status: 'scheduled',
    recurrenceId: 'qa_dedup_rule',
    recurrenceOccurrenceKey: 'qa_dedup_rule:w1:c0:d0:t1800:s0',
  });
  const result = calculateNextClassAt(qaStudent, [materialized], [rule], [], new Date('2026-07-13T22:00:00.000Z'));
  assertEqual(result, '2026-07-20T21:15:00.000Z', 'cuenta el horario REAL materializado, nunca el horario del molde virtual como candidato aparte');
});

// --- 18) Un alumno eliminado de una clase puntual deja de tenerla como próxima --
test('P0-18) calculateNextClassAt: al quitar a un alumno de una clase grupal puntual, esa clase deja de ser su próxima', () => {
  const lessonWithBoth = qaLesson({
    id: 'qa_group_lesson',
    studentId: 'qa_remains',
    start: '2026-08-10T21:00:00.000Z',
    end: '2026-08-10T22:00:00.000Z',
    participants: [
      { studentId: 'qa_remains', studentName: 'Se queda', level: 'B1' },
      { studentId: 'qa_removed', studentName: 'Se quita', level: 'B1' },
    ],
  });
  // El alumno "qa_removed" ya no figura entre los participantes de la clase.
  const lessonAfterRemoval: CalendarLesson = {
    ...lessonWithBoth,
    participants: lessonWithBoth.participants.filter((participant) => participant.studentId !== 'qa_removed'),
  };
  const now = new Date('2026-08-01T00:00:00.000Z');
  assertEqual(
    calculateNextClassAt({ id: 'qa_removed', status: 'activo' }, [lessonAfterRemoval], [], [], now),
    null,
    'el alumno quitado ya no recibe esta clase como próxima'
  );
  assertEqual(
    calculateNextClassAt({ id: 'qa_remains', status: 'activo' }, [lessonAfterRemoval], [], [], now),
    '2026-08-10T21:00:00.000Z',
    'el alumno que se queda sigue recibiéndola con normalidad'
  );
});

// --- 19) Registrar una clase no elimina futuras ocurrencias de la serie ----
test('P0-19) calculateNextClassAt: materializar la ocurrencia de hoy como completada nunca afecta que la serie siga generando semanas futuras', () => {
  const qaStudent = { id: 'qa_register_keeps_series', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_register_keeps_series_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const registeredToday = qaLesson({
    id: 'qa_completed_today_2',
    studentId: qaStudent.id,
    start: '2026-07-13T21:00:00.000Z',
    end: '2026-07-13T22:00:00.000Z',
    status: 'completed',
    recurrenceId: 'qa_register_keeps_series_rule',
    recurrenceOccurrenceKey: 'qa_register_keeps_series_rule:w0:c0:d0:t1800:s0',
  });
  // Semanas más adelante, la serie sigue generando con total normalidad.
  const result = calculateNextClassAt(
    qaStudent,
    [registeredToday],
    [rule],
    [],
    new Date('2026-08-17T22:00:00.000Z')
  );
  assertEqual(result, '2026-08-24T21:00:00.000Z', 'la serie sigue generando semanas futuras normalmente, nunca se corta por registrar una ocurrencia pasada');
});

// --- 20) Coherencia: la próxima clase del perfil coincide con la próxima tarjeta visible del calendario --
test('P0-20) calculateNextClassAt: coincide exactamente con la tarjeta futura más cercana que vería el calendario (mismas clases/reglas, mismo criterio scheduled/rescheduled + futuro)', () => {
  const qaStudent = { id: 'qa_coherence', status: 'activo' as const };
  const rule = qaRule({
    recurrenceId: 'qa_coherence_rule',
    studentId: qaStudent.id,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 16, minute: 0, durationMinutes: 60 }] }], // jueves
  });
  const looseFuture = qaLesson({
    id: 'qa_coherence_loose',
    studentId: qaStudent.id,
    start: '2026-07-15T15:00:00.000Z',
    end: '2026-07-15T16:00:00.000Z',
  });
  const now = new Date('2026-07-13T22:00:00.000Z');

  const result = calculateNextClassAt(qaStudent, [looseFuture], [rule], [], now);

  // Lo que "vería" una tarjeta de calendario: cualquier clase agendada o
  // reprogramada, estrictamente futura, del propio alumno.
  const visibleCalendarCandidates = [looseFuture]
    .filter((lesson) => (lesson.status === 'scheduled' || lesson.status === 'rescheduled') && new Date(lesson.start).getTime() > now.getTime())
    .map((lesson) => lesson.start);
  const nearestVisibleCard = visibleCalendarCandidates.reduce((nearest, candidate) =>
    new Date(candidate).getTime() < new Date(nearest).getTime() ? candidate : nearest
  );

  assertEqual(result, nearestVisibleCard, 'la próxima clase del perfil es exactamente la tarjeta más cercana que el calendario mostraría');
});

// ============================================================================
// Corrección P0 2026-08-21, segunda ronda (a pedido de Joaquín — SEGUNDA
// REGRESIÓN, promedios): "Próxima clase" ya estaba correctamente resuelta
// (fix anterior) — prueba de regresión única, sin reescribir la
// implementación, confirmando que sigue sin depender del promedio.
// ============================================================================
test('P0-regresion) calculateNextClassAt nunca depende de averageGrade — un alumno con o sin calificaciones obtiene la misma próxima clase real', () => {
  const rule = qaRule({
    recurrenceId: 'qa_no_grade_dependency_rule',
    studentId: 'qa_no_grade_dependency',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const now = new Date('2026-07-13T22:00:00.000Z');
  // El tipo de alumno que usa calculateNextClassAt (`Pick<StudentListItem, 'id' | 'status'>`)
  // nunca incluye averageGrade — un objeto con ese campo extra (cualquier
  // valor, incluso null) debe dar exactamente el mismo resultado.
  const withGrade = { id: 'qa_no_grade_dependency', status: 'activo' as const, averageGrade: 9 };
  const withoutGrade = { id: 'qa_no_grade_dependency', status: 'activo' as const, averageGrade: null };
  assertEqual(
    calculateNextClassAt(withGrade, [], [rule], [], now),
    calculateNextClassAt(withoutGrade, [], [rule], [], now),
    'el promedio del alumno (presente, ausente, alto o bajo) nunca influye en su próxima clase'
  );
});

// ============================================================================
// P0) "PRÓXIMA CLASE" CAMBIA ANTES DE QUE TERMINE LA CLASE EN CURSO
// Corrección P0 (a pedido de Joaquín): antes, CUALQUIER cálculo de "próxima
// clase" (acá y en `buildDashboardData.ts`) exigía `start` estrictamente
// futuro — en el instante exacto en que una clase empezaba, dejaba de ser
// candidata y el resultado saltaba de inmediato a la siguiente, aunque la
// actual siguiera en curso. `classifyLessonTiming`/`selectCurrentOrNextOccurrence`
// son la ÚNICA función real de clasificación/selección — reutilizada acá,
// en `buildDashboardData.ts` (Home) y en `calculateCurrentOrNextClass`
// (perfil/lista de alumnos, vía `nextClassAt`+`nextClassEndAt` persistidos).
// ============================================================================

test('P0) classifyLessonTiming: ahora < start -> upcoming', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' }, new Date('2026-08-10T14:59:00.000Z')),
    'upcoming',
    'un minuto antes del inicio: próxima'
  );
});

test('P0) classifyLessonTiming: instante EXACTO del inicio -> in_progress (nunca upcoming)', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' }, new Date('2026-08-10T15:00:00.000Z')),
    'in_progress',
    'en el instante exacto del inicio ya es "en curso" — nunca sigue siendo "próxima"'
  );
});

test('P0) classifyLessonTiming: un milisegundo antes del final -> sigue in_progress', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' }, new Date('2026-08-10T15:59:59.999Z')),
    'in_progress',
    'todavía no llegó el instante exacto del final'
  );
});

test('P0) classifyLessonTiming: instante EXACTO del final -> finished (ya puede mostrarse la siguiente)', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' }, new Date('2026-08-10T16:00:00.000Z')),
    'finished',
    'en el instante exacto del final ya avanza — nunca sigue "en curso" un instante de más'
  );
});

test('P0) classifyLessonTiming: durante la clase (a mitad de camino) sigue siendo la MISMA clasificación in_progress', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' }, new Date('2026-08-10T15:30:00.000Z')),
    'in_progress',
    'a mitad de la clase sigue en curso'
  );
});

test('P0) classifyLessonTiming: cancelada/completada -> excluded, sin importar el horario (aunque coincida con "ahora")', () => {
  const window = { start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' };
  const now = new Date('2026-08-10T15:30:00.000Z');
  assertEqual(classifyLessonTiming({ ...window, status: 'cancelled' }, now), 'excluded', 'cancelada nunca queda activa');
  assertEqual(classifyLessonTiming({ ...window, status: 'completed' }, now), 'excluded', 'ya registrada/completada nunca queda activa');
});

test('P0) classifyLessonTiming: reprogramada (status rescheduled) sigue clasificando normalmente por horario', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'rescheduled' }, new Date('2026-08-10T15:30:00.000Z')),
    'in_progress',
    'reprogramada usa su horario efectivo, igual que cualquier otra clase válida'
  );
});

test('P0) classifyLessonTiming: ocurrencia virtual sin status (recurrencia, excepciones ya aplicadas) se trata como válida por construcción', () => {
  assertEqual(
    classifyLessonTiming({ start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' }, new Date('2026-08-10T15:30:00.000Z')),
    'in_progress',
    'sin status explícito, nunca se excluye — ya pasó por el motor de excepciones antes de llegar acá'
  );
});

// --- Duraciones reales (requisito explícito: 30/45/60/75/90/120 min) -------
[30, 45, 60, 75, 90, 120].forEach((durationMinutes) => {
  test(`P0) classifyLessonTiming: duración de ${durationMinutes} minutos — a mitad de camino sigue in_progress, un instante después de terminar ya es finished`, () => {
    const start = '2026-08-10T15:00:00.000Z';
    const end = new Date(new Date(start).getTime() + durationMinutes * 60_000).toISOString();
    const midpoint = new Date(new Date(start).getTime() + (durationMinutes * 60_000) / 2);
    assertEqual(classifyLessonTiming({ start, end, status: 'scheduled' }, midpoint), 'in_progress', `mitad de ${durationMinutes} min: en curso`);
    assertEqual(
      classifyLessonTiming({ start, end, status: 'scheduled' }, new Date(new Date(end).getTime() + 1)),
      'finished',
      `un instante después del final de ${durationMinutes} min: terminada`
    );
  });
});

test('P0) selectCurrentOrNextOccurrence: prioriza SIEMPRE una clase en curso por sobre cualquier futura, sin importar el orden de entrada', () => {
  const now = new Date('2026-08-10T15:30:00.000Z');
  const finished = { start: '2026-08-10T13:00:00.000Z', end: '2026-08-10T14:00:00.000Z', status: 'scheduled' as const };
  const inProgress = { start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' as const };
  const upcomingSoon = { start: '2026-08-10T17:00:00.000Z', end: '2026-08-10T18:00:00.000Z', status: 'scheduled' as const };
  const upcomingLater = { start: '2026-08-10T20:00:00.000Z', end: '2026-08-10T21:00:00.000Z', status: 'scheduled' as const };

  const result = selectCurrentOrNextOccurrence([upcomingLater, finished, upcomingSoon, inProgress], now);
  assert(result !== null, 'debe elegir algo');
  assertEqual(result!.occurrence, inProgress, 'la en curso gana aunque no sea la primera del array ni la más cercana a empezar');
  assertEqual(result!.timing, 'in_progress', 'clasificación correcta');
});

test('P0) selectCurrentOrNextOccurrence: sin ninguna en curso, elige la futura más próxima (nunca una más lejana)', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const soon = { start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' as const };
  const later = { start: '2026-08-10T20:00:00.000Z', end: '2026-08-10T21:00:00.000Z', status: 'scheduled' as const };
  const result = selectCurrentOrNextOccurrence([later, soon], now);
  assertEqual(result?.occurrence, soon, 'la más próxima, sin importar el orden de entrada');
  assertEqual(result?.timing, 'upcoming', 'todavía no empezó');
});

test('P0) selectCurrentOrNextOccurrence: todo excluido o terminado -> null ("Sin próximas clases")', () => {
  const now = new Date('2026-08-10T15:30:00.000Z');
  const finished = { start: '2026-08-10T13:00:00.000Z', end: '2026-08-10T14:00:00.000Z', status: 'scheduled' as const };
  const cancelled = { start: '2026-08-10T17:00:00.000Z', end: '2026-08-10T18:00:00.000Z', status: 'cancelled' as const };
  assertEqual(selectCurrentOrNextOccurrence([finished, cancelled], now), null, 'nada válido que mostrar');
});

test('P0) selectCurrentOrNextOccurrence: nunca muta el array de entrada ni sus elementos (sin efectos secundarios, sin duplicados)', () => {
  const now = new Date('2026-08-10T15:30:00.000Z');
  const inProgress = { start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z', status: 'scheduled' as const };
  const upcoming = { start: '2026-08-10T17:00:00.000Z', end: '2026-08-10T18:00:00.000Z', status: 'scheduled' as const };
  const candidates = [inProgress, upcoming];
  const snapshot = JSON.stringify(candidates);
  selectCurrentOrNextOccurrence(candidates, now);
  selectCurrentOrNextOccurrence(candidates, now);
  assertEqual(candidates.length, 2, 'nunca agrega ni quita elementos del array original');
  assertEqual(JSON.stringify(candidates), snapshot, 'ningún elemento se modifica en el proceso');
});

test('P0) calculateCurrentOrNextClass: clase materializada EN CURSO — devuelve start/end/timing correctos, nunca salta a la siguiente de hoy', () => {
  const qaStudent = { id: 'qa_in_progress', status: 'activo' as const };
  const current = qaLesson({ id: 'qa_now', studentId: qaStudent.id, start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const later = qaLesson({ id: 'qa_later', studentId: qaStudent.id, start: '2026-08-10T18:00:00.000Z', end: '2026-08-10T19:00:00.000Z' });
  const now = new Date('2026-08-10T15:30:00.000Z');

  const result = calculateCurrentOrNextClass(qaStudent, [current, later], [], [], now);
  assert(result !== null, 'debe encontrar la clase en curso');
  assertEqual(result!.start, current.start, 'sigue siendo la clase que ya empezó');
  assertEqual(result!.end, current.end, 'con su final real');
  assertEqual(result!.timing, 'in_progress', 'reconocida como en curso');
  assertEqual(calculateNextClassAt(qaStudent, [current, later], [], [], now), current.start, 'el wrapper liviano (nextClassAt) también sigue apuntando a la actual, no a la de las 18:00');
});

test('P0) calculateCurrentOrNextClass: exactamente al final, avanza de inmediato a la siguiente ocurrencia', () => {
  const qaStudent = { id: 'qa_exact_end', status: 'activo' as const };
  const current = qaLesson({ id: 'qa_now', studentId: qaStudent.id, start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const next = qaLesson({ id: 'qa_next', studentId: qaStudent.id, start: '2026-08-10T18:00:00.000Z', end: '2026-08-10T19:00:00.000Z' });
  const now = new Date('2026-08-10T16:00:00.000Z');

  const result = calculateCurrentOrNextClass(qaStudent, [current, next], [], [], now);
  assertEqual(result?.start, next.start, 'en el instante exacto del final, ya es la siguiente');
  assertEqual(result?.timing, 'upcoming', 'la siguiente todavía no empezó');
});

test('P0) calculateCurrentOrNextClass: clase reprogramada usa su horario reprogramado (nunca el original)', () => {
  const qaStudent = { id: 'qa_rescheduled', status: 'activo' as const };
  const rescheduled = qaLesson({
    id: 'qa_moved',
    studentId: qaStudent.id,
    status: 'rescheduled',
    start: '2026-08-10T17:00:00.000Z',
    end: '2026-08-10T18:00:00.000Z',
    recurrenceOriginalStart: '2026-08-10T15:00:00.000Z', // horario viejo, nunca debe usarse para clasificar
  });
  const now = new Date('2026-08-10T17:30:00.000Z'); // dentro del horario NUEVO, fuera del viejo
  const result = calculateCurrentOrNextClass(qaStudent, [rescheduled], [], [], now);
  assertEqual(result?.timing, 'in_progress', 'está en curso según el horario reprogramado real');
  assertEqual(result?.start, rescheduled.start, 'usa el start reprogramado');
});

test('P0) calculateCurrentOrNextClass: duración editada usa la duración nueva (end real, nunca la vieja)', () => {
  const qaStudent = { id: 'qa_duration_edited', status: 'activo' as const };
  // Se editó de 60 a 120 minutos — el "end" ya refleja la duración nueva
  // (misma convención ya establecida: start/end siempre son el horario
  // EFECTIVO, nunca se recalculan on-read).
  const edited = qaLesson({ id: 'qa_edited', studentId: qaStudent.id, start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T17:00:00.000Z' });
  const now = new Date('2026-08-10T16:30:00.000Z'); // pasaría la duración VIEJA (16:00) pero no la nueva (17:00)
  const result = calculateCurrentOrNextClass(qaStudent, [edited], [], [], now);
  assertEqual(result?.timing, 'in_progress', 'con la duración nueva (120 min) todavía está en curso a las 16:30');
});

test('P0) calculateCurrentOrNextClass: una clase cancelada durante su propio horario nunca cuenta como en curso', () => {
  const qaStudent = { id: 'qa_cancelled_window', status: 'activo' as const };
  const cancelled = qaLesson({ id: 'qa_cancelled', studentId: qaStudent.id, status: 'cancelled', start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const now = new Date('2026-08-10T15:30:00.000Z');
  assertEqual(calculateCurrentOrNextClass(qaStudent, [cancelled], [], [], now), null, 'cancelada nunca queda activa, ni durante su propio horario original');
});

test('P0) calculateCurrentOrNextClass: reemplazo activo de un horario cancelado cuenta como cualquier otra clase válida (en curso si corresponde)', () => {
  const qaStudent = { id: 'qa_replacement', status: 'activo' as const };
  const originalCancelled = qaLesson({ id: 'qa_original', studentId: qaStudent.id, status: 'cancelled', start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const replacement = qaLesson({ id: 'qa_replacement_lesson', studentId: qaStudent.id, status: 'scheduled', start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const now = new Date('2026-08-10T15:30:00.000Z');
  const result = calculateCurrentOrNextClass(qaStudent, [originalCancelled, replacement], [], [], now);
  assertEqual(result?.start, replacement.start, 'el reemplazo (scheduled) es la candidata válida, la cancelada original queda excluida');
  assertEqual(result?.timing, 'in_progress', 'el reemplazo también respeta start<=ahora<end');
});

test('P0) calculateCurrentOrNextClass: clase grupal — TODOS los participantes reconocen la misma clase EN CURSO', () => {
  const rule = qaRule({
    recurrenceId: 'qa_group_in_progress_rule',
    studentId: 'qa_group_a',
    participantIds: ['qa_group_a', 'qa_group_b', 'qa_group_c'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  // Lunes 2026-07-20, 18:00 ART = 21:00Z; medio de la clase = 21:30Z.
  const now = new Date('2026-07-20T21:30:00.000Z');
  ['qa_group_a', 'qa_group_b', 'qa_group_c'].forEach((studentId) => {
    const result = calculateCurrentOrNextClass({ id: studentId, status: 'activo' }, [], [rule], [], now);
    assertEqual(result?.timing, 'in_progress', `participante ${studentId}: reconoce la clase grupal en curso`);
    assertEqual(result?.start, '2026-07-20T21:00:00.000Z', `participante ${studentId}: mismo horario para todos`);
  });
});

test('P0) calculateCurrentOrNextClass: serie recurrente — una ocurrencia de HOY que ya empezó (todavía virtual, sin materializar) se reconoce EN CURSO', () => {
  // Causa raíz específica de las ocurrencias virtuales: `generateOccurrences`
  // descarta cualquier ocurrencia con `start < rangeStart` — pedir el rango
  // desde `now` (en vez de desde el inicio del día) haría que la ocurrencia
  // de HOY que ya empezó ni siquiera se generara. Este caso reproduce
  // exactamente esa causa raíz.
  const rule = qaRule({
    recurrenceId: 'qa_virtual_in_progress_rule',
    studentId: 'qa_virtual_in_progress',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const now = new Date('2026-07-20T21:15:00.000Z'); // 18:15 ART, 15 min dentro de la clase de las 18:00
  const result = calculateCurrentOrNextClass({ id: 'qa_virtual_in_progress', status: 'activo' }, [], [rule], [], now);
  assertEqual(result?.timing, 'in_progress', 'la ocurrencia virtual de hoy, ya empezada, se reconoce en curso');
  assertEqual(result?.start, '2026-07-20T21:00:00.000Z', 'con su horario real');
  assertEqual(result?.end, '2026-07-20T22:00:00.000Z', 'y su final real (60 minutos)');
});

test('P0) calculateCurrentOrNextClass: cruce de año — una serie EN CURSO justo pasada la medianoche del 1 de enero', () => {
  const rule = qaRule({
    recurrenceId: 'qa_new_year_rule',
    studentId: 'qa_new_year',
    startDate: '2026-12-28', // lunes
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 23, minute: 30, durationMinutes: 60 }] }], // 23:30 ART lunes 4/1
  });
  // Lunes 2027-01-04, 23:30 ART = 2027-01-05T02:30:00Z; 20 min después, todavía en curso.
  const now = new Date('2027-01-05T02:50:00.000Z');
  const result = calculateCurrentOrNextClass({ id: 'qa_new_year', status: 'activo' }, [], [rule], [], now);
  assertEqual(result?.timing, 'in_progress', 'sigue en curso cruzando la medianoche/el año calendario');
});

test('P0) resolveDisplayableNextClassAt: con el final real conocido, una fecha ya pasada SIGUE siendo válida mientras la clase continúe en curso', () => {
  const start = '2026-08-10T15:00:00.000Z';
  const end = '2026-08-10T16:00:00.000Z';
  const midClass = new Date('2026-08-10T15:30:00.000Z');
  assertEqual(
    resolveDisplayableNextClassAt(start, midClass, end),
    start,
    'sigue mostrándose — la profesora está viendo la clase que está dando ahora mismo'
  );
});

test('P0) resolveDisplayableNextClassAt: recién se descarta cuando TAMBIÉN terminó (ahora >= end)', () => {
  const start = '2026-08-10T15:00:00.000Z';
  const end = '2026-08-10T16:00:00.000Z';
  assertEqual(resolveDisplayableNextClassAt(start, new Date(end), end), null, 'en el instante exacto del final, ya se descarta');
  assertEqual(resolveDisplayableNextClassAt(start, new Date('2026-08-10T16:05:00.000Z'), end), null, 'después del final, se descarta');
});

test('P0) resolveDisplayableNextClassAt: sin el final (dato viejo, de antes de esta corrección) conserva el comportamiento anterior EXACTO — nunca rompe', () => {
  assertEqual(
    resolveDisplayableNextClassAt(REMOTE_PAST_ISO, new Date('2026-08-20T00:00:00.000Z')),
    null,
    'sin nextClassEndAt, una fecha pasada se sigue rechazando tal cual antes'
  );
});

test('P0) formatNextClassLabel: con el final real conocido, muestra "Clase en curso" en vez de una fecha ya pasada o "Sin próxima clase"', () => {
  // `formatNextClassLabel` usa `new Date()` real internamente (no acepta un
  // reloj inyectado) — a diferencia del resto de las pruebas de este
  // archivo, acá los horarios se calculan relativos al reloj REAL del
  // momento en que corre la prueba, nunca una fecha fija.
  const realNow = Date.now();
  const start = new Date(realNow - 30 * 60_000).toISOString();
  const end = new Date(realNow + 30 * 60_000).toISOString();
  assertEqual(formatNextClassLabel(start, end), 'Clase en curso', 'texto exacto pedido');
});

test('P0) planNextClassAtRepairs: un alumno con nextClassAt correcto pero SIN nextClassEndAt (dato de antes de esta corrección) se repara para completar el final', () => {
  const rule = qaRule({
    recurrenceId: 'qa_missing_end_rule',
    studentId: 'qa_missing_end',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const now = new Date('2026-07-13T22:00:00.000Z');
  const repairs = planNextClassAtRepairs(
    [{ id: 'qa_missing_end', status: 'activo', nextClassAt: '2026-07-20T21:00:00.000Z' }], // sin nextClassEndAt
    [],
    [rule],
    [],
    now
  );
  assertEqual(repairs.length, 1, 'se repara para agregar el final que faltaba (dato legado)');
  assertEqual(repairs[0].canonicalNextClassEndAt, '2026-07-20T22:00:00.000Z', 'con el final real calculado');
});

test('P0) Home y perfil coinciden: mismo estudiante, mismas clases -> calculateCurrentOrNextClass y selectCurrentOrNextOccurrence (usado por buildDashboardData) eligen exactamente la misma ocurrencia', () => {
  const qaStudent = { id: 'qa_home_profile_match', status: 'activo' as const };
  const current = qaLesson({ id: 'qa_now', studentId: qaStudent.id, start: '2026-08-10T15:00:00.000Z', end: '2026-08-10T16:00:00.000Z' });
  const later = qaLesson({ id: 'qa_later', studentId: qaStudent.id, start: '2026-08-10T18:00:00.000Z', end: '2026-08-10T19:00:00.000Z' });
  const now = new Date('2026-08-10T15:30:00.000Z');

  // Perfil/lista de alumnos: vía calculateCurrentOrNextClass (persistido).
  const profileSide = calculateCurrentOrNextClass(qaStudent, [current, later], [], [], now);
  // Home: mismo criterio de selección puro, aplicado directo a las mismas clases del día.
  const homeSide = selectCurrentOrNextOccurrence(
    [current, later].map((l) => ({ start: l.start, end: l.end, status: l.status })),
    now
  );

  assertEqual(profileSide?.start, homeSide?.occurrence.start, 'mismo inicio elegido en las dos pantallas');
  assertEqual(profileSide?.timing, homeSide?.timing, 'mismo estado (en curso/próxima) en las dos pantallas');
});
