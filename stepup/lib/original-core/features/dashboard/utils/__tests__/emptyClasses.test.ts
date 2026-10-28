// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/emptyClasses.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceRule } from '../../../calendar/types/index.ts';
import { buildEmptyClassesSummary } from '../emptyClasses.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function rule(overrides: Partial<RecurrenceRule> & { recurrenceId: string }): RecurrenceRule {
  return {
    studentId: '',
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    modality: 'presencial',
    timezone: 'America/Argentina/Buenos_Aires',
    startDate: '2026-07-13',
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

function lesson(overrides: Partial<CalendarLesson> & { id: string; start: string; end: string }): CalendarLesson {
  return {
    studentId: '',
    studentName: 'Sin alumnos',
    level: '',
    participants: [],
    lessonType: 'individual',
    modality: 'presencial',
    status: 'scheduled',
    color: '#000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  } as CalendarLesson;
}

const NOW = new Date('2026-07-20T12:00:00.000Z');

test('serie recurrente vacía cuenta UNA sola vez, nunca una por ocurrencia futura', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '' })],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.emptySeriesCount, 1, 'una sola serie vacía, sin importar cuántas ocurrencias futuras genere');
});

test('serie con alumno asignado (studentId) no cuenta como vacía', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: 'student-1' })],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.emptySeriesCount, 0, 'tiene alumno, no es una serie vacía');
});

test('serie con participantIds pero sin studentId (grupal recién creada) no cuenta como vacía', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: 'student-1', participantIds: ['student-1', 'student-2'] })],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.emptySeriesCount, 0, 'tiene participantes reales, no es una serie vacía');
});

test('serie pausada o terminada nunca cuenta como vacía activa', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [
      rule({ recurrenceId: 'r1', studentId: '', status: 'paused' }),
      rule({ recurrenceId: 'r2', studentId: '', status: 'ended' }),
    ],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.emptySeriesCount, 0, 'sólo cuentan series activas');
});

test('clase suelta futura sin alumnos cuenta individualmente', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [],
    lessons: [
      lesson({ id: 'l1', start: '2026-07-25T18:00:00.000Z', end: '2026-07-25T19:00:00.000Z' }),
      lesson({ id: 'l2', start: '2026-07-26T18:00:00.000Z', end: '2026-07-26T19:00:00.000Z' }),
    ],
    now: NOW,
  });
  assertEqual(summary.standaloneEmptyLessonCount, 2, 'dos clases sueltas vacías, cada una cuenta');
});

test('clase suelta pasada sin alumnos nunca cuenta (ya no ocupa nada útil que revisar)', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [],
    lessons: [lesson({ id: 'l1', start: '2026-07-01T18:00:00.000Z', end: '2026-07-01T19:00:00.000Z' })],
    now: NOW,
  });
  assertEqual(summary.standaloneEmptyLessonCount, 0, 'una clase suelta vacía que ya pasó no genera aviso');
});

test('una ocurrencia materializada de una serie (isRecurring: true) nunca se cuenta como clase suelta, para no duplicar el mismo vacío', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '' })],
    lessons: [
      lesson({
        id: 'l1',
        start: '2026-07-27T18:00:00.000Z',
        end: '2026-07-27T19:00:00.000Z',
        isRecurring: true,
        recurrenceId: 'r1',
      }),
    ],
    now: NOW,
  });
  assertEqual(summary.emptySeriesCount, 1, 'la serie cuenta una vez');
  assertEqual(summary.standaloneEmptyLessonCount, 0, 'la ocurrencia materializada de esa misma serie no se duplica como clase suelta');
});

test('clase cancelada o con alumnos nunca cuenta como vacía', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [],
    lessons: [
      lesson({ id: 'l1', start: '2026-07-25T18:00:00.000Z', end: '2026-07-25T19:00:00.000Z', status: 'cancelled' }),
      lesson({
        id: 'l2',
        start: '2026-07-25T18:00:00.000Z',
        end: '2026-07-25T19:00:00.000Z',
        studentId: 'student-1',
        participants: [{ studentId: 'student-1', studentName: 'Juan', level: 'B1' }],
      }),
    ],
    now: NOW,
  });
  assertEqual(summary.standaloneEmptyLessonCount, 0, 'ni la cancelada ni la que ya tiene alumno cuentan');
});

