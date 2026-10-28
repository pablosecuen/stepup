// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/studentPaymentHistory.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentChargeType, PaymentsRepositoryState } from '../../types/index.ts';
import { allocatePayment, recordPayment } from '../paymentMutations.ts';
import { calculateSurchargeAmount, determineDueStage } from '../paymentDueStage.ts';
import { buildStudentPaymentHistory } from '../studentPaymentHistory.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; dueDate: string }): PaymentCharge {
  return {
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    createdAt: '2026-01-01T00:00:00.000Z',
    billingPeriod: overrides.dueDate.slice(0, 7),
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string; paidAt: string }): Payment {
  return {
    amount: 10000,
    currency: 'ARS',
    method: 'efectivo',
    recordedAt: `${overrides.paidAt}T12:00:00.000Z`,
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

/**
 * Arma un cargo saldado con un único pago, con su asignación — atajo para
 * no repetir 3 objetos por obligación. Calcula el importe exacto necesario
 * para saldar en `paidAt` (importe original + el recargo vigente en esa
 * fecha) en vez de un monto fijo: pagar sólo el importe original cuando
 * `paidAt` ya cayó en una etapa con recargo (ej. primer vencimiento) nunca
 * alcanzaría para saldar la obligación.
 */
function settledCharge(input: {
  id: string;
  studentId: string;
  dueDate: string;
  paidAt: string;
  originalAmount?: number;
  type?: PaymentChargeType;
}): { charge: PaymentCharge; payment: Payment; allocation: PaymentAllocation } {
  const originalAmount = input.originalAmount ?? 10000;
  const type = input.type ?? 'mensual';
  const stage = determineDueStage(type, input.dueDate, input.paidAt);
  const amount = originalAmount + calculateSurchargeAmount(originalAmount, stage);
  return {
    charge: charge({ id: input.id, studentId: input.studentId, dueDate: input.dueDate, originalAmount, type }),
    payment: payment({ id: `payment-${input.id}`, studentId: input.studentId, amount, paidAt: input.paidAt }),
    allocation: allocation({
      id: `alloc-${input.id}`,
      paymentId: `payment-${input.id}`,
      chargeId: input.id,
      studentId: input.studentId,
      amount,
    }),
  };
}

test('sin obligaciones: 12 meses vacíos, historial insuficiente, sin deuda, sin racha', () => {
  const history = buildStudentPaymentHistory({ studentId: 's1', state: emptyState(), evaluationDate: '2026-07-20' });
  assertEqual(history.months.length, 12, 'siempre 12 meses');
  history.months.forEach((month) => assertEqual(month.category, null, `${month.period} sin datos`));
  assertEqual(history.scoring.category, 'historial_insuficiente', 'sin obligaciones resueltas');
  assertEqual(history.scoring.score, null, 'sin número de score');
  assertEqual(history.onTimeCount, 0, 'sin pagos en término');
  assertEqual(history.lateCount, 0, 'sin pagos fuera de término');
  assertEqual(history.currentDebt, 0, 'sin deuda');
  assertEqual(history.monthlyDebtStreak, 0, 'sin racha');
});

test('12 meses en orden cronológico ascendente terminando en evaluationDate', () => {
  const history = buildStudentPaymentHistory({ studentId: 's1', state: emptyState(), evaluationDate: '2026-07-20' });
  assertEqual(history.months[history.months.length - 1].period, '2026-07', 'el último es el mes de evaluación');
  assertEqual(history.months[0].period, '2025-08', 'el primero es 11 meses antes');
  for (let i = 1; i < history.months.length; i++) {
    assert(history.months[i - 1].period < history.months[i].period, 'orden ascendente');
  }
});

test('escenario completo: categorías mensuales, en término/fuera de término, deuda actual y racha de meses', () => {
  const jan = settledCharge({ id: 'c-jan', studentId: 's1', dueDate: '2026-01-01', paidAt: '2026-01-05' }); // en término
  const mar = settledCharge({ id: 'c-mar', studentId: 's1', dueDate: '2026-03-01', paidAt: '2026-03-15' }); // primer vencimiento
  const apr = settledCharge({ id: 'c-apr', studentId: 's1', dueDate: '2026-04-01', paidAt: '2026-04-01' }); // en término: corta cualquier racha previa
  const may = charge({ id: 'c-may', studentId: 's1', dueDate: '2026-05-01' }); // sin pagar: deuda
  const jun = charge({ id: 'c-jun', studentId: 's1', dueDate: '2026-06-01' }); // sin pagar: deuda
  const jul = charge({ id: 'c-jul', studentId: 's1', dueDate: '2026-07-01' }); // sin pagar: deuda

  const state: PaymentsRepositoryState = {
    charges: [jan.charge, mar.charge, apr.charge, may, jun, jul],
    payments: [jan.payment, mar.payment, apr.payment],
    allocations: [jan.allocation, mar.allocation, apr.allocation],
    adjustments: [],
  };

  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });

  const byPeriod = new Map(history.months.map((month) => [month.period, month]));
  assertEqual(byPeriod.get('2026-01')!.category, 'en_termino', 'enero saldada en término');
  assertEqual(byPeriod.get('2026-02')!.category, null, 'febrero sin obligaciones');
  assertEqual(byPeriod.get('2026-03')!.category, 'primer_vencimiento', 'marzo saldada en el primer vencimiento');
  assertEqual(byPeriod.get('2026-04')!.category, 'en_termino', 'abril en término, corta la racha previa a mayo');
  assertEqual(byPeriod.get('2026-05')!.category, 'mantiene_deuda', 'mayo sin saldar');
  assertEqual(byPeriod.get('2026-06')!.category, 'mantiene_deuda', 'junio sin saldar');
  assertEqual(byPeriod.get('2026-07')!.category, 'mantiene_deuda', 'julio sin saldar');

  assertEqual(history.onTimeCount, 2, 'enero y abril, en término');
  assertEqual(history.lateCount, 4, 'marzo (tarde) + mayo/junio/julio (deuda vencida)');
  assertEqual(history.currentDebt, 30000, 'suma de los tres cargos vencidos, sin recargo automático (10000+10000+10000)');
  assertEqual(history.monthlyDebtStreak, 3, 'mayo, junio y julio consecutivos con deuda');

  assertEqual(history.scoring.resolvedChargeCount, 6, 'seis obligaciones resueltas');
  assertEqual(history.scoring.category, 'riesgo_de_deuda', 'promedio bajo por las tres deudas vencidas');
});

