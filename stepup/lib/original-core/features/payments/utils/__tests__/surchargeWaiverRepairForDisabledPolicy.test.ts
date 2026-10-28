// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/surchargeWaiverRepairForDisabledPolicy.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { planSurchargeWaiverRepairForDisabledPolicy } from '../financialReconciliation.ts';
import { calculateChargeState, isSurchargeWaivedForCharge } from '../paymentCalculations.ts';
import { buildCollectionsCenterEntries } from '../collectionsCenter.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { DEFAULT_SURCHARGE_TIER_VALUES, type SurchargeSettings } from '../surchargeSettings.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO REAL: una
 * clase suelta de $27.500 pagada tarde, con recargos YA DESACTIVADOS, seguía
 * apareciendo en Centro de cobros con un saldo pendiente de $4.125, exactos
 * 15% de $27.500).
 *
 * Causa raíz real: el motor puro (`calculateChargeState`) siempre fue
 * correcto — resuelve el recargo con la configuración VIGENTE al momento de
 * evaluar (ver `surchargeDisableRestoresBaseAmounts.test.ts`). El bug estaba
 * en que muchos consumidores (formulario "Registrar pago", el registro de
 * pago de una clase suelta, el análisis de reconciliación, el resumen de
 * dashboard, etc.) nunca pasaban la configuración real de recargos —
 * quedaban con el default (`DEFAULT_SURCHARGE_SETTINGS`, recargos
 * ACTIVADOS) sin importar lo que la profesora hubiera configurado. Ese
 * defecto de wiring ya se corrigió en cada consumidor real.
 *
 * Esta prueba cubre la pieza que sólo se necesita para cargos VIEJOS: uno
 * que, mientras los recargos SÍ estaban activados, quedó con el recargo
 * pagado a medias o sin pagar. Wiring por sí solo no alcanza para esos casos
 * porque, si algún día se reactivan los recargos, `calculateChargeState`
 * volvería a exigir esa porción (nunca "inventa" saldo a favor, pero tampoco
 * "recuerda" que alguna vez se decidió no cobrarla). `planSurchargeWaiverRepairForDisabledPolicy`
 * cierra ese caso para siempre con una condonación real (`PaymentAdjustment`),
 * reutilizando el mecanismo manual ya existente — nunca borra ni reescribe
 * `Payment`/`PaymentAllocation`, nunca toca `originalAmount`.
 */

const ENABLED_SETTINGS: SurchargeSettings = {
  current: DEFAULT_SURCHARGE_TIER_VALUES,
  pending: null,
  pendingEffectiveFrom: null,
};

const DISABLED_SETTINGS: SurchargeSettings = {
  current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
  pending: null,
  pendingEffectiveFrom: null,
};

/**
 * Representa la única forma real, dentro del dominio (`current`/`pending`/
 * `pendingEffectiveFrom`), de modelar "el recargo SÍ regía cuando se generó
 * y se pagó tarde, y está desactivado desde entonces (incluido hoy)": el
 * período de pago queda antes de `period`, así que en ese momento histórico
 * `resolveEffectiveSurchargeTierValues` sigue resolviendo `current`
 * (activado) — y cualquier evaluación desde `period` en adelante resuelve
 * `pending` (desactivado). Con una configuración desactivada SIEMPRE (sin
 * transición), el motor ya salda retroactivamente el cargo sin necesidad de
 * ninguna reparación — por eso esa variante (ver casos "desde el inicio")
 * usa `DISABLED_SETTINGS` directo, sin transición.
 */
function settingsDisabledFrom(period: string): SurchargeSettings {
  return {
    current: DEFAULT_SURCHARGE_TIER_VALUES,
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
    pendingEffectiveFrom: period,
  };
}

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; dueDate: string; billingPeriod: string }): PaymentCharge {
  return {
    type: 'por_clase',
    originalAmount: 27500,
    currency: 'ARS',
    createdAt: `${overrides.dueDate}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string; amount: number; paidAt: string }): Payment {
  return {
    currency: 'ARS',
    method: 'efectivo',
    recordedAt: `${overrides.paidAt}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string; amount: number }): PaymentAllocation {
  return { ...overrides };
}

// ---------------------------------------------------------------------------
// PRUEBA DE REGRESIÓN PRINCIPAL — caso exacto del reporte (genérico: base
// $27.500, recargo configurado 15%, total con recargo $31.625, pago real
// $27.500, recargos actualmente desactivados).
// ---------------------------------------------------------------------------

// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): el CASO PRINCIPAL original probaba que un
// recargo YA ACUMULADO en julio (mientras "estaba activado") dejaba un
// remanente ($4.125) que esta reparación debía condonar para poder saldar
// el cargo. Ese escenario ya no puede ocurrir NUNCA: `calculateSurchargeAmount`
// (`paymentDueStage.ts`) devuelve siempre 0, sin importar qué
// `surchargeSettings` se le pase (ni siquiera uno que reclame `enabled: true`
// para julio) — así que el pago de $27.500 contra un cargo de $27.500 salda
// la obligación de inmediato, sin necesidad de ninguna condonación.
test('CASO PRINCIPAL: clase suelta $27.500 pagada por el monto base exacto → ya salda sola, sin necesitar ninguna reparación (nunca hubo recargo que condonar)', () => {
  const c = charge({ id: 'c_main', studentId: 'qa_alumna', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_main', studentId: 'qa_alumna', amount: 27500, paidAt: '2026-07-12' });
  const a = allocation({ id: 'a_main', paymentId: 'p_main', chargeId: 'c_main', studentId: 'qa_alumna', amount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  // Aunque `settings` reclame que julio tenía recargos "activados" y agosto
  // los desactiva, el resultado es idéntico en ambos períodos: nunca hay
  // recargo real.
  const settings = settingsDisabledFrom('2026-08');

  const beforeRepair = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(beforeRepair.surchargeAmount, 0, 'nunca hay recargo, sin importar la configuración histórica');
  assertEqual(beforeRepair.balance, 0, 'saldo $0: el pago exacto del importe base ya alcanza para saldar');
  assert(beforeRepair.settledAt !== null, 'ya queda formalmente saldado, SIN necesitar ninguna reparación — nunca hubo remanente de recargo');

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nada que condonar: nunca hubo recargo acumulado');
  assertEqual(plan.updatedAdjustments.length, 0, 'no agrega ninguna condonación');

  // El pago real queda exactamente igual — nunca se borra, reduce ni reescribe.
  assertEqual(state.payments.length, 1, 'el pago real se preserva, no se duplica ni se borra');
  assertEqual(state.payments[0].amount, 27500, 'el importe del pago real no cambia');
  assertEqual(state.allocations.length, 1, 'la asignación real se preserva');
  assertEqual(state.allocations[0].amount, 27500, 'el importe de la asignación real no cambia');

  // Nunca aparece en Centro de cobros como deuda.
  const entries = buildCollectionsCenterEntries({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(entries.length, 0, 'no aparece en Centro de cobros como deuda pendiente');

  // No aparece en el saldo pendiente agregado (Home y demás consumidores).
  const summary = buildStudentPaymentsSummary({
    studentId: 'qa_alumna',
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(summary.pendingBalance, 0, 'el saldo pendiente agregado (Home) queda en $0');

  // Sobrevive reapertura/hidratación/restauración: recalcular desde cero con
  // el mismo estado persistido (round-trip JSON) da el mismo resultado.
  const reloaded: PaymentsRepositoryState = JSON.parse(JSON.stringify(state));
  const afterReload = calculateChargeState({
    charge: reloaded.charges[0],
    allocations: reloaded.allocations,
    payments: reloaded.payments,
    adjustments: reloaded.adjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(afterReload.balance, 0, 'tras un round-trip JSON (simula reabrir la app), el saldo sigue en $0');

  // Segunda corrida: sigue sin encontrar nada (idempotente).
  const secondPlan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-09-15',
    surchargeSettings: settings,
    createdAt: '2026-09-15T12:00:00.000Z',
  });
  assertEqual(secondPlan.actions.length, 0, 'segunda corrida: sigue sin haber nada que condonar');
  assertEqual(secondPlan.updatedAdjustments.length, 0, 'nunca agrega condonaciones');
});

// ---------------------------------------------------------------------------
// Recargos activados: sigue funcionando sin cambios (la reparación nunca
// actúa mientras la política sigue activada).
// ---------------------------------------------------------------------------

test('"recargos activados" (settings.enabled: true): tampoco produce recargo real — la reparación nunca tiene nada que condonar', () => {
  const c = charge({ id: 'c_enabled', studentId: 'qa_2', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_enabled', studentId: 'qa_2', amount: 27500, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_enabled', paymentId: 'p_enabled', chargeId: 'c_enabled', studentId: 'qa_2', amount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: ENABLED_SETTINGS,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'con "enabled: true" tampoco condona nada: nunca hay nada que condonar');
  assertEqual(plan.updatedAdjustments, state.adjustments, 'no toca las condonaciones existentes');

  const stateAfter: PaymentsRepositoryState = { ...state, adjustments: plan.updatedAdjustments };
  const chargeState = calculateChargeState({
    charge: c,
    allocations: stateAfter.allocations,
    payments: stateAfter.payments,
    adjustments: stateAfter.adjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(chargeState.surchargeAmount, 0, 'nunca hay recargo real, ni con settings.enabled: true');
  assertEqual(chargeState.balance, 0, 'el pago del importe base ya salda la obligación, sin condonar nada');
});

// ---------------------------------------------------------------------------
// Pago parcial inferior al importe base: la reparación nunca condona deuda
// de capital real, sólo la porción de recargo.
// ---------------------------------------------------------------------------

test('pago parcial inferior al importe base: la reparación no actúa, el saldo base real se conserva íntegro', () => {
  const c = charge({ id: 'c_partial', studentId: 'qa_3', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_partial', studentId: 'qa_3', amount: 10000, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_partial', paymentId: 'p_partial', chargeId: 'c_partial', studentId: 'qa_3', amount: 10000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'pago parcial por debajo del importe base: nunca condona (no está cubierto el capital)');

  const chargeState = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: plan.updatedAdjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(chargeState.balance, 17500, 'saldo = 27.500 - 10.000 = 17.500, el capital real se conserva íntegro');
});

// ---------------------------------------------------------------------------
// Cargo sin pagos: vuelve al importe base, la reparación no actúa (no hay
// nada pagado, mucho menos el capital cubierto).
// ---------------------------------------------------------------------------

test('cargo sin pagos: no se condona nada, el saldo es el importe base completo', () => {
  const c = charge({ id: 'c_nopay', studentId: 'qa_4', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [], allocations: [], adjustments: [] };

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'sin pagos: nunca condona nada');

  const chargeState = calculateChargeState({
    charge: c,
    allocations: [],
    payments: [],
    adjustments: plan.updatedAdjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(chargeState.balance, 27500, 'saldo = importe base completo, sin recargo');
});

// ---------------------------------------------------------------------------
// Recargo parcialmente pagado: la reparación nunca borra ese movimiento —
// sólo condona lo que TODAVÍA falta pagar del recargo.
// ---------------------------------------------------------------------------

test('pago superior al importe base ($27.500 + $2.000 de más): nunca hay recargo que condonar, el excedente queda como saldo a favor', () => {
  const c = charge({ id: 'c_partsur', studentId: 'qa_5', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_partsur', studentId: 'qa_5', amount: 29500, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_partsur', paymentId: 'p_partsur', chargeId: 'c_partsur', studentId: 'qa_5', amount: 29500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const settings = settingsDisabledFrom('2026-08');

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nada que condonar: nunca hubo recargo, el pago ya cubre y excede el importe base');

  assertEqual(state.payments[0].amount, 29500, 'el pago real no se toca');
  assertEqual(state.allocations[0].amount, 29500, 'la asignación real no se toca');

  const chargeState = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: plan.updatedAdjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(chargeState.surchargeAmount, 0, 'nunca hay recargo real');
  // Como pagó de más contra el importe base, queda saldo a favor (crédito)
  // — nunca deuda, y el excedente nunca se borra ni se inventa una devolución.
  assertEqual(chargeState.balance, -2000, 'saldo a favor exacto por el excedente pagado ($29.500 - $27.500)');
});

test('recargo totalmente pagado (mientras estaba activado): la reparación no tiene nada que condonar, no duplica ni borra movimientos', () => {
  const c = charge({ id: 'c_fullsur', studentId: 'qa_6', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_fullsur', studentId: 'qa_6', amount: 31625, paidAt: '2026-07-12' });
  const a = allocation({ id: 'a_fullsur', paymentId: 'p_fullsur', chargeId: 'c_fullsur', studentId: 'qa_6', amount: 31625 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  // Ya saldado en su momento (con recargos activados) — `settledAt` ya no es
  // null, así que la reparación no debe tocarlo (historia cerrada).
  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settingsDisabledFrom('2026-08'),
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'ya saldado en su momento: la reparación no tiene nada que hacer');
  assertEqual(plan.updatedAdjustments.length, 0, 'no agrega condonaciones sobre historia ya cerrada');
});

// ---------------------------------------------------------------------------
// Mensualidad (no sólo clase suelta) — misma regla, cualquier tipo de cargo
// compatible con recargos.
// ---------------------------------------------------------------------------

test('mensualidad pagada por el importe base exacto: ya salda sola, sin necesitar reparación, igual que una clase suelta', () => {
  const c = charge({ id: 'c_month', studentId: 'qa_7', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 120000, type: 'mensual' });
  const p = payment({ id: 'p_month', studentId: 'qa_7', amount: 120000, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_month', paymentId: 'p_month', chargeId: 'c_month', studentId: 'qa_7', amount: 120000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const settings = settingsDisabledFrom('2026-08');

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'mensualidad: tampoco hay nada que condonar, igual que una clase suelta');

  const chargeState = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: plan.updatedAdjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
  });
  assertEqual(chargeState.balance, 0, 'mensualidad: saldo $0, igual que una clase suelta');
});

// ---------------------------------------------------------------------------
// Configuración desactivada DESDE EL INICIO — nunca llegó a generarse
// recargo: no hay nada que condonar, el flujo normal ya alcanza.
// ---------------------------------------------------------------------------

test('configuración desactivada desde el inicio: nunca se generó recargo, la reparación no tiene nada que hacer', () => {
  const c = charge({ id: 'c_always_off', studentId: 'qa_8', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_always_off', studentId: 'qa_8', amount: 27500, paidAt: '2026-07-05' });
  const a = allocation({ id: 'a_always_off', paymentId: 'p_always_off', chargeId: 'c_always_off', studentId: 'qa_8', amount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  // Pagó a tiempo, sin recargo activado nunca: ya queda saldado por el
  // motor puro sin necesidad de ninguna condonación.
  const chargeStateBefore = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assert(chargeStateBefore.settledAt !== null, 'sin recargo nunca activado, ya queda saldado sin condonación');

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nada que reparar: nunca hubo recargo generado');
});

// ---------------------------------------------------------------------------
// Configuración desactivada DESPUÉS de haberse generado el recargo — el
// escenario central del reporte, con la vigencia (`pending`) real, no un
// snapshot separado.
// ---------------------------------------------------------------------------

test('configuración con vigencia real (julio "activada", agosto desactivada): en ambos períodos el resultado es idéntico — nunca hay recargo que condonar', () => {
  const c = charge({ id: 'c_disabled_later', studentId: 'qa_9', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_disabled_later', studentId: 'qa_9', amount: 27500, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_disabled_later', paymentId: 'p_disabled_later', chargeId: 'c_disabled_later', studentId: 'qa_9', amount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };

  const settingsDisabledFromAugust = settingsDisabledFrom('2026-08');

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settingsDisabledFromAugust,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nada que condonar, con cualquier vigencia real');

  const chargeState = calculateChargeState({
    charge: c,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: plan.updatedAdjustments,
    evaluationDate: '2026-08-31',
    surchargeSettings: settingsDisabledFromAugust,
  });
  assertEqual(chargeState.balance, 0, 'saldo $0, sin necesitar condonar nada');
});

// ---------------------------------------------------------------------------
// No toca cargos sin recargo pendiente: un cargo ya condonado antes no se
// condona dos veces (no duplica movimientos).
// ---------------------------------------------------------------------------

test('reparación repetida (dos pasadas, distintas fechas): idempotente — nunca encuentra nada que condonar en ninguna de las dos', () => {
  const c = charge({ id: 'c_already', studentId: 'qa_10', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 27500 });
  const p = payment({ id: 'p_already', studentId: 'qa_10', amount: 27500, paidAt: '2026-07-22' });
  const a = allocation({ id: 'a_already', paymentId: 'p_already', chargeId: 'c_already', studentId: 'qa_10', amount: 27500 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const settings = settingsDisabledFrom('2026-08');

  const firstPlan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: settings,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(firstPlan.actions.length, 0, 'primera pasada: nada que condonar, ya está saldado por el importe base');

  const secondPlan = planSurchargeWaiverRepairForDisabledPolicy({
    state: { ...state, adjustments: firstPlan.updatedAdjustments },
    evaluationDate: '2026-10-01',
    surchargeSettings: settings,
    createdAt: '2026-10-01T12:00:00.000Z',
  });
  assertEqual(secondPlan.actions.length, 0, 'segunda pasada: sigue sin haber nada que condonar');
  assertEqual(secondPlan.updatedAdjustments.length, 0, 'nunca crea condonaciones — no hace falta ninguna');
  assert(!isSurchargeWaivedForCharge('c_already', secondPlan.updatedAdjustments), 'el cargo nunca necesitó condonación: se saldó solo, por el importe base');
});

// ---------------------------------------------------------------------------
// Cargo anulado: nunca se toca (ni de capital ni de recargo).
// ---------------------------------------------------------------------------

test('cargo anulado: la reparación nunca lo toca, aunque tenga un recargo persistido', () => {
  const c = charge({
    id: 'c_voided',
    studentId: 'qa_11',
    dueDate: '2026-07-01',
    billingPeriod: '2026-07',
    originalAmount: 27500,
    voidedAt: '2026-07-10T00:00:00.000Z',
    voidReason: 'error de carga',
  });
  const state: PaymentsRepositoryState = { charges: [c], payments: [], allocations: [], adjustments: [] };

  const plan = planSurchargeWaiverRepairForDisabledPolicy({
    state,
    evaluationDate: '2026-08-31',
    surchargeSettings: DISABLED_SETTINGS,
    createdAt: '2026-08-31T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'un cargo anulado nunca se condona');
});
