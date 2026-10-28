// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/studentPaymentsSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    studentId: 's1',
    amount: 10000,
    currency: 'ARS',
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: 'alloc-1',
    paymentId: 'payment-1',
    chargeId: 'charge-1',
    studentId: 's1',
    amount: 10000,
    ...overrides,
  };
}

test('sin obligaciones ni pagos: resumen en cero y semáforo verde', () => {
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: emptyState(), evaluationDate: '2026-07-20' });
  assertEqual(summary.charges.length, 0, 'sin obligaciones');
  assertEqual(summary.totalOriginal, 0, 'sin deuda original');
  assertEqual(summary.totalWithSurcharge, 0, 'sin deuda con recargo');
  assertEqual(summary.pendingBalance, 0, 'sin saldo pendiente');
  assertEqual(summary.overdueBalance, 0, 'sin saldo vencido');
  assertEqual(summary.trafficLight, 'verde', 'nada que deber');
  assertEqual(summary.scoring.category, 'historial_insuficiente', 'sin historial');
});

test('una obligación vencida sin pagar: aparece en total, pendiente y vencido, sin recargo (semáforo colapsado a rojo)', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ dueDate: '2026-07-01' })] };
  // 22/07 = day 22 -> second_late (mora real), pero sin recargos automáticos.
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-22' });
  assertEqual(summary.totalOriginal, 10000, 'importe original');
  assertEqual(summary.totalWithSurcharge, 10000, 'sin recargo: igual al importe original');
  assertEqual(summary.pendingBalance, 10000, 'todo el saldo está pendiente, sin recargo');
  assertEqual(summary.overdueBalance, 10000, 'está vencida (no on_time): cuenta como vencido, sin recargo');
  assertEqual(summary.trafficLight, 'rojo', 'sin recargos automáticos, el semáforo colapsa amarillo/naranja/rojo en un único rojo');
});

test('una obligación pagada por completo no suma a pendiente ni a vencido, aunque se haya pagado tarde', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ dueDate: '2026-07-01' })],
    payments: [payment({ amount: 11500, paidAt: '2026-07-22' })], // saldada en second_late
    allocations: [allocation({ amount: 11500 })],
  };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-08-15' });
  assertEqual(summary.totalOriginal, 0, 'saldada: no cuenta en la deuda vigente');
  assertEqual(summary.pendingBalance, 0, 'sin saldo pendiente');
  assertEqual(summary.overdueBalance, 0, 'sin saldo vencido');
  assertEqual(summary.trafficLight, 'verde', 'sin deuda actual, aunque se pagó tarde en su momento');
  assertEqual(summary.totalPaid, 11500, 'igual refleja lo efectivamente pagado');
});

test('una obligación todavía no vencida no cuenta como vencida, aunque sume al pendiente', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ dueDate: '2026-08-01', billingPeriod: '2026-08' })] };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(summary.pendingBalance, 10000, 'todavía figura como pendiente (es deuda futura)');
  assertEqual(summary.overdueBalance, 0, 'pero no está vencida: no vence hasta agosto');
  assertEqual(summary.trafficLight, 'verde', 'no vencida: no perjudica el semáforo');
});

test('semáforo: usa la peor situación entre varias obligaciones del alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c1', dueDate: '2026-06-01', billingPeriod: '2026-06' }), // vencida hace mucho -> last_late
      charge({ id: 'c2', dueDate: '2026-07-01', billingPeriod: '2026-07' }), // recién vencida hoy -> on_time
    ],
  };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-01' });
  assertEqual(summary.trafficLight, 'rojo', 'la obligación de junio (mucho más vencida) domina el semáforo');
});

test('scoring y racha se actualizan después de pagar', () => {
  const chargeJune = charge({ id: 'c1', dueDate: '2026-05-01', billingPeriod: '2026-05' });
  const chargeJuly = charge({ id: 'c2', dueDate: '2026-06-01', billingPeriod: '2026-06' });
  const chargeAugust = charge({ id: 'c3', dueDate: '2026-07-01', billingPeriod: '2026-07' });

  const beforePaying: PaymentsRepositoryState = { ...emptyState(), charges: [chargeJune, chargeJuly, chargeAugust] };
  const before = buildStudentPaymentsSummary({ studentId: 's1', state: beforePaying, evaluationDate: '2026-07-20' });
  assertEqual(before.debtStreak, 3, 'las tres obligaciones están vencidas y sin saldar: racha de 3');
  assertEqual(before.scoring.score, 0, 'promedio 0: las tres obligaciones resueltas están en deuda');

  const afterPaying: PaymentsRepositoryState = {
    ...beforePaying,
    payments: [
      payment({ id: 'p1', paidAt: '2026-07-01' }),
    ],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c3', amount: 10000 })], // salda sólo la más reciente
  };
  const after = buildStudentPaymentsSummary({ studentId: 's1', state: afterPaying, evaluationDate: '2026-07-20' });
  assertEqual(after.debtStreak, 0, 'la más reciente (agosto/julio) ya está saldada: corta la racha');
  assertEqual(after.scoring.resolvedChargeCount, 3, 'sigue habiendo tres obligaciones resueltas');
  assert(after.scoring.score !== null && after.scoring.score > 0, 'el promedio sube: ya no es 0 tras saldar una en término');
});

test('pagos anulados se listan por separado de los vigentes', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge()],
    payments: [
      payment({ id: 'p1', amount: 5000 }),
      payment({ id: 'p2', amount: 3000, voidedAt: '2026-07-06T00:00:00.000Z', voidReason: 'error de carga' }),
    ],
  };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-10' });
  assertEqual(summary.activePayments.length, 1, 'un pago vigente');
  assertEqual(summary.activePayments[0].id, 'p1', 'el no anulado');
  assertEqual(summary.voidedPayments.length, 1, 'un pago anulado');
  assertEqual(summary.voidedPayments[0].id, 'p2', 'el anulado');
});

test('no incluye obligaciones ni pagos de otro alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1' }), charge({ id: 'c2', studentId: 's2' })],
    payments: [payment({ id: 'p1', studentId: 's1' }), payment({ id: 'p2', studentId: 's2' })],
  };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-10' });
  assertEqual(summary.charges.length, 1, 'sólo la obligación de s1');
  assertEqual(summary.activePayments.length, 1, 'sólo el pago de s1');
});

test('no incluye obligaciones anuladas', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'error' })],
  };
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-10' });
  assertEqual(summary.charges.length, 0, 'la obligación anulada no cuenta como vigente');
});

test('no muta el estado recibido', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge()], payments: [payment()], allocations: [allocation()] };
  const snapshot = JSON.stringify(state);
  buildStudentPaymentsSummary({ studentId: 's1', state, evaluationDate: '2026-07-10' });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});
