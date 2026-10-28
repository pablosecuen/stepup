// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarOccurrenceCounting.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie): pruebas puras de `countRuleOccurrencesInRange` —
 * cubre semanal fija, varios días por semana, ciclos de 2/3/4 semanas,
 * horario rotativo, deduplicación de ocurrencias materializadas,
 * diciembre→enero, meses de distinta duración, vacaciones/excepciones y
 * reprogramaciones (casos QA 8, 9, 10, 11, 12, 14, 23, 24, 27, 28).
 */
import type { CalendarLesson, RecurrenceException, RecurrenceRule, RecurrenceWeek } from '../../types/index.ts';
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { countRuleOccurrencesInRange, countRuleRealOccurrencesInRange, hasRuleOccurrenceForParticipantInPeriod, resolveEarliestParticipantOccurrenceDateInRange } from '../calendarOccurrenceCounting.ts';
import { generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function rule(overrides: Partial<RecurrenceRule> & { weeks: RecurrenceWeek[]; cycleLengthWeeks: 1 | 2 | 3 | 4 }): RecurrenceRule {
  return {
    recurrenceId: 'qa_rule',
    studentId: 'qa_student',
    participantIds: ['qa_student'],
    type: 'weekly',
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-01-05', // lunes
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

function emptyAvailability(): TeacherAvailability {
  return { schemaVersion: 1, timezone: BUENOS_AIRES, weeklyBlocks: [], exceptions: [] };
}

/** La clave real de la primera ocurrencia de `targetRule` en el rango — nunca se adivina/hardcodea el formato de `buildOccurrenceKey`. */
function realOccurrenceKeyOf(targetRule: RecurrenceRule, rangeStartDateKey: string, rangeEndDateKey: string): string {
  const rangeStart = new Date(`${rangeStartDateKey}T00:00:00.000Z`);
  const rangeEnd = new Date(`${rangeEndDateKey}T23:59:59.999Z`);
  const [occurrence] = generateOccurrences(targetRule, rangeStart, rangeEnd);
  assert(occurrence !== undefined, 'debe existir al menos una ocurrencia real en el rango de prueba');
  return occurrence.occurrenceKey;
}

// --- 8) Semanal fija --------------------------------------------------------
test('8) Semanal fija: cuenta EXACTAMENTE los lunes reales de agosto 2026 (5, no un número fijo inventado)', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const count = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  // Agosto 2026: lunes 03, 10, 17, 24, 31 -> 5 lunes reales.
  assertEqual(count, 5, 'agosto 2026 tiene 5 lunes reales — nunca un denominador fijo como 4');
});

// --- 9) Dos días por semana --------------------------------------------------
test('9) Dos días por semana: cada sesión semanal se cuenta por separado', () => {
  const twiceWeekRule = rule({
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }, // lunes
          { weekday: 2, hour: 18, minute: 0, durationMinutes: 60 }, // miércoles
        ],
      },
    ],
  });
  const count = countRuleOccurrencesInRange({
    rule: twiceWeekRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  // 5 lunes + 5 miércoles (05, 12, 19, 26 + 1) -> lunes:5, miércoles: 05,12,19,26 = 4 -> total 9.
  assertEqual(count, 9, 'suma las dos sesiones semanales reales del mes, nunca sólo una');
});

// --- 10) Ciclo de 2 semanas --------------------------------------------------
test('10) Ciclo de 2 semanas: sólo la semana del ciclo con sesión real cuenta', () => {
  const biweeklyRule = rule({
    cycleLengthWeeks: 2,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 1, hour: 17, minute: 0, durationMinutes: 60 }] }, // martes, semana par
      { weekIndex: 1, sessions: [] }, // semana impar del ciclo: sin clase
    ],
  });
  // startDate lunes 2026-01-05 -> weekIndex 0 empieza esa semana.
  const count = countRuleOccurrencesInRange({
    rule: biweeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-01-05',
    rangeEndDateKey: '2026-02-15', // 6 semanas reales
  });
  assertEqual(count, 3, 'sólo una de cada dos semanas tiene clase real — nunca cuenta la semana vacía del ciclo');
});