test('sin nada vacío: todo en cero, sin errores', () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [], lessons: [], now: NOW });
  assertEqual(summary.emptySeriesCount, 0, 'sin series');
  assertEqual(summary.standaloneEmptyLessonCount, 0, 'sin clases sueltas');
  assertEqual(summary.items.length, 0, 'sin ítems');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-22 (flujo clases→alumnos, §A/§I): cada ítem ahora es
// navegable con identidad estable (lessonId, o recurrenceId+occurrenceKey).
// ---------------------------------------------------------------------------

test('un ítem de clase suelta lleva su lessonId real, título y fecha', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [],
    lessons: [lesson({ id: 'l1', start: '2026-07-25T18:00:00.000Z', end: '2026-07-25T19:00:00.000Z' })],
    now: NOW,
  });
  assertEqual(summary.items.length, 1, 'un ítem');
  const item = summary.items[0];
  assertEqual(item.kind, 'standalone', 'es una clase suelta');
  assertEqual(item.lessonId, 'l1', 'lleva el id real de la clase');
  assertEqual(item.startIso, '2026-07-25T18:00:00.000Z', 'lleva la fecha real');
  assertEqual(item.recurrenceId, undefined, 'una clase suelta nunca lleva recurrenceId');
});

test('un ítem de serie vacía lleva la ocurrencia futura más próxima, nunca la serie entera', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '' })],
    lessons: [],
    recurrenceExceptions: [],
    now: NOW,
  });
  assertEqual(summary.items.length, 1, 'un solo ítem para toda la serie');
  const item = summary.items[0];
  assertEqual(item.kind, 'series', 'es una serie');
  assertEqual(item.recurrenceId, 'r1', 'lleva el id de la serie');
  assert(!!item.occurrenceKey, 'lleva la clave de la ocurrencia exacta a la que navegar');
  assert(new Date(item.startIso).getTime() >= NOW.getTime(), 'la ocurrencia elegida es futura, nunca pasada');
});

test('una serie vacía sin ninguna ocurrencia futura dentro del horizonte no genera ítem (nada a dónde navegar)', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '', endDate: '2026-07-15' })],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.items.length, 0, 'la serie ya terminó, no hay ocurrencia futura que ofrecer');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-01 (nombre editable de la clase): un título propio
// reemplaza el texto genérico incluso sin alumnos todavía.
// ---------------------------------------------------------------------------

test('serie vacía CON título propio muestra ese título en vez del texto genérico', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '', classTitle: 'Grupo de conversación' })],
    lessons: [],
    now: NOW,
  });
  assertEqual(summary.items.length, 1, 'un ítem');
  assertEqual(summary.items[0].title, 'Grupo de conversación', 'usa el título propio de la serie');
});

test('clase suelta vacía CON título propio muestra ese título en vez del texto genérico', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [],
    lessons: [
      lesson({
        id: 'l1',
        start: '2026-07-25T18:00:00.000Z',
        end: '2026-07-25T19:00:00.000Z',
        classTitle: 'Prueba de nivel',
      }),
    ],
    now: NOW,
  });
  assertEqual(summary.items[0].title, 'Prueba de nivel', 'usa el título propio de la clase suelta');
});

test('sin título propio, sigue el texto genérico distinto para serie y clase suelta', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '' })],
    lessons: [lesson({ id: 'l1', start: '2026-07-25T18:00:00.000Z', end: '2026-07-25T19:00:00.000Z' })],
    now: NOW,
  });
  const seriesItem = summary.items.find((item) => item.kind === 'series');
  const standaloneItem = summary.items.find((item) => item.kind === 'standalone');
  assertEqual(seriesItem!.title, 'Serie recurrente sin alumnos', 'texto genérico de serie sin título');
  assertEqual(standaloneItem!.title, 'Clase suelta sin alumnos', 'texto genérico de clase suelta sin título');
});

test('los ítems quedan ordenados por fecha ascendente, mezclando series y clases sueltas', () => {
  const summary = buildEmptyClassesSummary({
    recurrenceRules: [rule({ recurrenceId: 'r1', studentId: '' })],
    lessons: [lesson({ id: 'l1', start: '2026-07-21T10:00:00.000Z', end: '2026-07-21T11:00:00.000Z' })],
    now: NOW,
  });
  assertEqual(summary.items.length, 2, 'un ítem de serie + uno suelto');
  assert(
    new Date(summary.items[0].startIso).getTime() <= new Date(summary.items[1].startIso).getTime(),
    'orden ascendente por fecha'
  );
});
