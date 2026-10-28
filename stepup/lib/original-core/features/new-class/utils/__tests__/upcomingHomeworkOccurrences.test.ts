// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/upcomingHomeworkOccurrences.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E INTUITIVO
 * DEL REGISTRO DE CLASES, §11: entrega basada en próximas clases reales).
 * Identidades ficticias `qa_*`.
 */
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../../calendar/types/index.ts';
import { generateOccurrences } from '../../../calendar/utils/calendarRecurrenceEngine.ts';
import { listUpcomingOccurrencesForDueDate } from '../upcomingHomeworkOccurrences.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const NOW = new Date('2026-08-12T12:00:00.000Z');

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'qa_rule_1',
    studentId: 'qa_alumno_1',
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-08-10', // lunes
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

function lesson(overrides: Partial<CalendarLesson> & { id: string; start: string; end: string }): CalendarLesson {
  return {
    studentId: 'qa_alumno_1',
    studentName: 'Alumno QA',
    level: 'B1',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno QA', level: 'B1' }],
    lessonType: 'individual',
    modality: 'online',
    status: 'scheduled',
    color: '#DDEBFF',
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

test('1) Devuelve sólo fechas posteriores a la clase actual (afterIso)', () => {
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T18:00:00.000Z',
    now: NOW,
    lessons: [
      lesson({ id: 'qa_past', start: '2026-08-05T18:00:00.000Z', end: '2026-08-05T19:00:00.000Z' }),
      lesson({ id: 'qa_future', start: '2026-08-17T18:00:00.000Z', end: '2026-08-17T19:00:00.000Z' }),
    ],
    recurrenceRules: [],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
  });
  assertEqual(options.length, 1, 'sólo la clase futura queda');
  assertEqual(options[0].iso, '2026-08-17T18:00:00.000Z', 'la clase pasada se excluye');
});

test('2) Excluye clases canceladas', () => {
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T18:00:00.000Z',
    now: NOW,
    lessons: [
      lesson({ id: 'qa_cancelled', start: '2026-08-17T18:00:00.000Z', end: '2026-08-17T19:00:00.000Z', status: 'cancelled' }),
      lesson({ id: 'qa_ok', start: '2026-08-24T18:00:00.000Z', end: '2026-08-24T19:00:00.000Z' }),
    ],
    recurrenceRules: [],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
  });
  assertEqual(options.length, 1, 'la cancelada nunca se ofrece como entrega');
  assertEqual(options[0].iso, '2026-08-24T18:00:00.000Z', 'sólo la vigente queda');
});

test('3) Incluye ocurrencias generadas por una serie recurrente (virtuales)', () => {
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T21:00:00.000Z',
    now: NOW,
    lessons: [],
    recurrenceRules: [rule()],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
    horizonDays: 30,
  });
  assert(options.length >= 2, 'la serie semanal genera varias ocurrencias virtuales futuras');
  const sorted = [...options].sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  assertEqual(options.map((o) => o.iso).join(','), sorted.map((o) => o.iso).join(','), 'ya vienen ordenadas cronológicamente');
});

test('4) Una ocurrencia reprogramada aparece en su horario NUEVO, nunca en el viejo', () => {
  // La clave real de la ocurrencia del 2026-08-17 se descubre generándola
  // de verdad (nunca se adivina a mano — `absoluteWeekNumber` depende de
  // una convención interna del motor que esta prueba no debe duplicar).
  const generated = generateOccurrences(rule(), new Date('2026-08-15T00:00:00.000Z'), new Date('2026-08-19T00:00:00.000Z'));
  assertEqual(generated.length, 1, 'la prueba asume exactamente 1 ocurrencia generada en esa ventana');
  const originalOccurrenceKey = generated[0].occurrenceKey;
  assertEqual(generated[0].start, '2026-08-17T21:00:00.000Z', 'confirma que es la ocurrencia esperada antes de reprogramarla');

  const rescheduledLesson = lesson({
    id: 'qa_rescheduled',
    start: '2026-08-18T21:00:00.000Z',
    end: '2026-08-18T22:00:00.000Z',
    status: 'rescheduled',
    recurrenceId: 'qa_rule_1',
    recurrenceOccurrenceKey: originalOccurrenceKey,
  });
  const exceptions: RecurrenceException[] = [
    {
      recurrenceId: 'qa_rule_1',
      occurrenceKey: originalOccurrenceKey,
      type: 'rescheduled',
      replacementLessonId: rescheduledLesson.id,
      createdAt: '2026-08-12T00:00:00.000Z',
    },
  ];
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T21:00:00.000Z',
    now: NOW,
    lessons: [rescheduledLesson],
    recurrenceRules: [rule()],
    recurrenceExceptions: exceptions,
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
    horizonDays: 14,
  });
  const isos = options.map((o) => o.iso);
  assert(isos.includes('2026-08-18T21:00:00.000Z'), 'aparece en el horario nuevo');
  assert(!isos.includes('2026-08-17T21:00:00.000Z'), 'nunca en el horario original reemplazado');
});