// --- 11) Ciclos de 3 y 4 semanas ---------------------------------------------
test('11a) Ciclo de 3 semanas: una sesión cada 3 semanas', () => {
  const triweeklyRule = rule({
    cycleLengthWeeks: 3,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 3, hour: 16, minute: 0, durationMinutes: 60 }] },
      { weekIndex: 1, sessions: [] },
      { weekIndex: 2, sessions: [] },
    ],
  });
  const count = countRuleOccurrencesInRange({
    rule: triweeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-01-05',
    rangeEndDateKey: '2026-03-30', // ~12 semanas -> 4 ocurrencias de ciclo 3
  });
  assertEqual(count, 4, 'una ocurrencia cada 3 semanas, respetando el patrón real del ciclo');
});

test('11b) Ciclo de 4 semanas: una sesión cada 4 semanas', () => {
  const fourWeekRule = rule({
    cycleLengthWeeks: 4,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 4, hour: 15, minute: 0, durationMinutes: 60 }] },
      { weekIndex: 1, sessions: [] },
      { weekIndex: 2, sessions: [] },
      { weekIndex: 3, sessions: [] },
    ],
  });
  const count = countRuleOccurrencesInRange({
    rule: fourWeekRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-01-05',
    rangeEndDateKey: '2026-04-27', // 16 semanas -> 4 ocurrencias de ciclo 4
  });
  assertEqual(count, 4, 'una ocurrencia cada 4 semanas, nunca más seguido que el ciclo real');
});

// --- 12) Horario rotativo ----------------------------------------------------
test('12) Horario rotativo: cada semana del ciclo puede tener un día/hora distinto, todas cuentan', () => {
  const rotatingRule = rule({
    cycleLengthWeeks: 2,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 0, hour: 9, minute: 0, durationMinutes: 60 }] }, // lunes 9hs
      { weekIndex: 1, sessions: [{ weekday: 4, hour: 17, minute: 0, durationMinutes: 60 }] }, // viernes 17hs
    ],
  });
  const count = countRuleOccurrencesInRange({
    rule: rotatingRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-01-05',
    rangeEndDateKey: '2026-02-15', // 6 semanas
  });
  assertEqual(count, 6, 'cada semana del ciclo aporta su propia sesión real, aunque el horario rote');
});

// --- 14) Ocurrencias duplicadas: nunca se cuentan dos veces ------------------
test('14) Una ocurrencia ya materializada (CalendarLesson real) no se cuenta dos veces', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const materialized: CalendarLesson = {
    id: 'lesson_materialized',
    studentId: 'qa_student',
    studentName: 'Alumno QA',
    level: 'B1',
    participants: [{ studentId: 'qa_student', studentName: 'Alumno QA', level: 'B1' }],
    lessonType: 'individual',
    start: '2026-08-03T21:00:00.000Z', // lunes 03/08 18hs AR
    end: '2026-08-03T22:00:00.000Z',
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: 'qa_rule',
    recurrenceOccurrenceKey: 'qa_rule:w0:c0:d0:t1800:s0',
    recurrenceIndex: 0,
    recurrenceOriginalStart: null,
  };
  const withoutMaterialized = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  const withMaterialized = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [materialized],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  assertEqual(withoutMaterialized, withMaterialized, 'la misma ocurrencia real cuenta una sola vez, materializada o no');
  assertEqual(withMaterialized, 1, 'un único lunes en ese rango de 9 días');
});

// --- 23) Diciembre a enero ---------------------------------------------------
test('23) El rango cruza diciembre -> enero sin perder ni duplicar ninguna ocurrencia real', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }], // martes
    startDate: '2026-01-05',
  });
  const count = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-12-15',
    rangeEndDateKey: '2027-01-15',
  });
  // Martes en ese rango: 15/12, 22/12, 29/12, 05/01, 12/01 -> 5.
  assertEqual(count, 5, 'cuenta correctamente cruzando el cambio de año');
});

