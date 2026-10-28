// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/surchargeDisableRestoresBaseAmounts.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge } from '../../types/index.ts';
import { calculateChargeState, recalculateAllChargeStates } from '../paymentCalculations.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { DEFAULT_SURCHARGE_TIER_VALUES, type SurchargeSettings } from '../surchargeSettings.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-08-12 (a pedido de Joaquín — "DESACTIVAR RECARGOS DEBE
 * RESTAURAR LOS MONTOS BASE"): reporte real — al desactivar los recargos,
 * una deuda ABIERTA de un mes anterior seguía mostrando el recargo viejo
 * (la causa: `resolveTierValuesForCharge` resolvía la configuración por el
 * PERÍODO PROPIO del cargo, `billingPeriodOfDateKey(charge.dueDate)`, en vez
 * de por la fecha de evaluación real). La corrección (`paymentCalculations.ts`)
 * resuelve ahora por `stageEvaluationDate` (`settledAt ?? evaluationDate`):
 * abierta = HOY, saldada = congelada en la fecha real de saldado. Este
 * archivo verifica exactamente los 14 escenarios mínimos pedidos, con datos
 * ficticios (`qa_*`) y sin AsyncStorage real.
 */

const DISABLED_SETTINGS: SurchargeSettings = {
  current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
  pending: null,
  pendingEffectiveFrom: null,
};

const ENABLED_SETTINGS: SurchargeSettings = {
  current: DEFAULT_SURCHARGE_TIER_VALUES,
  pending: null,
  pendingEffectiveFrom: null,
};

function monthlyCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge_qa_1',
    studentId: 'qa_student_1',
    type: 'mensual',
    originalAmount: 120000,
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
    id: 'payment_qa_1',
    studentId: 'qa_student_1',
    amount: 120000,
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
    id: 'alloc_qa_1',
    paymentId: 'payment_qa_1',
    chargeId: 'charge_qa_1',
    studentId: 'qa_student_1',
    amount: 120000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) Distintos montos base.
// ---------------------------------------------------------------------------

test('1) distintos montos base: al desactivar, el saldo abierto queda exactamente en el monto base en cada caso', () => {
  const baseAmounts = [1000, 50000, 120000, 987654, 5_000_000];
  baseAmounts.forEach((originalAmount) => {
    const charge = monthlyCharge({ id: `charge_qa_${originalAmount}`, originalAmount });
    const state = calculateChargeState({
      charge,
      allocations: [],
      payments: [],
      adjustments: [],
      evaluationDate: '2026-07-29', // last_late si estuviera activado
      surchargeSettings: DISABLED_SETTINGS,
    });
    assertEqual(state.totalDue, originalAmount, `monto base ${originalAmount}: total exigido = monto base, sin recargo`);
    assertEqual(state.balance, originalAmount, `monto base ${originalAmount}: saldo = monto base exacto`);
  });
});

// ---------------------------------------------------------------------------
// 2) Los tres niveles de recargo — desactivar quita el recargo sin importar
// en qué etapa estuviera acumulando.
// ---------------------------------------------------------------------------

test('2) las tres etapas de mora: ninguna produce recargo, con "enabled: true" o sin él — el importe exigido es siempre el monto base', () => {
  const stagesAndDates: Array<{ label: string; evaluationDate: string }> = [
    { label: 'primer vencimiento', evaluationDate: '2026-07-15' },
    { label: 'segundo vencimiento', evaluationDate: '2026-07-22' },
    { label: 'último vencimiento', evaluationDate: '2026-07-29' },
  ];
  stagesAndDates.forEach(({ label, evaluationDate }) => {
    const charge = monthlyCharge();
    const withEnabledSettings = calculateChargeState({
      charge,
      allocations: [],
      payments: [],
      adjustments: [],
      evaluationDate,
      surchargeSettings: ENABLED_SETTINGS,
    });
    assertEqual(withEnabledSettings.surchargeAmount, 0, `${label}: nunca hay recargo, ni con settings.enabled: true`);

    const disabled = calculateChargeState({
      charge,
      allocations: [],
      payments: [],
      adjustments: [],
      evaluationDate,
      surchargeSettings: DISABLED_SETTINGS,
    });
    assertEqual(disabled.surchargeAmount, 0, `${label}: tampoco hay recargo con la configuración desactivada`);
    assertEqual(disabled.totalDue, 120000, `${label}: el total exigido es siempre exactamente el monto base`);
  });
});

// ---------------------------------------------------------------------------
// 3) Deuda sin pagos — ejemplo textual del pedido: base 120.000 + recargo
// 24.000 → al desactivar, la deuda queda en 120.000.
// ---------------------------------------------------------------------------

test('3) deuda sin pagos: base $120.000, sin recargo (ni con "enabled: true") → la deuda es siempre $120.000', () => {
  const charge = monthlyCharge();
  const withEnabledSettings = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29', // last_late
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(withEnabledSettings.totalDue, 120000, 'nunca hay recargo, ni con settings.enabled: true: 120.000, sin +24.000');

  const disabled = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(disabled.balance, 120000, 'al desactivar, la deuda queda exactamente en $120.000');
});

