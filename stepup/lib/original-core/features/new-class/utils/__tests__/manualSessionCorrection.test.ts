// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/manualSessionCorrection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { applyManualSessionCorrection } from '../manualSessionCorrection.ts';
import type { NewClassFormState, SavedLesson, StudentArrival } from '../../types/index.ts';
import { DEFAULT_FORM_STATE } from '../../types/index.ts';

function form(overrides: Partial<NewClassFormState> & { studentIds: string[] }): NewClassFormState {
  return {
    ...DEFAULT_FORM_STATE,
    eventType: 'clase_dictada',
    date: '2026-07-11',
    time: '10:00',
    modality: 'presencial',
    ...overrides,
  };
}

function lesson(overrides: Partial<SavedLesson> & { id: string; form: NewClassFormState }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    effectiveStartAt: '2026-07-11T13:00:00.000Z',
    scheduledStartAt: '2026-07-11T13:00:00.000Z',
    actualStartedAt: '2026-07-11T13:05:00.000Z',
    actualEndedAt: '2026-07-11T14:00:00.000Z',
    startSource: 'button',
    endSource: 'button',
    studentArrival: { status: 'on_time', lateMinutes: 0, manuallyCorrected: false },
    ...overrides,
  };
}

const NOW = '2026-07-12T09:00:00.000Z';
const ARRIVAL_ON_TIME: StudentArrival = { status: 'on_time', lateMinutes: 0, manuallyCorrected: false };

test('applyManualSessionCorrection: hora de fin posterior a inicio se aplica y recalcula duración real', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const result = applyManualSessionCorrection(
    base,
    '2026-07-11T13:10:00.000Z',
    '2026-07-11T14:05:00.000Z',
    ARRIVAL_ON_TIME,
    NOW
  );
  assert(result.ok, 'corrección válida debe aplicarse');
  if (!result.ok) return;
  assertEqual(result.lesson.actualStartedAt, '2026-07-11T13:10:00.000Z', 'nuevo inicio real');
  assertEqual(result.lesson.actualEndedAt, '2026-07-11T14:05:00.000Z', 'nuevo fin real');
  assertEqual(result.lesson.form.actualDurationMinutes, 55, 'duración real recalculada a partir del nuevo inicio/fin');
});

test('applyManualSessionCorrection: fin antes o igual al inicio se rechaza, nunca se aplica', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const result = applyManualSessionCorrection(
    base,
    '2026-07-11T14:00:00.000Z',
    '2026-07-11T13:00:00.000Z',
    ARRIVAL_ON_TIME,
    NOW
  );
  assert(!result.ok, 'fin antes del inicio debe rechazarse');
  if (result.ok) return;
  assertEqual(result.code, 'end_before_start', 'código de error correcto');
});

test('applyManualSessionCorrection: hora de llegada de otro día se rechaza', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-11' }) });
  const arrival: StudentArrival = { arrivedAt: '2026-07-12T13:05:00.000Z', status: 'late', lateMinutes: 5, manuallyCorrected: false };
  const result = applyManualSessionCorrection(base, '2026-07-11T13:00:00.000Z', '2026-07-11T14:00:00.000Z', arrival, NOW);
  assert(!result.ok, 'una llegada de otro día nunca debe aceptarse');
  if (result.ok) return;
  assertEqual(result.code, 'arrival_wrong_day', 'código de error correcto');
});

test('applyManualSessionCorrection: nunca da duración negativa ni cero (mínimo 1 minuto real)', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const result = applyManualSessionCorrection(
    base,
    '2026-07-11T13:00:00.000Z',
    '2026-07-11T13:00:20.000Z', // 20 segundos reales, redondea a menos de 1 minuto
    ARRIVAL_ON_TIME,
    NOW
  );
  assert(result.ok, 'corrección válida (fin > inicio) debe aplicarse');
  if (!result.ok) return;
  assertEqual(result.lesson.form.actualDurationMinutes, 1, 'nunca 0 ni negativo, mínimo 1 minuto real');
});

test('applyManualSessionCorrection: marca manuallyCorrected y las fuentes como manual_correction', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const result = applyManualSessionCorrection(
    base,
    '2026-07-11T13:00:00.000Z',
    '2026-07-11T14:00:00.000Z',
    ARRIVAL_ON_TIME,
    NOW
  );
  assert(result.ok, 'corrección válida');
  if (!result.ok) return;
  assertEqual(result.lesson.studentArrival?.manuallyCorrected, true, 'llegada marcada como corregida a mano');
  assertEqual(result.lesson.startSource, 'manual_correction', 'inicio marcado como corrección manual');
  assertEqual(result.lesson.endSource, 'manual_correction', 'fin marcado como corrección manual');
  assertEqual(result.lesson.sessionUpdatedAt, NOW, 'sessionUpdatedAt registra el momento de la corrección');
});

test('applyManualSessionCorrection: nunca toca createdAt (preserva el registro original)', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const result = applyManualSessionCorrection(
    base,
    '2026-07-11T13:00:00.000Z',
    '2026-07-11T14:00:00.000Z',
    ARRIVAL_ON_TIME,
    NOW
  );
  assert(result.ok, 'corrección válida');
  if (!result.ok) return;
  assertEqual(result.lesson.createdAt, base.createdAt, 'createdAt nunca se toca en una corrección');
  assertEqual(result.lesson.id, base.id, 'nunca cambia el id (nunca crea un segundo registro)');
});

test('applyManualSessionCorrection: sin arrivedAt (por ejemplo teacher_delayed) nunca valida el día', () => {
  const base = lesson({ id: 'l1', form: form({ studentIds: ['s1'] }) });
  const arrival: StudentArrival = { status: 'teacher_delayed', lateMinutes: 0, manuallyCorrected: false };
  const result = applyManualSessionCorrection(base, '2026-07-11T13:00:00.000Z', '2026-07-11T14:00:00.000Z', arrival, NOW);
  assert(result.ok, 'sin arrivedAt no hay día que validar, debe aceptarse');
});