// --- 24) Meses de 4 y 5 semanas ----------------------------------------------
test('24) Un mes de 5 semanas reales cuenta más ocurrencias que uno de 4, para el mismo patrón semanal', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], // lunes
    startDate: '2026-01-05',
  });
  // Febrero 2026: lunes 02, 09, 16, 23 -> 4 semanas reales.
  const february = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-02-01',
    rangeEndDateKey: '2026-02-28',
  });
  // Agosto 2026: lunes 03, 10, 17, 24, 31 -> 5 semanas reales.
  const august = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(february, 4, 'febrero real tiene 4 lunes');
  assertEqual(august, 5, 'agosto real tiene 5 lunes');
  assert(august > february, 'el conteo respeta la duración real de cada mes, nunca un valor fijo');
});

// --- 27) Vacaciones y excepciones --------------------------------------------
test('27a) Una excepción de disponibilidad "vacaciones" (día completo) excluye esa ocurrencia del conteo', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const availability: TeacherAvailability = {
    ...emptyAvailability(),
    exceptions: [
      { id: 'exc_1', date: '2026-08-10', type: 'unavailable_full_day', reason: 'vacation' },
    ],
  };
  const withoutVacation = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  const withVacation = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(withoutVacation - withVacation, 1, 'exactamente el lunes 10/08 (vacaciones) se excluye, ningún otro');
});

test('27b) Un bloqueo puntual con horario específico sólo excluye si se superpone con el horario real de la clase', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], // 18:00-19:00
  });
  const availabilityNoOverlap: TeacherAvailability = {
    ...emptyAvailability(),
    exceptions: [
      { id: 'exc_2', date: '2026-08-10', type: 'unavailable_block', startTime: '08:00', endTime: '09:00', reason: 'other' },
    ],
  };
  const countNoOverlap = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: availabilityNoOverlap,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  const availabilityWithOverlap: TeacherAvailability = {
    ...emptyAvailability(),
    exceptions: [
      { id: 'exc_3', date: '2026-08-10', type: 'unavailable_block', startTime: '17:30', endTime: '18:30', reason: 'other' },
    ],
  };
  const countWithOverlap = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: availabilityWithOverlap,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(countNoOverlap, 5, 'un bloqueo que no se superpone con el horario de la clase nunca la excluye');
  assertEqual(countWithOverlap, 4, 'un bloqueo que sí se superpone excluye esa única ocurrencia');
});