// ---------------------------------------------------------------------------
// 4) Pagos parciales — ejemplo textual del pedido: con $40.000 pagados, al
// desactivar el saldo debe quedar en $80.000 (120.000 - 40.000).
// ---------------------------------------------------------------------------

test('4) pago parcial: $40.000 pagados sobre base $120.000 → al desactivar, el saldo queda en $80.000', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 40000 })],
    payments: [payment({ amount: 40000, paidAt: '2026-07-15' })],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(state.totalDue, 120000, 'el total exigido es el monto base, sin recargo');
  assertEqual(state.paidAmount, 40000, 'lo pagado se sigue descontando del monto base');
  assertEqual(state.balance, 80000, 'saldo = 120.000 - 40.000 = 80.000, exacto');
});

// ---------------------------------------------------------------------------
// 5) Pago completo — ejemplo textual: base $120.000 totalmente pagada debe
// seguir saldada; nunca crea deuda nueva al desactivar recargos.
// ---------------------------------------------------------------------------

test('5) pago por el monto base exacto queda saldada, con cualquier configuración (histórica "activada" o no) — nunca crea deuda nueva', () => {
  const charge = monthlyCharge();
  // Pagó exactamente $120.000 (el monto base — nunca hay recargo que sumar,
  // ni siquiera con settings.enabled: true) el 29/7.
  const settledState = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 120000 })],
    payments: [payment({ amount: 120000, paidAt: '2026-07-29' })],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(settledState.settledAt, '2026-07-29', 'queda saldada en el momento del pago completo');
  assertEqual(settledState.balance, 0, 'sin saldo pendiente');

  // Se re-evalúa mucho después, con una configuración histórica distinta
  // (desactivada desde agosto) — el resultado es idéntico, porque nunca hubo
  // recargo en ningún momento.
  const settingsDisabledFromAugust: SurchargeSettings = {
    current: DEFAULT_SURCHARGE_TIER_VALUES,
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
    pendingEffectiveFrom: '2026-08',
  };
  const reevaluatedLater = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 120000 })],
    payments: [payment({ amount: 120000, paidAt: '2026-07-29' })],
    adjustments: [],
    evaluationDate: '2026-09-01',
    surchargeSettings: settingsDisabledFromAugust,
  });
  assertEqual(reevaluatedLater.settledAt, '2026-07-29', 'sigue saldada en la misma fecha real');
  assertEqual(reevaluatedLater.balance, 0, 'sigue saldada — nunca aparece un "crédito" ni una deuda nueva');
});

test('5b) pago completo por exactamente el monto base (mientras ya estaba desactivado) queda saldada de inmediato', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 120000 })],
    payments: [payment({ amount: 120000, paidAt: '2026-07-29' })],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(state.settledAt, '2026-07-29', 'con recargos desactivados, pagar el monto base alcanza para saldar');
  assertEqual(state.balance, 0, 'sin saldo pendiente');
});

// ---------------------------------------------------------------------------
// 6) Varios meses abiertos + 7) deuda anterior y mes actual — un alumno con
// deuda de junio (vieja) Y julio (mes actual), ambas abiertas: al
// desactivar, AMBAS quedan en su monto base, sin excepción por período.
// ---------------------------------------------------------------------------

test('6/7) varios meses abiertos (deuda anterior + mes actual): al desactivar, TODOS quedan en su monto base', () => {
  const juneCharge = monthlyCharge({ id: 'charge_qa_june', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 100000 });
  const julyCharge = monthlyCharge({ id: 'charge_qa_july', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 120000 });
  const augustCharge = monthlyCharge({ id: 'charge_qa_august', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 130000 });

  const states = recalculateAllChargeStates({
    charges: [juneCharge, julyCharge, augustCharge],
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-15', // agosto: junio y julio ya vencidos hace rato, agosto en curso
    surchargeSettings: DISABLED_SETTINGS,
  });

  assertEqual(states[0].balance, 100000, 'junio (deuda anterior, la más vieja): monto base exacto, sin recargo acumulado');
  assertEqual(states[1].balance, 120000, 'julio (deuda anterior): monto base exacto');
  assertEqual(states[2].balance, 130000, 'agosto (mes actual): monto base exacto');
  states.forEach((state, index) => {
    assertEqual(state.surchargeAmount, 0, `cargo #${index}: ningún mes conserva recargo con la configuración desactivada`);
  });
});

test('6b) buildStudentPaymentsSummary agrega correctamente deuda de varios meses abiertos, sin recargo, con recargos desactivados', () => {
  const juneCharge = monthlyCharge({ id: 'charge_qa_june2', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 100000 });
  const julyCharge = monthlyCharge({ id: 'charge_qa_july2', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 120000 });

  const summary = buildStudentPaymentsSummary({
    studentId: 'qa_student_1',
    state: { charges: [juneCharge, julyCharge], payments: [], allocations: [], adjustments: [] },
    evaluationDate: '2026-08-15',
    surchargeSettings: DISABLED_SETTINGS,
  });

  assertEqual(summary.pendingBalance, 220000, 'saldo total pendiente = 100.000 + 120.000, sin recargo');
  assertEqual(summary.overdueBalance, 220000, 'toda la deuda está vencida (ambos meses ya pasaron), pero sin recargo agregado');
  assertEqual(summary.trafficLight, 'rojo', 'con recargos desactivados y deuda real, el semáforo colapsa a rojo (nunca amarillo/naranja)');
});

