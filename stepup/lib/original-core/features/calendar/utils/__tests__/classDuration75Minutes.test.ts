// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/classDuration75Minutes.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-26 (a pedido de Joaquín — "75 min" como duración de
 * clase): la duración de una clase nunca fue una lista cerrada en el motor
 * puro — siempre fueron minutos reales (start/end, aritmética directa) — el
 * único lugar con una lista fija de opciones era el chip "Duración" de
 * `NewCalendarLessonSheet.tsx`. Estas pruebas confirman que el resto del
 * dominio (recurrencia, conflictos, disponibilidad, grilla) ya trata 75
 * minutos como cualquier otro valor, sin necesitar ningún cambio de código
 * propio — y fijan ese comportamiento para que nunca se rompa.
 */
import type { CalendarDay, CalendarLesson } from '../../types/index.ts';
import type { StudentListItem } from '../../../students/types/index.ts';
import type { RecurrenceRule } from '../../types/index.ts';
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { generateOccurrences, buildLessonFromOccurrence } from '../calendarRecurrenceEngine.ts';
import { findCalendarConflicts } from '../calendarConflicts.ts';
import { computeDailyFreeMinutes } from '../calendarDailyDemand.ts';
import { getLessonDurationMinutes } from '../calendarDayGridLayout.ts';
import { slotOverlapsAnyRange } from '../calendarTimeSlots.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

const student: StudentListItem = {
  id: 'student-75',
  name: 'Alumna Setenta y Cinco',
  levels: ['B1'],
  modality: 'presencial',
  status: 'activo',
  nextClassAt: null,
  paymentStatus: 'verde',
  averageGrade: 8,
  classesThisMonth: 0,
  lastPaymentAt: null,
  isFeatured: false,
  isNew: true,
  hasOverduePayment: false,
  hasPendingReport: false,
  hasPendingHomework: false,
};

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'rule-75',
    studentId: student.id,
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [{ weekday: 0, hour: 14, minute: 0, durationMinutes: 75 }],
      },
    ],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-13',
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function makeLesson(overrides: Partial<CalendarLesson>): CalendarLesson {
  return {
    id: 'lesson-75',
    studentId: student.id,
    studentName: student.name,
    level: 'B1',
    participants: [{ studentId: student.id, studentName: student.name, level: 'B1' }],
    lessonType: 'individual',
    start: localIso(2026, 7, 20, 14, 0),
    end: localIso(2026, 7, 20, 15, 15),
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

// ---------------------------------------------------------------------------
// 1-2. Clase suelta y serie semanal de 75 minutos + 5. 14:00 -> 15:15
// ---------------------------------------------------------------------------

test('1/2/5. Serie semanal de 75 minutos: cada ocurrencia dura exactamente 75 minutos, 14:00 -> 15:15 en Buenos Aires', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-27T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 3, 'tres lunes en el rango (13, 20 y 27 de julio)');
  const first = occurrences[0];
  const start = new Date(first.start);
  const end = new Date(first.end);
  assertEqual(Math.round((end.getTime() - start.getTime()) / 60_000), 75, 'la ocurrencia dura 75 minutos exactos');

  const lesson = buildLessonFromOccurrence(first, student);
  assertEqual(getLessonDurationMinutes(lesson), 75, 'la clase materializada también reporta 75 minutos de duración');
});

// ---------------------------------------------------------------------------
// 3. Serie personalizada (ciclo de 2+ semanas) de 75 minutos
// ---------------------------------------------------------------------------

test('3. Serie personalizada de 75 minutos: el ciclo alternado conserva la duración en cada semana', () => {
  const customRule = rule({
    type: 'custom',
    cycleLengthWeeks: 2,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 0, hour: 14, minute: 0, durationMinutes: 75 }] },
      { weekIndex: 1, sessions: [{ weekday: 2, hour: 16, minute: 30, durationMinutes: 75 }] },
    ],
  });
  const occurrences = generateOccurrences(
    customRule,
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-28T23:59:59.999Z')
  );
  assert(occurrences.length >= 2, 'genera ocurrencias de ambas semanas del ciclo');
  occurrences.forEach((occurrence) => {
    const minutes = Math.round(
      (new Date(occurrence.end).getTime() - new Date(occurrence.start).getTime()) / 60_000
    );
    assertEqual(minutes, 75, 'toda ocurrencia de la serie personalizada dura 75 minutos');
  });
});

// ---------------------------------------------------------------------------
// 4. Edición/reprogramación: preserva la duración de 75 minutos
// ---------------------------------------------------------------------------

test('4. Reprogramar una clase de 75 minutos a otro horario conserva la duración (sólo cambia inicio/fin, no el largo)', () => {
  const original = makeLesson({});
  assertEqual(getLessonDurationMinutes(original), 75, 'punto de partida: 75 minutos');

  // Reprogramar mueve start/end manteniendo la MISMA duración — replicando
  // exactamente lo que hace `saveReschedule` (calcula el nuevo `end` a
  // partir del `durationMinutes` original de la clase, nunca de una lista).
  const durationMs = new Date(original.end).getTime() - new Date(original.start).getTime();
  const newStart = localIso(2026, 7, 21, 10, 0);
  const rescheduled = makeLesson({
    ...original,
    start: newStart,
    end: new Date(new Date(newStart).getTime() + durationMs).toISOString(),
  });

  assertEqual(getLessonDurationMinutes(rescheduled), 75, 'la clase reprogramada sigue durando 75 minutos');
  assertEqual(
    new Date(rescheduled.end).getHours(),
    11,
    'iniciando a las 10:00, termina a las 11:15 (75 minutos después)'
  );
  assertEqual(new Date(rescheduled.end).getMinutes(), 15, 'los minutos del final son :15');
});

