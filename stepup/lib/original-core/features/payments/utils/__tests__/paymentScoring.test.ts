// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentScoring.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, PaymentCharge } from '../../types/index.ts';
import { calculateChargeScore, calculateStudentScoring, categorizeScore, detectConsecutiveDebtStreak } from '../paymentScoring.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function chargeRef(overrides: Partial<Pick<PaymentCharge, 'type' | 'dueDate'>> = {}) {
  return { type: 'mensual' as const, dueDate: '2026-07-01', ...overrides };
}

function state(overrides: Partial<ChargeComputedState> = {}): ChargeComputedState {
  return {
    chargeId: 'charge-1',
    studentId: 's1',
    originalAmount: 10000,
    surchargeAmount: 0,
    totalDue: 10000,
    paidAmount: 0,
    balance: 10000,
    stage: 'on_time',
    settledAt: null,
    isSurchargeWaived: false,
    isNotYetDue: false,
    ...overrides,
  };
}

test('score 100 cuando se salda en término', () => {
  const score = calculateChargeScore(chargeRef(), state({ settledAt: '2026-07-05' }));
  assertEqual(score, 100, 'en término');
});

test('score 75 cuando se salda en el primer vencimiento', () => {
  const score = calculateChargeScore(chargeRef(), state({ settledAt: '2026-07-15' })); // día 15 -> first_late
  assertEqual(score, 75, 'primer vencimiento');
});

test('score 50 cuando se salda en el segundo vencimiento', () => {
  const score = calculateChargeScore(chargeRef(), state({ settledAt: '2026-07-22' })); // día 22 -> second_late
  assertEqual(score, 50, 'segundo vencimiento');
});

test('score 25 cuando se salda en el último vencimiento', () => {
  const score = calculateChargeScore(chargeRef(), state({ settledAt: '2026-07-30' })); // día 30 -> last_late
  assertEqual(score, 25, 'último vencimiento');
});

test('score 0 cuando ya venció y sigue sin saldarse', () => {
  const score = calculateChargeScore(chargeRef(), state({ settledAt: null, isNotYetDue: false }));
  assertEqual(score, 0, 'deuda vencida sin saldar');
});

test('score null cuando todavía no venció (no debe perjudicar el scoring)', () => {
  const score = calculateChargeScore(chargeRef({ dueDate: '2026-08-01' }), state({ settledAt: null, isNotYetDue: true }));
  assertEqual(score, null, 'obligación no vencida: excluida, no penaliza');
});

test('categorizeScore: los cuatro rangos exactos', () => {
  assertEqual(categorizeScore(100), 'excelente', '100');
  assertEqual(categorizeScore(90), 'excelente', 'límite inferior de excelente');
  assertEqual(categorizeScore(89), 'buena', 'límite superior de buena');
  assertEqual(categorizeScore(75), 'buena', 'límite inferior de buena');
  assertEqual(categorizeScore(74), 'irregular', 'límite superior de irregular');
  assertEqual(categorizeScore(50), 'irregular', 'límite inferior de irregular');
  assertEqual(categorizeScore(49), 'riesgo_de_deuda', 'límite superior de riesgo');
  assertEqual(categorizeScore(0), 'riesgo_de_deuda', '0');
});

test('menos de tres obligaciones resueltas: historial insuficiente, sin número', () => {
  const result = calculateStudentScoring([100, 75]);
  assertEqual(result.score, null, 'no informa un promedio');
  assertEqual(result.resolvedChargeCount, 2, 'cuenta las resueltas igual');
  assertEqual(result.category, 'historial_insuficiente', 'categoría especial');
});

test('con tres o más obligaciones resueltas, promedia y categoriza', () => {
  const result = calculateStudentScoring([100, 100, 100]);
  assertEqual(result.score, 100, 'promedio exacto');
  assertEqual(result.category, 'excelente', 'categoría correcta');
});

test('las obligaciones aún no vencidas (null) no cuentan ni perjudican el promedio', () => {
  const withPending = calculateStudentScoring([100, 100, 100, null, null]);
  const withoutPending = calculateStudentScoring([100, 100, 100]);
  assertEqual(withPending.score, withoutPending.score, 'el promedio es idéntico');
  assertEqual(withPending.resolvedChargeCount, 3, 'sólo cuenta las resueltas');
});

test('detecta una racha de deuda consecutiva mirando hacia atrás desde el vencimiento más reciente', () => {
  const streak = detectConsecutiveDebtStreak([
    { dueDate: '2026-05-01', score: 100 },
    { dueDate: '2026-06-01', score: 0 },
    { dueDate: '2026-07-01', score: 0 },
    { dueDate: '2026-08-01', score: 0 },
  ]);
  assertEqual(streak, 3, 'las tres últimas seguidas en 0');
});

test('la racha se corta apenas aparece una obligación resuelta con score positivo', () => {
  const streak = detectConsecutiveDebtStreak([
    { dueDate: '2026-06-01', score: 0 },
    { dueDate: '2026-07-01', score: 100 },
    { dueDate: '2026-08-01', score: 0 },
  ]);
  assertEqual(streak, 1, 'sólo cuenta la más reciente, la de julio corta la racha');
});

test('las obligaciones aún no vencidas no cortan ni suman la racha de deuda', () => {
  const streak = detectConsecutiveDebtStreak([
    { dueDate: '2026-06-01', score: 0 },
    { dueDate: '2026-07-01', score: 0 },
    { dueDate: '2026-08-01', score: null }, // todavía no vence
  ]);
  assertEqual(streak, 2, 'la obligación futura se saltea sin cortar la racha existente');
});