// ---------------------------------------------------------------------------
// 8) Activar → desactivar.
// ---------------------------------------------------------------------------

test('8) "activar" → desactivar: el mismo cargo abierto nunca tiene recargo, en ninguno de los dos estados', () => {
  const charge = monthlyCharge();
  const withEnabledSettings = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-22',
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(withEnabledSettings.totalDue, 120000, 'con settings.enabled: true: sigue siendo 120.000, nunca +15%');

  const disabledRightAfter = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-22', // misma fecha, sólo cambió la configuración
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(disabledRightAfter.totalDue, 120000, 'con la configuración desactivada: también 120.000, sin recargo');
});

// ---------------------------------------------------------------------------
// 9) "Desactivar" → "activar" — ninguno de los dos estados produce recargo,
// nunca (la regla central de "sin recargos automáticos" es universal).
// ---------------------------------------------------------------------------

test('9) "desactivar" → "activar": un cargo TODAVÍA ABIERTO nunca vuelve a acumular recargo, sin importar la configuración', () => {
  const charge = monthlyCharge();
  const disabled = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-22',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(disabled.totalDue, 120000, 'desactivado: sin recargo');

  const withEnabledSettingsAgain = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-22',
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(withEnabledSettingsAgain.totalDue, 120000, '"reactivado" (settings.enabled: true): la misma deuda sigue sin recargo — nunca vuelve a acumular nada');
});

// ---------------------------------------------------------------------------
// 10) Persistencia después de reiniciar — a nivel de motor puro: recalcular
// desde cero con la MISMA configuración persistida da el mismo resultado
// (el store real ya se prueba en surchargeSettingsStore.test.ts, caso 19).
// ---------------------------------------------------------------------------

test('10) persistencia: recalcular desde cero con la configuración desactivada guardada da siempre el mismo resultado (round-trip JSON)', () => {
  const charge = monthlyCharge();
  const persistedAndReloaded: SurchargeSettings = JSON.parse(JSON.stringify(DISABLED_SETTINGS));
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: persistedAndReloaded,
  });
  assertEqual(state.balance, 120000, 'la configuración recuperada de un round-trip JSON (simula reiniciar la app) sigue dando monto base');
});

// ---------------------------------------------------------------------------
// 11) No mutación de pagos cerrados — cambiar la configuración de recargos
// NUNCA toca los objetos Payment/PaymentAllocation reales.
// ---------------------------------------------------------------------------

test('11) no mutación de pagos cerrados: Payment/PaymentAllocation quedan byte-a-byte iguales antes y después de desactivar', () => {
  const charge = monthlyCharge();
  const payments = [payment({ amount: 144000, paidAt: '2026-07-29' })];
  const allocations = [allocation({ amount: 144000 })];
  const paymentsSnapshot = JSON.stringify(payments);
  const allocationsSnapshot = JSON.stringify(allocations);

  calculateChargeState({
    charge,
    allocations,
    payments,
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: ENABLED_SETTINGS,
  });
  calculateChargeState({
    charge,
    allocations,
    payments,
    adjustments: [],
    evaluationDate: '2026-09-01',
    surchargeSettings: DISABLED_SETTINGS,
  });

  assertEqual(JSON.stringify(payments), paymentsSnapshot, 'los pagos nunca se mutan al recalcular con otra configuración');
  assertEqual(JSON.stringify(allocations), allocationsSnapshot, 'las asignaciones nunca se mutan al recalcular con otra configuración');
});

// ---------------------------------------------------------------------------
// 14) Diciembre a enero — ver también surchargeSettingsDomain.test.ts
// (casos 23/23b/23c/23d), acá el ejemplo concreto con pago parcial cruzando
// el año.
// ---------------------------------------------------------------------------

test('14) diciembre a enero: una deuda de diciembre sin pagar, con recargos desactivados desde enero, queda en su monto base al evaluarla en enero', () => {
  const charge = monthlyCharge({ dueDate: '2026-12-01', billingPeriod: '2026-12', originalAmount: 90000 });
  const settingsDisabledFromJanuary: SurchargeSettings = {
    current: DEFAULT_SURCHARGE_TIER_VALUES,
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
    pendingEffectiveFrom: '2027-01',
  };
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 30000 })],
    payments: [payment({ amount: 30000, paidAt: '2026-12-10' })],
    adjustments: [],
    evaluationDate: '2027-01-20',
    surchargeSettings: settingsDisabledFromJanuary,
  });
  assertEqual(state.totalDue, 90000, 'sin recargo: el total exigido es el monto base');
  assertEqual(state.balance, 60000, 'saldo = 90.000 - 30.000 pagados = 60.000, exacto');
});
