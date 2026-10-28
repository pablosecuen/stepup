// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/summarizeOverdueDebt.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-04 (a pedido de Joaquín — "Pago vencido" fantasma tras
 * saldar julio): pruebas puras de `summarizeOverdueDebt`, el motor nuevo que
 * arma el texto específico del badge de deuda vencida ("Julio vencido", "2
 * meses vencidos") en vez del genérico "Pago vencido".
 */
import type { PaymentCharge } from '../../types/index.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { summarizeOverdueDebt } from '../monthlyPeriodStatus.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function monthlyCharge(overrides: Partial<PaymentCharge> & { id: string; billingPeriod: string; dueDate: string }): PaymentCharge {
  return {
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    createdAt: `${overrides.dueDate}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

test('sin ninguna obligación vencida: count 0, label null', () => {
  const result = summarizeOverdueDebt({ charges: [], chargeStates: [] });
  assertEqual(result.count, 0, 'sin cargos, nada vencido');
  assertEqual(result.label, null, 'nunca un texto cuando no hay deuda');
});

test('un cargo mensual en término (pendiente, no pagado) no cuenta como vencido', () => {
  const charge = monthlyCharge({ id: 'c1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-05', // día 5, en término
  });
  const result = summarizeOverdueDebt({ charges: [charge], chargeStates: [state] });
  assertEqual(result.count, 0, 'en término nunca es "vencido"');
  assertEqual(result.label, null, 'agosto pendiente nunca dispara este badge');
});

test('un cargo mensual pagado no cuenta, aunque esté muy atrasada la fecha de evaluación', () => {
  const charge = monthlyCharge({ id: 'c1', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const state = calculateChargeState({
    charge,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 20000 }],
    payments: [
      { id: 'p1', studentId: 's1', amount: 20000, currency: 'ARS', method: 'efectivo', paidAt: '2026-07-05', recordedAt: '2026-08-01T00:00:00.000Z', voidedAt: null, voidReason: null },
    ],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const result = summarizeOverdueDebt({ charges: [charge], chargeStates: [state] });
  assertEqual(result.count, 0, 'saldado por completo: ya no es deuda vencida');
  assertEqual(result.label, null, 'nunca "Julio vencido" para un cargo saldado');
});

test('una única obligación mensual vencida: "Julio vencido" (nombre real del mes)', () => {
  const charge = monthlyCharge({ id: 'c1', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-01', // 32 días de atraso: last_late
  });
  const result = summarizeOverdueDebt({ charges: [charge], chargeStates: [state] });
  assertEqual(result.count, 1, 'una sola obligación vencida');
  assertEqual(result.label, 'Julio vencido', 'nombra el mes real, no el genérico "Pago vencido"');
});

test('dos obligaciones mensuales vencidas: "2 meses vencidos"', () => {
  const june = monthlyCharge({ id: 'c-jun', billingPeriod: '2026-06', dueDate: '2026-06-01' });
  const july = monthlyCharge({ id: 'c-jul', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const states = [june, july].map((charge) =>
    calculateChargeState({ charge, allocations: [], payments: [], adjustments: [], evaluationDate: '2026-08-01' })
  );
  const result = summarizeOverdueDebt({ charges: [june, july], chargeStates: states });
  assertEqual(result.count, 2, 'dos meses distintos vencidos');
  assertEqual(result.label, '2 meses vencidos', 'texto agrupado, no repite el badge dos veces');
});

test('julio pagado + junio impago: sólo cuenta junio, nunca vuelve a nombrar julio', () => {
  const june = monthlyCharge({ id: 'c-jun', billingPeriod: '2026-06', dueDate: '2026-06-01' });
  const july = monthlyCharge({ id: 'c-jul', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const juneState = calculateChargeState({ charge: june, allocations: [], payments: [], adjustments: [], evaluationDate: '2026-08-01' });
  const julyState = calculateChargeState({
    charge: july,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: 'c-jul', studentId: 's1', amount: 20000 }],
    payments: [
      { id: 'p1', studentId: 's1', amount: 20000, currency: 'ARS', method: 'efectivo', paidAt: '2026-07-05', recordedAt: '2026-08-01T00:00:00.000Z', voidedAt: null, voidReason: null },
    ],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const result = summarizeOverdueDebt({ charges: [june, july], chargeStates: [juneState, julyState] });
  assertEqual(result.count, 1, 'julio ya no cuenta: sólo queda junio');
  assertEqual(result.label, 'Junio vencido', 'nombra junio, nunca "Julio vencido" (julio está saldado)');
});

test('pago parcial: la obligación sigue contando como vencida hasta saldarse por completo', () => {
  const charge = monthlyCharge({ id: 'c1', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const state = calculateChargeState({
    charge,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 8000 }],
    payments: [
      { id: 'p1', studentId: 's1', amount: 8000, currency: 'ARS', method: 'efectivo', paidAt: '2026-07-05', recordedAt: '2026-07-05T00:00:00.000Z', voidedAt: null, voidReason: null },
    ],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const result = summarizeOverdueDebt({ charges: [charge], chargeStates: [state] });
  assertEqual(result.count, 1, 'saldo positivo: sigue vencida');
  assertEqual(result.label, 'Julio vencido', 'un pago parcial no la saca de la lista de vencidas');
});

// Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
// contradictorios "Agosto pendiente" + "Pago vencido"): antes, una
// obligación por clase vencida usaba el texto genérico "Pago vencido" —
// ahora nombra la fecha exacta de la clase, igual criterio que ya se usaba
// para nombrar el mes de una mensualidad vencida.
test('obligación vencida por clase: nombra la fecha exacta ("Clase del DD/MM vencida"), nunca el genérico', () => {
  const charge: PaymentCharge = {
    id: 'c1',
    studentId: 's1',
    type: 'por_clase',
    originalAmount: 5000,
    currency: 'ARS',
    dueDate: '2026-07-03',
    createdAt: '2026-07-03T09:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const state = calculateChargeState({ charge, allocations: [], payments: [], adjustments: [], evaluationDate: '2026-08-01' });
  const result = summarizeOverdueDebt({ charges: [charge], chargeStates: [state] });
  assertEqual(result.count, 1, 'una obligación por clase vencida');
  assertEqual(result.label, 'Clase del 03/07 vencida', 'nombra la fecha real de la clase, nunca el genérico "Pago vencido"');
});

test('dos obligaciones vencidas de tipos distintos (mensual + por clase): "2 obligaciones vencidas"', () => {
  const monthly = monthlyCharge({ id: 'c-mes', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const perClass: PaymentCharge = {
    id: 'c-clase',
    studentId: 's1',
    type: 'por_clase',
    originalAmount: 5000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-10T09:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const states = [monthly, perClass].map((charge) =>
    calculateChargeState({ charge, allocations: [], payments: [], adjustments: [], evaluationDate: '2026-08-01' })
  );
  const result = summarizeOverdueDebt({ charges: [monthly, perClass], chargeStates: states });
  assertEqual(result.count, 2, 'dos obligaciones distintas vencidas');
  assertEqual(result.label, '2 obligaciones vencidas', 'texto agrupado genérico cuando los tipos no son todos mensuales');
});