// --- 28) Reprogramación: no duplica clases en el cálculo ---------------------
test('28) Una ocurrencia reprogramada (excepción type "rescheduled") se excluye de su slot original, sin duplicar', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const exceptions: RecurrenceException[] = [
    {
      occurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-01', '2026-08-09'),
      recurrenceId: 'qa_rule',
      type: 'rescheduled',
      replacementLessonId: 'lesson_rescheduled_target',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const withoutReschedule = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  const withReschedule = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions,
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  assertEqual(withoutReschedule, 1, 'sin reprogramar, el lunes 03/08 cuenta');
  assertEqual(withReschedule, 0, 'reprogramada: el slot original nunca cuenta como clase real ahí');
});

test('28b) Una excepción "cancelled" tampoco cuenta, mismo criterio que "rescheduled"', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const exceptions: RecurrenceException[] = [
    {
      occurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-01', '2026-08-09'),
      recurrenceId: 'qa_rule',
      type: 'cancelled',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const count = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions,
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  assertEqual(count, 0, 'cancelada: nunca cuenta como clase real habitual');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
// ENTRENAMIENTOS): `hasRuleOccurrenceForParticipantInPeriod` — a diferencia
// de `countRuleOccurrencesInRange` (cuenta ocurrencias de la regla sin mirar
// de quién), ésta responde "¿participó ESTE alumno en al menos una
// ocurrencia real?", considerando que el roster puede cambiar a mitad de
// camino (`calendarParticipantsFromDate.ts`) y que una regla ya finalizada
// (`status !== 'active'`) igual conserva sus ocurrencias YA materializadas
// como hecho histórico.
// ---------------------------------------------------------------------------

function lesson(overrides: Partial<CalendarLesson> & { start: string; participants: CalendarLesson['participants'] }): CalendarLesson {
  return {
    id: `qa_lesson_${overrides.start}`,
    studentId: overrides.participants[0]?.studentId ?? '',
    studentName: overrides.participants[0]?.studentName ?? '',
    level: '',
    lessonType: overrides.participants.length > 1 ? 'group' : 'individual',
    end: overrides.start,
    modality: 'presencial',
    status: 'scheduled',
    color: '#000000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: 'qa_rule',
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  };
}

test('29) Entrenamiento semanal: el alumno actual del roster participa en cada ocurrencia virtual del período', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assert(result, 'el alumno del roster actual participa de las ocurrencias virtuales del mes');
});

test('30) Un alumno que NUNCA estuvo en el roster ni en ninguna clase materializada no participa', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: weeklyRule,
    studentId: 'qa_alumno_ajeno',
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assert(!result, 'un alumno ajeno a la serie nunca participa');
});

test('31) Alumno retirado a mitad de mes: SIGUE contando el mes porque una clase materializada anterior lo tenía en su roster congelado', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_2'], // roster ACTUAL: ya no incluye a qa_alumno_1 (fue retirado)
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const frozenLesson = lesson({
    start: '2026-08-03T18:00:00.000-03:00',
    recurrenceOccurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-01', '2026-08-31'),
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
  });
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [frozenLesson],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assert(result, 'la clase ya materializada con el roster viejo demuestra que sí participó ese mes, aunque ya no esté en el roster actual');
});

test('32) Serie ya finalizada (status: ended): una clase materializada ANTES de finalizar sigue contando ese mes', () => {
  const activeVariant = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const realKey = realOccurrenceKeyOf(activeVariant, '2026-08-01', '2026-08-31');
  const endedRule = { ...activeVariant, status: 'ended' as const };
  const materialized = lesson({
    start: '2026-08-03T18:00:00.000-03:00',
    recurrenceOccurrenceKey: realKey,
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
  });
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: endedRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [materialized],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assert(result, 'un hecho ya materializado no desaparece porque la regla se haya finalizado después');
});

test('33) Serie finalizada ANTES de que empezara el mes evaluado: sin ninguna ocurrencia materializada, no cuenta (ni virtual ni real)', () => {
  const endedRule = rule({
    cycleLengthWeeks: 1,
    status: 'ended',
    endDate: '2026-07-31',
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: endedRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assert(!result, 'sin ninguna ocurrencia real ni materializada en agosto, la serie finalizada no genera nada para ese mes');
});

test('34) Una clase cancelada no cuenta como participación real, aunque el alumno esté en su roster congelado', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const cancelledLesson = lesson({
    start: '2026-08-03T18:00:00.000-03:00',
    recurrenceOccurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-01', '2026-08-09'),
    status: 'cancelled',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
  });
  // Rango acotado a esa única semana (mismo criterio que la prueba 28b de
  // arriba): aísla exactamente la ocurrencia cancelada, sin que otro lunes
  // real del mismo mes contamine el resultado.
  const result = hasRuleOccurrenceForParticipantInPeriod({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [cancelledLesson],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-09',
  });
  assert(!result, 'una clase cancelada nunca demuestra participación real');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
// ENTRENAMIENTOS): pruebas de `resolveEarliestParticipantOccurrenceDateInRange`
// y `countRuleRealOccurrencesInRange` — la doble fuente (materializadas +
// virtuales) generalizada de "alguna vez"/booleano a "cuándo"/"cuántas".
// ---------------------------------------------------------------------------

test('35) resolveEarliestParticipantOccurrenceDateInRange: encuentra la fecha real MÁS TEMPRANA en la que el alumno participa (ocurrencias virtuales)', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const earliest = resolveEarliestParticipantOccurrenceDateInRange({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(earliest, '2026-08-03', 'el primer lunes real de agosto 2026');
});

test('36) resolveEarliestParticipantOccurrenceDateInRange: un alumno incorporado a mitad de una serie ya activa devuelve su fecha real de incorporación, nunca el inicio de la serie', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1', 'qa_alumno_2'], // roster ACTUAL: ambos, pero qa_alumno_2 se incorporó recién el 17/8.
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const oldRosterLessons: CalendarLesson[] = [
    lesson({
      start: '2026-08-03T18:00:00.000-03:00',
      recurrenceOccurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-03', '2026-08-03'),
      participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }], // roster viejo: sin qa_alumno_2.
    }),
    lesson({
      start: '2026-08-10T18:00:00.000-03:00',
      recurrenceOccurrenceKey: realOccurrenceKeyOf(weeklyRule, '2026-08-10', '2026-08-10'),
      participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }], // roster viejo: sin qa_alumno_2.
    }),
  ];
  const earliestForNewcomer = resolveEarliestParticipantOccurrenceDateInRange({
    rule: weeklyRule,
    studentId: 'qa_alumno_2',
    exceptions: [],
    existingLessons: oldRosterLessons,
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(earliestForNewcomer, '2026-08-17', 'primera fecha real donde SÍ participa: el primer lunes NO materializado con roster viejo (17/8), nunca el 3/8 (inicio de la serie)');

  const earliestForOriginal = resolveEarliestParticipantOccurrenceDateInRange({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: oldRosterLessons,
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(earliestForOriginal, '2026-08-03', 'el alumno original sigue con su fecha real de siempre, sin verse afectado por el alta del otro');
});

test('37) resolveEarliestParticipantOccurrenceDateInRange: sin ninguna ocurrencia real del alumno en el rango, devuelve null (nunca inventa una fecha)', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_2'], // el alumno buscado nunca está en el roster actual, ni hay clases materializadas con él.
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const earliest = resolveEarliestParticipantOccurrenceDateInRange({
    rule: weeklyRule,
    studentId: 'qa_alumno_1',
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(earliest, null, 'sin evidencia real de participación, nunca se inventa una fecha');
});

test('38) countRuleRealOccurrencesInRange: una serie ya FINALIZADA sigue contando sus clases YA MATERIALIZADAS (countRuleOccurrencesInRange original las pierde, por eso existe esta variante)', () => {
  const activeVariant = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const realKey = realOccurrenceKeyOf(activeVariant, '2026-08-01', '2026-08-31');
  const endedRule = { ...activeVariant, status: 'ended' as const };
  const materialized = lesson({
    start: '2026-08-03T18:00:00.000-03:00',
    recurrenceOccurrenceKey: realKey,
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
  });

  const withOriginal = countRuleOccurrencesInRange({
    rule: endedRule,
    exceptions: [],
    existingLessons: [materialized],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(withOriginal, 0, 'la función original pierde la clase ya materializada de una regla no activa (límite documentado)');

  const withReal = countRuleRealOccurrencesInRange({
    rule: endedRule,
    exceptions: [],
    existingLessons: [materialized],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(withReal, 1, 'la variante nueva sí cuenta la clase real ya materializada, aunque la regla ya no esté activa');
});

test('39) countRuleRealOccurrencesInRange: para una regla ACTIVA sin clases materializadas, cuenta exactamente lo mismo que countRuleOccurrencesInRange (nunca duplica)', () => {
  const weeklyRule = rule({
    cycleLengthWeeks: 1,
    participantIds: ['qa_alumno_1'],
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  });
  const original = countRuleOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  const real = countRuleRealOccurrencesInRange({
    rule: weeklyRule,
    exceptions: [],
    existingLessons: [],
    availability: null,
    rangeStartDateKey: '2026-08-01',
    rangeEndDateKey: '2026-08-31',
  });
  assertEqual(original, 5, 'cinco lunes reales en agosto 2026');
  assertEqual(real, original, 'sin materializadas, ambas funciones cuentan exactamente lo mismo — nunca duplica');
});
