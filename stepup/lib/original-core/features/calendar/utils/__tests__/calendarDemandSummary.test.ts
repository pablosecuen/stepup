// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarDemandSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, CalendarLessonParticipant } from '../../types/index.ts';
import { buildCalendarDemandSummary } from '../calendarDemandSummary.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const TZ = 'America/Argentina/Buenos_Aires';
const RANGE = { rangeStart: '2026-07-01', rangeEnd: '2026-07-31', timeZone: TZ, evaluationInstant: '2026-07-20T12:00:00-03:00' };

function participant(studentId: string): CalendarLessonParticipant {
  return { studentId, studentName: 'Alumno' } as CalendarLessonParticipant;
}

function calendarLesson(overrides: Partial<CalendarLesson> & { id: string; start: string; end: string }): CalendarLesson {
  return {
    studentId: 's1',
    studentName: 'Alumno',
    level: 'B1',
    participants: [participant('s1')],
    lessonType: 'individual',
    modality: 'online',
    status: 'scheduled',
    color: '#000000',
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

// ---------------------------------------------------------------------------
// Día más demandado
// ---------------------------------------------------------------------------

test('día más demandado: identifica el día con más horas ocupadas', () => {
  const lessons: CalendarLesson[] = [
    // Lunes 6/7: 1 hora
    calendarLesson({ id: 'l1', start: '2026-07-06T10:00:00-03:00', end: '2026-07-06T11:00:00-03:00' }),
    // Martes 7/7: 3 horas repartidas en tres clases
    calendarLesson({ id: 'l2', start: '2026-07-07T10:00:00-03:00', end: '2026-07-07T11:00:00-03:00' }),
    calendarLesson({ id: 'l3', start: '2026-07-07T11:00:00-03:00', end: '2026-07-07T12:00:00-03:00' }),
    calendarLesson({ id: 'l4', start: '2026-07-07T16:00:00-03:00', end: '2026-07-07T17:00:00-03:00' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  assertEqual(summary.topWeekdays.length, 1, 'un único día más demandado');
  assertEqual(summary.topWeekdays[0].weekday, 1, 'martes es AppWeekday 1');
  assertEqual(summary.topWeekdays[0].occupiedHours, 3, 'tres horas ocupadas el martes');
  assertEqual(summary.topWeekdays[0].lessonCount, 3, 'tres clases el martes');
});

test('empate en el día más demandado: muestra TODOS los días empatados, nunca elige uno arbitrariamente', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l1', start: '2026-07-06T10:00:00-03:00', end: '2026-07-06T11:00:00-03:00' }),
    calendarLesson({ id: 'l2', start: '2026-07-07T10:00:00-03:00', end: '2026-07-07T11:00:00-03:00' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  assertEqual(summary.topWeekdays.length, 2, 'ambos días empatados en 1 hora aparecen');
});

test('clase compartida cuenta como una sola ocupación de agenda, no una vez por participante', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({
      id: 'l1',
      start: '2026-07-07T10:00:00-03:00',
      end: '2026-07-07T11:00:00-03:00',
      participants: [participant('s1'), participant('s2'), participant('s3')],
    }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const martes = summary.byWeekday.find((entry) => entry.weekday === 1);
  assertEqual(martes!.occupiedHours, 1, 'una clase compartida de 1 hora ocupa 1 hora, no 3');
  assertEqual(martes!.lessonCount, 1, 'cuenta como una sola clase');
});

test('cancelación excluida: una clase cancelada nunca ocupa agenda', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l1', start: '2026-07-07T10:00:00-03:00', end: '2026-07-07T11:00:00-03:00', status: 'cancelled' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const total = summary.byWeekday.reduce((sum, entry) => sum + entry.occupiedHours, 0);
  assertEqual(total, 0, 'la cancelada no aporta ninguna hora');
});

test('clase "Sin alumnos" futura sigue ocupando la agenda', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({
      id: 'l1',
      start: '2026-07-25T10:00:00-03:00',
      end: '2026-07-25T11:00:00-03:00',
      studentId: '',
      participants: [],
    }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const total = summary.byWeekday.reduce((sum, entry) => sum + entry.occupiedHours, 0);
  assertEqual(total, 1, 'un horario reservado sin alumnos pero futuro sigue ocupando la agenda');
});

test('clase "Sin alumnos" pasada y nunca usada no ocupa la agenda', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({
      id: 'l1',
      start: '2026-07-05T10:00:00-03:00',
      end: '2026-07-05T11:00:00-03:00',
      studentId: '',
      participants: [],
    }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const total = summary.byWeekday.reduce((sum, entry) => sum + entry.occupiedHours, 0);
  assertEqual(total, 0, 'ya pasó y nunca se usó — no cuenta como demanda real');
});

// ---------------------------------------------------------------------------
// Horario más demandado
// ---------------------------------------------------------------------------

test('horario más demandado: agrupa por intervalos de 30 minutos', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l1', start: '2026-07-06T18:00:00-03:00', end: '2026-07-06T19:00:00-03:00' }),
    calendarLesson({ id: 'l2', start: '2026-07-07T18:00:00-03:00', end: '2026-07-07T19:00:00-03:00' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const slot1800 = summary.bySlot.find((slot) => slot.hour === 18 && slot.minute === 0);
  const slot1830 = summary.bySlot.find((slot) => slot.hour === 18 && slot.minute === 30);
  assertEqual(slot1800!.occupiedHours, 1, 'dos clases de media hora en el primer intervalo de 18:00-18:30');
  assertEqual(slot1830!.occupiedHours, 1, 'dos clases de media hora en 18:30-19:00');
});

test('duración parcial: una clase de 20 minutos reparte su ocupación entre los intervalos que toca', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l1', start: '2026-07-07T10:20:00-03:00', end: '2026-07-07T10:40:00-03:00' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const slot1000 = summary.bySlot.find((slot) => slot.hour === 10 && slot.minute === 0);
  const slot1030 = summary.bySlot.find((slot) => slot.hour === 10 && slot.minute === 30);
  assertEqual(slot1000!.occupiedHours, 10 / 60, '10 minutos dentro del intervalo 10:00-10:30');
  assertEqual(slot1030!.occupiedHours, 10 / 60, '10 minutos dentro del intervalo 10:30-11:00');
});

test('reprogramación no duplica: la lista resuelta ya no contiene la ocurrencia original reemplazada', () => {
  // Al reprogramar, la ocurrencia original se reemplaza en la lista resuelta (nunca coexisten) —
  // acá sólo se verifica que si sólo llega la clase NUEVA, únicamente esa cuenta.
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l-nueva', start: '2026-07-09T15:00:00-03:00', end: '2026-07-09T16:00:00-03:00' }),
  ];
  const summary = buildCalendarDemandSummary({ lessons, ...RANGE });
  const total = summary.byWeekday.reduce((sum, entry) => sum + entry.occupiedHours, 0);
  assertEqual(total, 1, 'sólo la ocurrencia vigente cuenta, nunca una original ya reemplazada');
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

test('sin clases en el rango: todo en cero, sin errores', () => {
  const summary = buildCalendarDemandSummary({ lessons: [], ...RANGE });
  assertEqual(summary.topWeekdays.length, 0, 'sin días demandados');
  assertEqual(summary.topSlots.length, 0, 'sin horarios demandados');
  summary.byWeekday.forEach((entry) => {
    assertEqual(entry.percentOfWeeklyDemand, 0, 'nunca NaN/Infinity al dividir por cero');
    assert(Number.isFinite(entry.percentOfWeeklyDemand), 'siempre un número finito');
  });
});

test('no muta la lista de clases recibida', () => {
  const lessons: CalendarLesson[] = [
    calendarLesson({ id: 'l1', start: '2026-07-07T10:00:00-03:00', end: '2026-07-07T11:00:00-03:00' }),
  ];
  const snapshot = JSON.stringify(lessons);
  buildCalendarDemandSummary({ lessons, ...RANGE });
  assertEqual(JSON.stringify(lessons), snapshot, 'la lista original no cambia');
});
