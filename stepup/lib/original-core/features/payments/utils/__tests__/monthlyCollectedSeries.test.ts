// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/monthlyCollectedSeries.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildMonthlyCollectedSeries } from '../monthlyCollectedSeries.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Fase financiera — "Plan de distribución 50/30/20", serie mensual de
 * cobrado real: generaliza exactamente el filtro de `buildHomeFinancialSummary`
 * (cargo activo, pago vigente, agrupado por `paidAt` real) a una lista de
 * períodos arbitraria, para alimentar el gráfico de 12 meses.
 */

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string }): PaymentCharge {
  return {
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

function payment(overrides: Partial<Payment> & { id: string; studentId: string }): Payment {
  return {
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

function allocation(
  overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string }
): PaymentAllocation {
  return { amount: 10000, ...overrides };
}

test('sin datos: todos los períodos pedidos quedan en cero, ninguno ausente', () => {
  const series = buildMonthlyCollectedSeries(emptyState(), ['2026-05', '2026-06', '2026-07']);
  assertEqual(series['2026-05'], 0, 'mayo');
  assertEqual(series['2026-06'], 0, 'junio');
  assertEqual(series['2026-07'], 0, 'julio');
});

test('agrupa por paidAt real, nunca por recordedAt', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1' })],
    payments: [
      payment({ id: 'p1', studentId: 's1', amount: 8000, paidAt: '2026-06-28', recordedAt: '2026-07-02T09:00:00.000Z' }),
    ],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 8000 })],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-06', '2026-07']);
  assertEqual(series['2026-06'], 8000, 'suma al mes de paidAt real (junio), aunque se cargó en julio');
  assertEqual(series['2026-07'], 0, 'julio (mes de recordedAt) no recibe nada');
});

test('pago parcial: sólo cuenta el importe realmente asignado, no el total del cargo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', originalAmount: 10000 })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 4000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 4000 })],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-07']);
  assertEqual(series['2026-07'], 4000, 'sólo lo asignado, no los 10000 del cargo original');
});

test('un pago anulado no cuenta, aunque su asignación siga en el array', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1' })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 10000, paidAt: '2026-07-05', voidedAt: '2026-07-06T00:00:00.000Z' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 10000 })],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-07']);
  assertEqual(series['2026-07'], 0, 'un pago anulado nunca cuenta como cobrado');
});

test('un cargo anulado excluye su asignación aunque el pago siga vigente', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', voidedAt: '2026-07-02T00:00:00.000Z' })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 10000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 10000 })],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-07']);
  assertEqual(series['2026-07'], 0, 'una asignación a un cargo anulado nunca cuenta');
});

test('cruce de fin de año: diciembre y enero se agrupan por separado, sin mezclarse', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c-dec', studentId: 's1', dueDate: '2026-12-01', billingPeriod: '2026-12' }),
      charge({ id: 'c-ene', studentId: 's1', dueDate: '2027-01-01', billingPeriod: '2027-01' }),
    ],
    payments: [
      payment({ id: 'p-dec', studentId: 's1', amount: 5000, paidAt: '2026-12-30' }),
      payment({ id: 'p-ene', studentId: 's1', amount: 6000, paidAt: '2027-01-02' }),
    ],
    allocations: [
      allocation({ id: 'a-dec', paymentId: 'p-dec', chargeId: 'c-dec', studentId: 's1', amount: 5000 }),
      allocation({ id: 'a-ene', paymentId: 'p-ene', chargeId: 'c-ene', studentId: 's1', amount: 6000 }),
    ],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-12', '2027-01']);
  assertEqual(series['2026-12'], 5000, 'diciembre');
  assertEqual(series['2027-01'], 6000, 'enero del año siguiente, sin mezclarse con diciembre');
});

test('un período no incluido en la lista pedida nunca aparece ni se cuenta', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1' })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 10000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 10000 })],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-06']); // julio deliberadamente no pedido
  assertEqual(Object.keys(series).length, 1, 'sólo el período pedido aparece en el resultado');
  assertEqual(series['2026-06'], 0, 'junio, sin datos, en cero');
});

test('dos pagos del mismo estudiante en el mismo mes se suman', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1' }), charge({ id: 'c2', studentId: 's2' })],
    payments: [
      payment({ id: 'p1', studentId: 's1', amount: 3000, paidAt: '2026-07-02' }),
      payment({ id: 'p2', studentId: 's2', amount: 7000, paidAt: '2026-07-20' }),
    ],
    allocations: [
      allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 3000 }),
      allocation({ id: 'a2', paymentId: 'p2', chargeId: 'c2', studentId: 's2', amount: 7000 }),
    ],
  };
  const series = buildMonthlyCollectedSeries(state, ['2026-07']);
  assertEqual(series['2026-07'], 10000, 'ambos pagos del mismo mes se suman entre distintos alumnos');
});
