// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/monthlyPeriodStatus.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { allocatePayment, buildMonthlyCharge, recordPayment } from '../paymentMutations.ts';
import { resolveCurrentMonthlyPeriodStatus } from '../monthlyPeriodStatus.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const monthlyPlan: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 1 };

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

test('resolveCurrentMonthlyPeriodStatus: devuelve null para un plan que no es mensual', () => {
  const result = resolveCurrentMonthlyPeriodStatus({
    plan: { type: 'per_class', amount: 5000 },
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-07-26',
  });
  assertEqual(result, null, 'sólo el plan mensual tiene "período actual"');
});

test('resolveCurrentMonthlyPeriodStatus: "comienza el próximo mes" cuando startPeriod es posterior', () => {
  const result = resolveCurrentMonthlyPeriodStatus({
    plan: { ...monthlyPlan, startPeriod: '2026-08' },
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-07-26',
  });
  assertEqual(result?.label, 'comienza_proximo_mes', 'todavía no le corresponde facturar julio');
  assertEqual(result?.billingPeriod, '2026-07', 'el período evaluado sigue siendo julio');
});

test('resolveCurrentMonthlyPeriodStatus: sin obligación generada todavía, "pendiente" (caso límite del cambio de mes)', () => {
  const result = resolveCurrentMonthlyPeriodStatus({
    plan: monthlyPlan,
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-08-01',
  });
  assertEqual(result?.label, 'pendiente', 'sin cargo todavía, se informa como pendiente, nunca como error');
});

test('7. Pago parcial: la obligación mensual queda "parcial", no "pagado" ni "pendiente"', () => {
  const charge = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-07',
    dueDate: '2026-07-01',
    originalAmount: 20000,
    createdAt: '2026-07-01T09:00:00.000Z',
    existingCharges: [],
  });
  const payment = recordPayment({
    id: 'payment_s1_partial',
    studentId: 's1',
    amount: 8000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T09:00:00.000Z',
    todayDateKey: '2026-07-05',
  });
  const stateWithPayment: PaymentsRepositoryState = {
    charges: [charge],
    payments: [payment],
    allocations: [],
    adjustments: [],
  };
  const allocation = allocatePayment({
    id: 'payment_s1_partial_alloc_1',
    paymentId: payment.id,
    chargeId: charge.id,
    amount: 8000,
    state: stateWithPayment,
  });
  const state: PaymentsRepositoryState = { ...stateWithPayment, allocations: [allocation] };

  const chargeState = calculateChargeState({
    charge,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-07-26',
  });

  const result = resolveCurrentMonthlyPeriodStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-07-26',
  });
  assertEqual(result?.label, 'parcial', 'pagó una parte, todavía debe el resto');
});

test('un mes completamente pagado se informa como "pagado"', () => {
  const charge: PaymentCharge = {
    id: 'charge_mensual_s1_2026-07',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T09:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  const chargeState = calculateChargeState({
    charge,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 20000 }],
    payments: [
      {
        id: 'p1',
        studentId: 's1',
        amount: 20000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-07-03',
        recordedAt: '2026-07-03T09:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    adjustments: [],
    evaluationDate: '2026-07-26',
  });
  const result = resolveCurrentMonthlyPeriodStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-07-26',
  });
  assertEqual(result?.label, 'pagado', 'saldo cero: pagado');
});

test('un mes vencido y sin pagar se informa como "vencido"', () => {
  const charge: PaymentCharge = {
    id: 'charge_mensual_s1_2026-06',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-06-01',
    createdAt: '2026-06-01T09:00:00.000Z',
    billingPeriod: '2026-06',
    voidedAt: null,
    voidReason: null,
  };
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-06-30',
  });
  const result = resolveCurrentMonthlyPeriodStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-06-30',
  });
  assertEqual(result?.label, 'vencido', 'sin pagos y ya pasado el término, vencido');
});
