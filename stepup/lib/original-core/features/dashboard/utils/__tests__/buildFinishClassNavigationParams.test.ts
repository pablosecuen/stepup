// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/buildFinishClassNavigationParams.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildFinishClassNavigationParams } from '../buildFinishClassNavigationParams.ts';
import type { ActiveClassSession } from '../../hooks/activeClassSessionStore.ts';

const SESSION: ActiveClassSession = {
  lessonId: 'l1',
  studentId: 's1',
  studentNames: ['Juan Emee'],
  scheduledDurationMinutes: 60,
  startedAt: '2026-07-18T13:05:00.000Z',
  calendarRegistration: {
    reservationKey: 'rk1',
    lessonId: 'l1',
    studentId: 's1',
    start: '2026-07-18T13:00:00.000Z',
    end: '2026-07-18T14:00:00.000Z',
    modality: 'online',
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
  },
  scheduledStartAt: '2026-07-18T13:00:00.000Z',
  effectiveStartAt: '2026-07-18T13:00:00.000Z',
  studentArrival: { status: 'on_time', lateMinutes: 0, manuallyCorrected: false },
  startSource: 'button',
};

test('buildFinishClassNavigationParams: arma sessionMeta completo con el fin real recibido', () => {
  const params = buildFinishClassNavigationParams(SESSION, '2026-07-18T14:10:00.000Z', 65);
  assertEqual(params.studentId, 's1', 'alumno correcto');
  assertEqual(params.initialActualDurationMinutes, 65, 'duración real recibida');
  assertEqual(params.sessionMeta?.actualStartedAt, '2026-07-18T13:05:00.000Z', 'inicio real de la sesión');
  assertEqual(params.sessionMeta?.actualEndedAt, '2026-07-18T14:10:00.000Z', 'fin real pasado como parámetro, no recalculado');
  assertEqual(params.sessionMeta?.scheduledStartAt, '2026-07-18T13:00:00.000Z', 'horario originalmente agendado');
});

test('buildFinishClassNavigationParams: nunca inventa duración cuando elapsedMinutes es null', () => {
  const params = buildFinishClassNavigationParams(SESSION, '2026-07-18T14:10:00.000Z', null);
  assertEqual(params.initialActualDurationMinutes, undefined, 'sin dato real, nunca se inventa un número');
});

test('buildFinishClassNavigationParams: reason del ajuste de horario viaja intacto si lo hubo', () => {
  const sessionWithAdjustment: ActiveClassSession = {
    ...SESSION,
    scheduleAdjustment: { direction: 'delayed', minutes: 20, reason: 'teacher', adjustedAt: '2026-07-18T12:00:00.000Z' },
  };
  const params = buildFinishClassNavigationParams(sessionWithAdjustment, '2026-07-18T14:10:00.000Z', 60);
  assertEqual(params.sessionMeta?.scheduleAdjustment?.minutes, 20, 'el ajuste real viaja sin alterarse');
});
