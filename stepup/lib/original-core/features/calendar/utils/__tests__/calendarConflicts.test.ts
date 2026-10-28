// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarConflicts.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../types/index.ts';
import { findCalendarConflicts } from '../calendarConflicts.ts';
import { assertEqual, test } from './testHarness.ts';

const recurringLesson: CalendarLesson = {
  id: 'virtual-recurring',
  studentId: 's1',
  studentName: 'Alumno recurrente',
  level: 'B1',
  participants: [{ studentId: 's1', studentName: 'Alumno recurrente', level: 'B1' }],
  lessonType: 'individual',
  start: '2026-07-20T21:00:00.000Z',
  end: '2026-07-20T22:00:00.000Z',
  modality: 'presencial',
  status: 'scheduled',
  color: '#fff',
  overlapAllowed: false,
  overlapGroupId: null,
  isRecurring: true,
  recurrenceId: 'r1',
  recurrenceOccurrenceKey: 'r1:w0:c0:d0:t1800:s0',
  recurrenceIndex: 0,
  recurrenceOriginalStart: null,
};

test('una ocurrencia virtual bloquea el horario y no se convierte directamente en grupo', () => {
  const conflicts = findCalendarConflicts(
    '2026-07-20T21:00:00.000Z',
    '2026-07-20T22:00:00.000Z',
    [recurringLesson]
  );
  assertEqual(conflicts.length, 1, 'conflicto detectado');
  assertEqual(conflicts[0].canConvertToGroup, false, 'no convierte virtual en grupo');
});

test('una clase cancelada libera el horario', () => {
  const conflicts = findCalendarConflicts(
    recurringLesson.start,
    recurringLesson.end,
    [{ ...recurringLesson, status: 'cancelled' }]
  );
  assertEqual(conflicts.length, 0, 'sin conflicto por cancelada');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-31 (a pedido de Joaquín — horarios de 15 minutos):
// escenario 7 del pedido — la detección de superposición ya opera a nivel
// de minuto exacto (milisegundos, en realidad), así que un horario de
// cuarto de hora se detecta igual de bien que uno en punto o media.
// ---------------------------------------------------------------------------

test('escenario 7: detecta superposición exacta a las 11:15, sin redondear a 11:00 ni a 11:30', () => {
  const existingAt1115: CalendarLesson = {
    ...recurringLesson,
    id: 'lesson-1115',
    start: '2026-08-03T14:15:00.000Z', // 11:15 en Buenos Aires
    end: '2026-08-03T15:15:00.000Z', // 12:15 en Buenos Aires
  };
  const overlapping = findCalendarConflicts(
    '2026-08-03T14:30:00.000Z', // 11:30, se solapa con la clase de 11:15-12:15
    '2026-08-03T15:30:00.000Z',
    [existingAt1115]
  );
  assertEqual(overlapping.length, 1, 'detecta el solapamiento con la clase de las 11:15');

  const adjacentNotOverlapping = findCalendarConflicts(
    '2026-08-03T15:15:00.000Z', // exactamente 12:15, cuando termina la de 11:15
    '2026-08-03T16:15:00.000Z',
    [existingAt1115]
  );
  assertEqual(adjacentNotOverlapping.length, 0, 'una clase que arranca justo cuando termina la de :15 no se considera solapada');

  const exactSameQuarterHour = findCalendarConflicts(
    '2026-08-03T14:15:00.000Z',
    '2026-08-03T15:15:00.000Z',
    [existingAt1115]
  );
  assertEqual(exactSameQuarterHour.length, 1, 'el mismo horario exacto de :15 se detecta como conflicto');
  assertEqual(exactSameQuarterHour[0].exactSameSchedule, true, 'se reconoce como el mismo horario exacto, no uno redondeado');
});