test('un mes con varias obligaciones por_clase usa la peor categoría de todas', () => {
  const saldada = settledCharge({ id: 'c-clase-1', studentId: 's1', dueDate: '2026-07-03', paidAt: '2026-07-03', originalAmount: 5000 });
  const vencida = charge({ id: 'c-clase-2', studentId: 's1', dueDate: '2026-07-10', type: 'por_clase', originalAmount: 5000 });

  const state: PaymentsRepositoryState = {
    charges: [saldada.charge, vencida],
    payments: [saldada.payment],
    allocations: [saldada.allocation],
    adjustments: [],
  };

  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-30' });
  const july = history.months[history.months.length - 1];
  assertEqual(july.period, '2026-07', 'último mes de la ventana');
  assertEqual(july.category, 'mantiene_deuda', 'la peor de las dos obligaciones de julio prevalece');
});

test('las obligaciones todavía no vencidas no cuentan ni en término ni fuera de término, ni afectan la racha', () => {
  const futura = charge({ id: 'c-futura', studentId: 's1', dueDate: '2026-08-01' }); // vence después de evaluationDate
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [futura] };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });

  assertEqual(history.onTimeCount, 0, 'no cuenta como en término');
  assertEqual(history.lateCount, 0, 'no cuenta como fuera de término');
  assertEqual(history.scoring.category, 'historial_insuficiente', 'una obligación futura no aporta historial');
  assertEqual(history.monthlyDebtStreak, 0, 'no genera racha');
  const august = history.months.find((month) => month.period === '2026-08');
  assertEqual(august, undefined, 'agosto queda fuera de la ventana de 12 meses (el último es julio)');
});

test('la racha de meses salta los meses sin ninguna obligación, sin cortarla', () => {
  const may = charge({ id: 'c-may', studentId: 's1', dueDate: '2026-05-01' }); // deuda
  // junio: sin ninguna obligación (hueco)
  const jul = charge({ id: 'c-jul', studentId: 's1', dueDate: '2026-07-01' }); // deuda
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [may, jul] };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(history.monthlyDebtStreak, 2, 'mayo y julio cuentan, junio (sin datos) no corta la racha');
});

test('la racha se corta apenas aparece un mes resuelto sin deuda', () => {
  const jun = settledCharge({ id: 'c-jun', studentId: 's1', dueDate: '2026-06-01', paidAt: '2026-06-15' }); // primer vencimiento, no es deuda
  const jul = charge({ id: 'c-jul', studentId: 's1', dueDate: '2026-07-01' }); // deuda
  const state: PaymentsRepositoryState = {
    charges: [jun.charge, jul],
    payments: [jun.payment],
    allocations: [jun.allocation],
    adjustments: [],
  };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(history.monthlyDebtStreak, 1, 'sólo julio: junio (saldado, aunque tarde) corta la racha');
});

// ---------------------------------------------------------------------------
// Anulados: nunca cuentan
// ---------------------------------------------------------------------------

test('un cargo anulado no aparece en el historial ni afecta scoring, en-término/fuera-de-término ni racha', () => {
  const anulado = charge({
    id: 'c-anulado',
    studentId: 's1',
    dueDate: '2026-07-01',
    voidedAt: '2026-07-02T00:00:00.000Z',
    voidReason: 'clase cancelada',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [anulado] };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  const july = history.months[history.months.length - 1];
  assertEqual(july.category, null, 'un cargo anulado no genera categoría');
  assertEqual(history.currentDebt, 0, 'sin deuda');
  assertEqual(history.monthlyDebtStreak, 0, 'sin racha');
});

test('un pago anulado no cuenta como saldado: la obligación sigue en deuda', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const p = payment({ id: 'payment-1', studentId: 's1', amount: 10000, paidAt: '2026-07-05', voidedAt: '2026-07-06T00:00:00.000Z', voidReason: 'error' });
  const a = allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'c-1', studentId: 's1', amount: 10000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  const july = history.months[history.months.length - 1];
  assertEqual(july.category, 'mantiene_deuda', 'el pago anulado no salda la obligación');
  assert(history.currentDebt > 0, 'sigue debiendo');
});

