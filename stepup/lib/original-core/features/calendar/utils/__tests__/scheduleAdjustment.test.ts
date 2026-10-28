// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/scheduleAdjustment.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../types/index.ts';
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { computeAdjustedEnd, computeAdjustedStart, formatScheduleAdjustmentLabel, planScheduleAdjustment, SCHEDULE_ADJUSTMENT_MINUTE_OPTIONS } from '../scheduleAdjustment.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const EMPTY_AVAILABILITY: TeacherAvailability = {
  schemaVersion: 1,
  timezone: 'America/Argentina/Buenos_Aires',
  weeklyBlocks: [],
  exceptions: [],
};

function lesson(overrides: Partial<CalendarLesson> & { id: string }): CalendarLesson {
  return {
    studentId: 's1',
    studentName: 'Juan Emee',
    level: 'B1',
    participants: [{ studentId: 's1', studentName: 'Juan Emee', level: 'B1' }],
    lessonType: 'individual',
    start: '2026-07-20T17:00:00.000Z',
    end: '2026-07-20T18:00:00.000Z',
    modality: 'online',
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

test('SCHEDULE_ADJUSTMENT_MINUTE_OPTIONS: exactamente los 6 valores pedidos, en orden', () => {
  assertEqual(SCHEDULE_ADJUSTMENT_MINUTE_OPTIONS.join(','), '15,20,30,40,50,60', 'sólo estos 6 valores discretos');
});

test('computeAdjustedStart: atrasar suma minutos', () => {
  const result = computeAdjustedStart('2026-07-20T17:00:00.000Z', 'delayed', 30);
  assertEqual(result, '2026-07-20T17:30:00.000Z', 'atrasa 30 minutos');
});

test('computeAdjustedStart: adelantar resta minutos', () => {
  const result = computeAdjustedStart('2026-07-20T17:00:00.000Z', 'advanced', 20);
  assertEqual(result, '2026-07-20T16:40:00.000Z', 'adelanta 20 minutos');
});

test('computeAdjustedEnd: conserva la duración original', () => {
  const result = computeAdjustedEnd('2026-07-20T17:30:00.000Z', 60);
  assertEqual(result, '2026-07-20T18:30:00.000Z', 'misma duración, nuevo horario');
});

test('planScheduleAdjustment: sin conflictos, calcula el nuevo horario y guarda el motivo', () => {
  const target = lesson({ id: 'l1' });
  const plan = planScheduleAdjustment({
    lesson: target,
    direction: 'delayed',
    minutes: 30,
    reason: 'teacher',
    otherLessons: [],
    availability: EMPTY_AVAILABILITY,
    now: new Date('2026-07-20T16:50:00.000Z'),
  });
  assert(plan.ok, 'sin conflictos, debe poder aplicarse');
  if (!plan.ok) return;
  assertEqual(plan.newStart, '2026-07-20T17:30:00.000Z', 'nuevo horario correcto');
  assertEqual(plan.newEnd, '2026-07-20T18:30:00.000Z', 'nuevo fin correcto, misma duración');
  assertEqual(plan.adjustment.direction, 'delayed', 'dirección guardada');
  assertEqual(plan.adjustment.minutes, 30, 'minutos guardados');
  assertEqual(plan.adjustment.reason, 'teacher', 'motivo guardado');
  assertEqual(plan.adjustment.adjustedAt, '2026-07-20T16:50:00.000Z', 'fecha de ajuste real, no inventada');
});

test('planScheduleAdjustment: nunca modifica otras clases, sólo calcula el horario de la elegida', () => {
  const target = lesson({ id: 'l1' });
  const other = lesson({ id: 'l2', studentId: 's2', studentName: 'Otro alumno', start: '2026-07-20T20:00:00.000Z', end: '2026-07-20T21:00:00.000Z' });
  const plan = planScheduleAdjustment({
    lesson: target,
    direction: 'delayed',
    minutes: 15,
    reason: 'teacher',
    otherLessons: [other],
    availability: EMPTY_AVAILABILITY,
  });
  assert(plan.ok, 'no debe chocar con una clase en otro horario');
});

test('planScheduleAdjustment: conflicto con otra clase real bloquea el ajuste y nunca lo aplica', () => {
  const target = lesson({ id: 'l1' });
  const conflicting = lesson({
    id: 'l2',
    studentId: 's2',
    studentName: 'Otro alumno',
    start: '2026-07-20T17:30:00.000Z',
    end: '2026-07-20T18:30:00.000Z',
  });
  const plan = planScheduleAdjustment({
    lesson: target,
    direction: 'delayed',
    minutes: 30,
    reason: 'teacher',
    otherLessons: [conflicting],
    availability: EMPTY_AVAILABILITY,
  });
  assertEqual(plan.ok, false, 'debe bloquear el ajuste');
  if (plan.ok) return;
  assertEqual(plan.conflict.kind, 'lesson', 'el conflicto es con otra clase');
  assert(plan.conflict.label.includes('Otro alumno'), 'explica claramente quién ocupa el horario');
  assertEqual(plan.conflict.occupiedFrom, conflicting.start, 'muestra el horario ocupado real');
});

test('planScheduleAdjustment: la clase que se está ajustando nunca choca consigo misma', () => {
  const target = lesson({ id: 'l1' });
  const plan = planScheduleAdjustment({
    lesson: target,
    direction: 'advanced',
    minutes: 15,
    reason: 'teacher',
    otherLessons: [target],
    availability: EMPTY_AVAILABILITY,
  });
  assert(plan.ok, 'la propia clase (mismo id) nunca debe contarse como conflicto');
});

test('planScheduleAdjustment: bloqueo de disponibilidad de la profesora también bloquea el ajuste', () => {
  const target = lesson({ id: 'l1', start: '2026-07-20T17:00:00.000Z', end: '2026-07-20T18:00:00.000Z' });
  const availability: TeacherAvailability = {
    ...EMPTY_AVAILABILITY,
    exceptions: [
      {
        id: 'e1',
        date: '2026-07-20',
        type: 'unavailable_full_day',
        reason: 'other',
      },
    ],
  };
  const plan = planScheduleAdjustment({
    lesson: target,
    direction: 'delayed',
    minutes: 30,
    reason: 'teacher',
    otherLessons: [],
    availability,
  });
  assertEqual(plan.ok, false, 'debe bloquear por disponibilidad');
  if (plan.ok) return;
  assertEqual(plan.conflict.kind, 'availability', 'el conflicto es de disponibilidad');
});

test('formatScheduleAdjustmentLabel: textos exactos pedidos', () => {
  assertEqual(
    formatScheduleAdjustmentLabel({ direction: 'delayed', minutes: 30, reason: 'teacher', adjustedAt: '2026-07-20T00:00:00.000Z' }),
    'Atrasada 30 minutos',
    'texto exacto para atraso'
  );
  assertEqual(
    formatScheduleAdjustmentLabel({ direction: 'advanced', minutes: 20, reason: 'teacher', adjustedAt: '2026-07-20T00:00:00.000Z' }),
    'Adelantada 20 minutos',
    'texto exacto para adelanto'
  );
});