test('5) Nunca duplica: la misma ocurrencia no aparece dos veces aunque exista como materializada y como virtual', () => {
  const materialized = lesson({
    id: 'qa_dup',
    start: '2026-08-17T21:00:00.000Z',
    end: '2026-08-17T22:00:00.000Z',
    recurrenceId: 'qa_rule_1',
    recurrenceOccurrenceKey: 'qa_rule_1:w0:c0:d0:t1800:s0',
  });
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T21:00:00.000Z',
    now: NOW,
    lessons: [materialized],
    recurrenceRules: [rule()],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
    horizonDays: 14,
  });
  const occurrenceKeys = options.map((o) => o.occurrenceKey);
  assertEqual(new Set(occurrenceKeys).size, occurrenceKeys.length, 'ninguna ocurrencia se repite');
});

test('6) Diferencia individual (por alumno) de grupo (por serie): scope "series" nunca mezcla clases de otro alumno/serie', () => {
  const otherStudentLesson = lesson({
    id: 'qa_other',
    start: '2026-08-19T18:00:00.000Z',
    end: '2026-08-19T19:00:00.000Z',
    studentId: 'qa_alumno_2',
    participants: [{ studentId: 'qa_alumno_2', studentName: 'Otro alumno', level: 'B1' }],
  });
  const sameSeriesLesson = lesson({
    id: 'qa_series',
    start: '2026-08-20T18:00:00.000Z',
    end: '2026-08-20T19:00:00.000Z',
    recurrenceId: 'qa_rule_group',
  });
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T18:00:00.000Z',
    now: NOW,
    lessons: [otherStudentLesson, sameSeriesLesson],
    recurrenceRules: [],
    recurrenceExceptions: [],
    scope: { kind: 'series', recurrenceId: 'qa_rule_group' },
  });
  assertEqual(options.length, 1, 'sólo la clase de la serie pedida queda');
  assertEqual(options[0].iso, '2026-08-20T18:00:00.000Z', 'nunca mezcla clases de otra serie/alumno');
});

test('7) Acota a maxResults sin perder el orden cronológico', () => {
  const lessons = [1, 2, 3, 4, 5].map((n) =>
    lesson({ id: `qa_l${n}`, start: `2026-08-${10 + n}T18:00:00.000Z`, end: `2026-08-${10 + n}T19:00:00.000Z` })
  );
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T00:00:00.000Z',
    now: NOW,
    lessons,
    recurrenceRules: [],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
    maxResults: 3,
  });
  assertEqual(options.length, 3, 'respeta el máximo pedido');
  assertEqual(options[0].iso, '2026-08-11T18:00:00.000Z', 'conserva las 3 más próximas, en orden');
});

test('8) Sin ninguna próxima clase real, devuelve una lista vacía (la pantalla ofrece "Sin fecha de entrega")', () => {
  const options = listUpcomingOccurrencesForDueDate({
    afterIso: '2026-08-10T18:00:00.000Z',
    now: NOW,
    lessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    scope: { kind: 'student', studentId: 'qa_alumno_1' },
  });
  assertEqual(options.length, 0, 'lista vacía, nunca inventa una fecha');
});