// ---------------------------------------------------------------------------
// Pagos retroactivos: recalculan correctamente el historial pasado
// ---------------------------------------------------------------------------

test('un pago retroactivo corrige la categoría de un mes pasado de deuda a en término', () => {
  const c = charge({ id: 'c-mar', studentId: 's1', dueDate: '2026-03-01' });
  const stateBefore: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const historyBefore = buildStudentPaymentHistory({ studentId: 's1', state: stateBefore, evaluationDate: '2026-07-20' });
  const marchBefore = historyBefore.months.find((month) => month.period === '2026-03')!;
  assertEqual(marchBefore.category, 'mantiene_deuda', 'antes del pago retroactivo: marzo aparece como deuda');

  // Se carga hoy (25/07) un pago retroactivo con fecha real 05/03 (en término).
  const retroactivePayment = recordPayment({
    id: 'payment-retro',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-03-05',
    recordedAt: '2026-07-25T12:00:00.000Z',
    todayDateKey: '2026-07-25',
  });
  const stateWithPayment: PaymentsRepositoryState = { ...stateBefore, payments: [retroactivePayment] };
  const retroactiveAllocation = allocatePayment({
    id: 'alloc-retro',
    paymentId: 'payment-retro',
    chargeId: 'c-mar',
    amount: 10000,
    state: stateWithPayment,
  });
  const stateAfter: PaymentsRepositoryState = { ...stateWithPayment, allocations: [retroactiveAllocation] };

  const historyAfter = buildStudentPaymentHistory({ studentId: 's1', state: stateAfter, evaluationDate: '2026-07-25' });
  const marchAfter = historyAfter.months.find((month) => month.period === '2026-03')!;
  assertEqual(marchAfter.category, 'en_termino', 'después del pago retroactivo: marzo pasa a en término');
  assertEqual(historyAfter.onTimeCount, 1, 'ahora cuenta como pago en término');
  assertEqual(historyAfter.lateCount, 0, 'ya no cuenta como fuera de término');
});

// ---------------------------------------------------------------------------
// Historial insuficiente vs suficiente
// ---------------------------------------------------------------------------

test('historial insuficiente con menos de tres obligaciones resueltas', () => {
  const a = settledCharge({ id: 'c-a', studentId: 's1', dueDate: '2026-05-01', paidAt: '2026-05-05' });
  const b = settledCharge({ id: 'c-b', studentId: 's1', dueDate: '2026-06-01', paidAt: '2026-06-05' });
  const state: PaymentsRepositoryState = {
    charges: [a.charge, b.charge],
    payments: [a.payment, b.payment],
    allocations: [a.allocation, b.allocation],
    adjustments: [],
  };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(history.scoring.category, 'historial_insuficiente', 'sólo dos obligaciones resueltas');
  assertEqual(history.scoring.score, null, 'sin score numérico todavía');
});

test('historial suficiente con tres obligaciones resueltas en término: categoría excelente', () => {
  const a = settledCharge({ id: 'c-a', studentId: 's1', dueDate: '2026-04-01', paidAt: '2026-04-05' });
  const b = settledCharge({ id: 'c-b', studentId: 's1', dueDate: '2026-05-01', paidAt: '2026-05-05' });
  const c = settledCharge({ id: 'c-c', studentId: 's1', dueDate: '2026-06-01', paidAt: '2026-06-05' });
  const state: PaymentsRepositoryState = {
    charges: [a.charge, b.charge, c.charge],
    payments: [a.payment, b.payment, c.payment],
    allocations: [a.allocation, b.allocation, c.allocation],
    adjustments: [],
  };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(history.scoring.category, 'excelente', 'tres pagos en término: promedio 100');
  assertEqual(history.scoring.score, 100, 'score exacto');
});

// ---------------------------------------------------------------------------
// Aislamiento entre alumnos y no mutación
// ---------------------------------------------------------------------------

test('no mezcla obligaciones de otro alumno', () => {
  const mine = charge({ id: 'c-mine', studentId: 's1', dueDate: '2026-07-01' });
  const other = charge({ id: 'c-other', studentId: 's2', dueDate: '2026-07-01', originalAmount: 999999 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [mine, other] };
  const history = buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assert(history.currentDebt < 999999, 'no incluye la deuda del otro alumno');
});

test('no muta el estado recibido', () => {
  const c = charge({ id: 'c-1', studentId: 's1', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const snapshot = JSON.stringify(state);
  buildStudentPaymentHistory({ studentId: 's1', state, evaluationDate: '2026-07-20' });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});