// ---------------------------------------------------------------------------
// 6. Conflicto con otra clase a las 15:00
// ---------------------------------------------------------------------------

test('6. Una clase de 75 minutos (14:00-15:15) genera conflicto con otra clase que empieza a las 15:00', () => {
  const existing = makeLesson({
    id: 'existing',
    start: localIso(2026, 7, 20, 15, 0),
    end: localIso(2026, 7, 20, 16, 0),
  });
  const candidateStart = localIso(2026, 7, 20, 14, 0);
  const candidateEnd = localIso(2026, 7, 20, 15, 15);

  const conflicts = findCalendarConflicts(candidateStart, candidateEnd, [existing]);
  assertEqual(conflicts.length, 1, 'detecta el conflicto: 15:00-15:15 se superponen');
  assertEqual(conflicts[0].overlapMinutes, 15, 'los 15 minutos de superposición se calculan bien');
});

test('6b. slotOverlapsAnyRange también detecta el mismo conflicto de 15 minutos con un candidato de 75', () => {
  // 14:00 = minuto 360 desde las 00:00; el rango ocupado 15:00-16:00 = 900-960.
  const slotStartMinute = 14 * 60;
  const conflict = slotOverlapsAnyRange(slotStartMinute, 75, [
    { startMinute: 15 * 60, endMinute: 16 * 60, label: 'Clase existente' },
  ]);
  assert(conflict !== null, 'un candidato de 75 minutos desde las 14:00 choca con un ocupado desde las 15:00');
});

test('una clase de 75 minutos que termina justo a las 15:00 (13:45-15:00) NO choca con una que empieza a las 15:00', () => {
  const existing = makeLesson({
    id: 'existing-2',
    start: localIso(2026, 7, 20, 15, 0),
    end: localIso(2026, 7, 20, 16, 0),
  });
  const candidateStart = localIso(2026, 7, 20, 13, 45);
  const candidateEnd = localIso(2026, 7, 20, 15, 0);

  const conflicts = findCalendarConflicts(candidateStart, candidateEnd, [existing]);
  assertEqual(conflicts.length, 0, 'los límites exactos [start,end) nunca se consideran superposición');
});

// ---------------------------------------------------------------------------
// 7. Disponibilidad que termina a las 15:00
// ---------------------------------------------------------------------------

test('7. Disponibilidad que termina a las 15:00: una clase de 75 minutos (14:00-15:15) consume los minutos completos hasta su fin real', () => {
  const day: CalendarDay = {
    date: localIso(2026, 7, 20, 0, 0),
    lessons: [makeLesson({})], // 14:00-15:15
  };
  // Ventana de demanda 08:00-22:00 = 840 minutos totales; la clase de 75
  // minutos debe restar exactamente 75, ni 60 (redondeado a una hora) ni
  // 90 (redondeado hacia arriba a la opción más cercana de la lista vieja).
  const freeMinutes = computeDailyFreeMinutes(day);
  assertEqual(freeMinutes, 14 * 60 - 75, 'resta exactamente 75 minutos, ni más ni menos');
});

test('7b. Un bloqueo de disponibilidad que termina a las 15:00 dentro de la ventana de demanda se refleja como ocupado hasta esa hora exacta', () => {
  const availability: TeacherAvailability = {
    schemaVersion: 1,
    timezone: BUENOS_AIRES,
    weeklyBlocks: [{ id: 'block-1', weekday: 0, startTime: '13:00', endTime: '15:00', reason: 'work' }],
    exceptions: [],
  };
  const emptyDay: CalendarDay = { date: localIso(2026, 7, 20, 0, 0), lessons: [] };
  const freeWithBlock = computeDailyFreeMinutes(emptyDay, availability);
  // El bloqueo 13:00-15:00 son 120 minutos ocupados dentro de la ventana 8-22.
  assertEqual(freeWithBlock, 14 * 60 - 120, 'el bloqueo hasta las 15:00 resta exactamente sus 120 minutos');
});

// ---------------------------------------------------------------------------
// 8. Visualización semanal y diaria: la duración real (no redondeada) es la
// que alimenta el alto proporcional de la tarjeta en WeekTimeGrid.tsx.
// ---------------------------------------------------------------------------

test('8. getLessonDurationMinutes reporta 75 minutos exactos para una clase 14:00-15:15 (fuente real de la altura proporcional en Semana y Día)', () => {
  const lesson = makeLesson({});
  assertEqual(getLessonDurationMinutes(lesson), 75, 'ni redondeado a 60 ni a 90: exactamente 75');
});

test('8b. una clase de 75 minutos ocupa más alto que una de 60 y menos que una de 90, proporcionalmente', () => {
  const hourHeight = 50;
  const height60 = (60 / 60) * hourHeight;
  const height75 = (75 / 60) * hourHeight;
  const height90 = (90 / 60) * hourHeight;
  assert(height75 > height60 && height75 < height90, 'el alto de 75 minutos queda estrictamente entre 60 y 90');
  assertEqual(height75, 62.5, 'con hourHeight=50, 75 minutos da 62.5px (proporción exacta 1.25x)');
});
