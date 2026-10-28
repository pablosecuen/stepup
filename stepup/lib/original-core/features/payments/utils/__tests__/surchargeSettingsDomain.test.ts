// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/surchargeSettingsDomain.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge } from '../../types/index.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { resolveStudentMonthlyCardStatus } from '../monthlyPeriodStatus.ts';
import { clampDayToBillingPeriod, lastDayOfBillingPeriod, nextBillingPeriod } from '../paymentDates.ts';
import { DEFAULT_SURCHARGE_SETTINGS, DEFAULT_SURCHARGE_TIER_VALUES, proposeSurchargeSettingsChange, resolveEffectiveSurchargeTierValues, validateSurchargeTierValues, type SurchargeSettings, type SurchargeTierValues } from '../surchargeSettings.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): las 28
 * pruebas obligatorias del pedido. Este archivo cubre las que son puramente
 * de motor de dominio (1-9, 15, 22-24 y las validaciones de los 7 campos
 * editables); las de store/servicio/UI viven en
 * `surchargeSettingsStore.test.ts` y `surchargeSettingsService.test.ts`.
 */

const DISABLED_SETTINGS: SurchargeSettings = {
  current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
  pending: null,
  pendingEffectiveFrom: null,
};

function monthlyCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
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

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): el Caso 1 original probaba que, con
// `DEFAULT_SURCHARGE_TIER_VALUES` (entonces `enabled: true`), cada etapa de
// mora sumaba su porcentaje real al importe. Esa premisa ya no existe —
// `calculateSurchargeAmount` (`paymentDueStage.ts`) devuelve SIEMPRE 0, sin
// importar `enabled` ni ningún otro campo de `SurchargeTierValues`. La
// etapa (`stage`) se sigue calculando exactamente igual (mora VISUAL, ver
// `determineDueStage`) — lo único que cambió es que ninguna etapa aumenta
// nunca el importe.
// ---------------------------------------------------------------------------

test('1. vencer un cargo cambia su ETAPA de mora (visual) pero nunca su importe — en ninguna de las 3 etapas', () => {
  const charge = monthlyCharge();
  const firstLate = calculateChargeState({
    charge, allocations: [], payments: [], adjustments: [],
    evaluationDate: '2026-07-15', // día 15: first_late (11-18)
  });
  const secondLate = calculateChargeState({
    charge, allocations: [], payments: [], adjustments: [],
    evaluationDate: '2026-07-22', // día 22: second_late (19-26)
  });
  const lastLate = calculateChargeState({
    charge, allocations: [], payments: [], adjustments: [],
    evaluationDate: '2026-07-29', // día 29: last_late (27+)
  });
  assertEqual(firstLate.stage, 'first_late', 'la etapa avanza con los días de atraso reales (mora visual)');
  assertEqual(secondLate.stage, 'second_late', 'la etapa avanza con los días de atraso reales (mora visual)');
  assertEqual(lastLate.stage, 'last_late', 'la etapa avanza con los días de atraso reales (mora visual)');
  [firstLate, secondLate, lastLate].forEach((state, index) => {
    assertEqual(state.surchargeAmount, 0, `etapa #${index}: nunca hay recargo automático, sin importar la mora`);
    assertEqual(state.totalDue, 10000, `etapa #${index}: el importe adeudado es siempre el original, nunca aumentado`);
  });
});

// ---------------------------------------------------------------------------
// Caso 2: recargos desactivados antes del vencimiento.
// ---------------------------------------------------------------------------

test('2. recargos desactivados antes del vencimiento: sin recargo, importe original intacto', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-05', // día 5: en término de todas formas
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(state.stage, 'on_time', 'sigue en término');
  assertEqual(state.surchargeAmount, 0, 'sin recargo con la configuración desactivada');
  assertEqual(state.totalDue, 10000, 'nunca aumenta el importe original');
});

// ---------------------------------------------------------------------------
// Caso 3: recargos desactivados después del vencimiento.
// ---------------------------------------------------------------------------

test('3. recargos desactivados después del vencimiento: sin recargo aunque la etapa real sea "último vencimiento"', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29', // día 29: hubiera sido last_late si estuviera activado
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(state.stage, 'last_late', 'la etapa real se sigue calculando (puntualidad/scoring)');
  assertEqual(state.surchargeAmount, 0, 'nunca aumenta el importe original con los recargos desactivados');
  assertEqual(state.totalDue, 10000, 'el total adeudado es exactamente el importe original');
});

// ---------------------------------------------------------------------------
// Casos 4 y 5: "Al día" / "Mes vencido" en la interfaz del alumno, con
// recargos desactivados — nunca Primer/Segundo/Último vencimiento.
// ---------------------------------------------------------------------------

const monthlyPlan: StudentBillingPlan = { type: 'monthly', amount: 10000, dueDay: 1 };

test('4. alumno pagado a término: nunca se muestra como vencido, con recargos desactivados o no', () => {
  const charge = monthlyCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-07-05' })],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(result.status, 'pagado', 'un alumno pagado nunca aparece como vencido');
  assertEqual(result.balance, 0, 'sin saldo pendiente');
});

test('5. alumno impago vencido con recargos desactivados: "Mes vencido", deuda EXACTAMENTE igual al importe original', () => {
  const charge = monthlyCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-07-29',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(result.status, 'vencido_sin_recargo', 'nunca primer/segundo/último vencimiento con recargos desactivados');
  assertEqual(result.label, 'Mes vencido', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusRojo', 'color de deuda, nunca sólo texto');
  assertEqual(result.balance, 10000, 'la deuda es exactamente el importe original, sin recargo agregado');
});

// ---------------------------------------------------------------------------
// Casos 6 y 7: pago parcial y pago completo.
// ---------------------------------------------------------------------------

test('6. pago parcial reduce correctamente el saldo (sin recargo, aunque el cargo esté en mora)', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 4000 })],
    payments: [payment({ amount: 4000, paidAt: '2026-07-15' })],
    adjustments: [],
    evaluationDate: '2026-07-15', // first_late (mora visual), pero el recargo nunca se aplica
  });
  assertEqual(state.stage, 'first_late', 'la mora visual sigue calculándose');
  assertEqual(state.totalDue, 10000, 'el total exigido es siempre el importe original, nunca con recargo');
  assertEqual(state.paidAmount, 4000, 'lo pagado hasta ahora');
  assertEqual(state.balance, 6000, 'saldo = importe original - pagado, nunca más');
  assertEqual(state.settledAt, null, 'todavía no queda saldada');
});

test('6b. pago parcial con recargos desactivados: el saldo nunca incluye un recargo inexistente', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 4000 })],
    payments: [payment({ amount: 4000, paidAt: '2026-07-15' })],
    adjustments: [],
    evaluationDate: '2026-07-15',
    surchargeSettings: DISABLED_SETTINGS,
  });
  assertEqual(state.totalDue, 10000, 'sin recargo, el total exigido es el importe original');
  assertEqual(state.balance, 6000, 'saldo = importe original - pagado, nunca más');
});

test('7. pago completo salda la obligación exactamente por el importe original (sin recargo, aunque esté en mora)', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-07-15' })],
    adjustments: [],
    evaluationDate: '2026-07-15', // first_late (mora visual) — el importe a saldar sigue siendo el original
  });
  assertEqual(state.settledAt, '2026-07-15', 'queda saldada el día del pago completo');
  assertEqual(state.balance, 0, 'sin saldo pendiente');
});

// ---------------------------------------------------------------------------
// Casos 8 y 9: paidAt (real) vs recordedAt (carga administrativa) — el
// recargo SIEMPRE se decide con paidAt, nunca con recordedAt.
// ---------------------------------------------------------------------------

test('8. pago retroactivo mediante paidAt: pagado en término aunque se evalúe mucho después, sin recargo', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    // Pagó el 5/7 (en término) pero se evalúa hoy, 29/7 — el recargo se
    // decide con paidAt (la fecha real del pago), nunca con evaluationDate.
    payments: [payment({ amount: 10000, paidAt: '2026-07-05', recordedAt: '2026-07-05T12:00:00.000Z' })],
    adjustments: [],
    evaluationDate: '2026-07-29',
  });
  assertEqual(state.settledAt, '2026-07-05', 'se salda en la fecha real del pago, en término');
  assertEqual(state.balance, 0, 'sin recargo: pagó dentro del plazo aunque se evalúe después');
});

test('9. pago cargado tarde mediante recordedAt: un pago en término registrado tarde en la app no recibe recargo', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    // paidAt sigue siendo el 5/7 (en término); recordedAt es 3 semanas
    // después (carga tardía en la app) — no debe afectar el recargo.
    payments: [payment({ amount: 10000, paidAt: '2026-07-05', recordedAt: '2026-07-26T09:00:00.000Z' })],
    adjustments: [],
    evaluationDate: '2026-07-26',
  });
  assertEqual(state.settledAt, '2026-07-05', 'la fecha de saldado usa paidAt, nunca recordedAt');
  assertEqual(state.balance, 0, 'sin recargo pese a la carga tardía en la app');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada): el Caso 15 original probaba que un recargo YA ACUMULADO se
// conservaba histórico aunque la configuración cambiara después — ese
// escenario ya no puede ocurrir (nunca hay recargo que acumular). Se
// reemplaza por la prueba que sí importa ahora: una configuración
// HISTÓRICA persistida con `enabled: true` real (de antes de esta decisión,
// o restaurada de un backup viejo) se normaliza a desactivada al evaluarse
// — nunca revive un recargo, ni siquiera para un cargo de un período
// pasado.
// ---------------------------------------------------------------------------

test('15. una configuración histórica con enabled: true persistido nunca aplica recargo, ni siquiera a un cargo de un período ya vencido', () => {
  const charge = monthlyCharge({ dueDate: '2026-07-01', billingPeriod: '2026-07' });
  const historicalSettingsWithSurchargeOn: SurchargeSettings = {
    current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true },
    pending: null,
    pendingEffectiveFrom: null,
  };
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29', // last_late si el recargo estuviera activo
    surchargeSettings: historicalSettingsWithSurchargeOn,
  });
  assertEqual(state.stage, 'last_late', 'la mora visual se sigue calculando normalmente');
  assertEqual(state.surchargeAmount, 0, 'una configuración histórica con enabled: true se normaliza a desactivada — nunca aplica recargo');
  assertEqual(state.totalDue, 10000, 'el importe adeudado es siempre el original, sin importar qué traiga la configuración persistida');
});

// ---------------------------------------------------------------------------
// Caso 22: meses de 28/29/30/31 días — resolución segura del día configurado.
// ---------------------------------------------------------------------------

test('22. lastDayOfBillingPeriod resuelve correctamente 28 (feb no bisiesto), 29 (feb bisiesto), 30 y 31', () => {
  assertEqual(lastDayOfBillingPeriod('2026-02'), 28, 'febrero 2026 no es bisiesto');
  assertEqual(lastDayOfBillingPeriod('2028-02'), 29, 'febrero 2028 es bisiesto');
  assertEqual(lastDayOfBillingPeriod('2026-04'), 30, 'abril tiene 30 días');
  assertEqual(lastDayOfBillingPeriod('2026-07'), 31, 'julio tiene 31 días');
});

test('22b. clampDayToBillingPeriod nunca propone un día que no existe en el mes real', () => {
  assertEqual(clampDayToBillingPeriod(31, '2026-02'), 28, 'el día 31 en febrero se resuelve al último día real');
  assertEqual(clampDayToBillingPeriod(31, '2028-02'), 29, 'el día 31 en un febrero bisiesto se resuelve a 29');
  assertEqual(clampDayToBillingPeriod(15, '2026-02'), 15, 'un día que sí existe queda sin cambios');
  assertEqual(clampDayToBillingPeriod(31, '2026-07'), 31, 'julio sí tiene día 31, no se recorta');
});

test('22c. el motor de etapas nunca se rompe en un mes corto: el día 27 de un febrero de 28 días sigue siendo último vencimiento', () => {
  const charge = monthlyCharge({ dueDate: '2026-02-01', billingPeriod: '2026-02' });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-02-27', // día 27 del mes: last_late según los umbrales por defecto
  });
  assertEqual(state.stage, 'last_late', 'el umbral de días transcurridos no depende de cuántos días tiene el mes calendario');
});

// ---------------------------------------------------------------------------
// Caso 23: diciembre a enero.
// ---------------------------------------------------------------------------

test('23. nextBillingPeriod cruza diciembre a enero correctamente', () => {
  assertEqual(nextBillingPeriod('2026-12'), '2027-01', 'diciembre pasa a enero del año siguiente');
});

test('23b. resolveEffectiveSurchargeTierValues compara períodos correctamente al cruzar el fin de año — y siempre normaliza enabled a false', () => {
  // Configuración histórica (de antes de la decisión de negocio): `current`
  // Y `pending` traen `enabled: true` real — la comparación de vigencia
  // (current vs. pending según el período) debe seguir eligiendo el objeto
  // correcto, pero CUALQUIERA de los dos que elija sale sanitizado.
  const settings: SurchargeSettings = {
    current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true, firstLatePercentage: 10 },
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true, firstLatePercentage: 99 },
    pendingEffectiveFrom: '2027-01',
  };
  const december = resolveEffectiveSurchargeTierValues(settings, '2026-12');
  const january = resolveEffectiveSurchargeTierValues(settings, '2027-01');
  assertEqual(december.firstLatePercentage, 10, 'diciembre 2026 todavía resuelve `current` (comparación de vigencia intacta)');
  assertEqual(january.firstLatePercentage, 99, 'enero 2027 ya resuelve `pending` (comparación de vigencia intacta)');
  assertEqual(december.enabled, false, 'diciembre 2026: enabled siempre normalizado a false, sin importar lo persistido');
  assertEqual(january.enabled, false, 'enero 2027: enabled siempre normalizado a false, sin importar lo persistido');
});

// Corrección 2026-08-12 (a pedido de Joaquín — "desactivar recargos debe
// restaurar los montos base"): un cargo de diciembre TODAVÍA ABIERTO (sin
// pagar) no es "código cerrado" — sigue siendo la misma deuda viva. Si la
// profesora desactivó los recargos desde enero, esa deuda vieja también
// debe reflejarlo de inmediato, sin recargo, igual que cualquier otra
// obligación abierta hoy.
test('23c. un cargo de diciembre TODAVÍA ABIERTO evaluado en enero ya usa la configuración de enero (vigente hoy)', () => {
  const charge = monthlyCharge({ dueDate: '2026-12-01', billingPeriod: '2026-12' });
  const settings: SurchargeSettings = {
    current: DEFAULT_SURCHARGE_TIER_VALUES,
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
    pendingEffectiveFrom: '2027-01',
  };
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2027-01-15', // ya en enero, y el cargo de diciembre sigue sin pagar
    surchargeSettings: settings,
  });
  assertEqual(state.stage, 'last_late', 'la etapa real se sigue calculando (puntualidad/scoring)');
  assertEqual(state.surchargeAmount, 0, 'una deuda abierta de diciembre también pierde el recargo al desactivarse en enero');
  assertEqual(state.balance, 10000, 'el saldo queda exactamente en el importe original, nunca inflado por un recargo viejo');
});

// Contraparte: un cargo de diciembre saldado por su importe original (sin
// recargo — nunca lo hay) sigue saldado para siempre, sin importar qué
// configuración (histórica o no) se le pase al reevaluarlo mucho después.
test('23d. un cargo de diciembre ya SALDADO por su importe original sigue saldado, aunque se reevalúe con una configuración histórica enabled: true', () => {
  const charge = monthlyCharge({ dueDate: '2026-12-01', billingPeriod: '2026-12' });
  const settings: SurchargeSettings = {
    current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true },
    pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true },
    pendingEffectiveFrom: '2027-01',
  };
  // Saldada el 27/12 por el importe original exacto — nunca hay recargo que sumar.
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-12-27' })],
    adjustments: [],
    evaluationDate: '2027-01-15', // se vuelve a evaluar mucho después
    surchargeSettings: settings,
  });
  assertEqual(state.settledAt, '2026-12-27', 'sigue saldada en la fecha real de diciembre');
  assertEqual(state.totalDue, 10000, 'el total exigido sigue siendo el importe original — ninguna configuración histórica lo aumenta');
  assertEqual(state.balance, 0, 'sigue saldada, sin deuda nueva');
});

// ---------------------------------------------------------------------------
// Caso 24: montos pequeños, grandes y aleatorios.
// ---------------------------------------------------------------------------

test('24. monto pequeño ($1): nunca hay recargo, sin importar la etapa', () => {
  const charge = monthlyCharge({ originalAmount: 1 });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-15', // first_late
  });
  assertEqual(state.surchargeAmount, 0, 'nunca hay recargo automático');
  assertEqual(state.totalDue, 1, 'el importe original nunca desaparece ni se altera');
});

test('24b. monto grande ($5.000.000): sigue sin recargo, exacto, sin errores de coma flotante', () => {
  const charge = monthlyCharge({ originalAmount: 5_000_000 });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29', // last_late
  });
  assertEqual(state.surchargeAmount, 0, 'nunca hay recargo automático, ni con montos grandes');
  assertEqual(state.totalDue, 5_000_000, 'el total es exactamente el importe original');
});

test('24c. matriz de 50 montos pseudoaleatorios (semilla fija): totalDue siempre es EXACTAMENTE originalAmount, sin recargo, en cualquier etapa', () => {
  let seed = 20260811;
  function nextRandomAmount(): number {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 100 + (seed % 999_900); // entre 100 y 1.000.000
  }
  for (let i = 0; i < 50; i += 1) {
    const originalAmount = nextRandomAmount();
    const charge = monthlyCharge({ id: `charge-random-${i}`, originalAmount });
    const state = calculateChargeState({
      charge,
      allocations: [],
      payments: [],
      adjustments: [],
      evaluationDate: '2026-07-22', // second_late
    });
    assertEqual(state.surchargeAmount, 0, `caso #${i}: nunca hay recargo automático`);
    assertEqual(state.totalDue, originalAmount, `caso #${i}: total = original, sin recargo`);
  }
});

// ---------------------------------------------------------------------------
// Validación de los 7 campos editables — días 1-31, orden cronológico,
// porcentajes >= 0, nunca NaN/negativos/texto corrupto.
// ---------------------------------------------------------------------------

test('validación: DEFAULT_SURCHARGE_TIER_VALUES (la migración inicial) siempre es válida', () => {
  const errors = validateSurchargeTierValues(DEFAULT_SURCHARGE_TIER_VALUES);
  assertEqual(errors.length, 0, 'la configuración migrada nunca debe fallar su propia validación');
});

test('validación: rechaza un día fuera de rango (0 y 32)', () => {
  const tooLow = validateSurchargeTierValues({ ...DEFAULT_SURCHARGE_TIER_VALUES, graceDay: 0 });
  const tooHigh = validateSurchargeTierValues({ ...DEFAULT_SURCHARGE_TIER_VALUES, lastLateDay: 32 });
  assert(tooLow.length > 0, 'día 0 es inválido');
  assert(tooHigh.length > 0, 'día 32 es inválido');
});

test('validación: rechaza días desordenados (nunca fechas fuera de orden cronológico)', () => {
  const errors = validateSurchargeTierValues({
    ...DEFAULT_SURCHARGE_TIER_VALUES,
    firstLateDay: 20,
    secondLateDay: 15, // desordenado a propósito
  });
  assert(errors.length > 0, 'el segundo recargo debe ser posterior al primero');
});

test('validación: rechaza porcentajes negativos', () => {
  const errors = validateSurchargeTierValues({ ...DEFAULT_SURCHARGE_TIER_VALUES, firstLatePercentage: -5 });
  assert(errors.length > 0, 'un porcentaje negativo nunca es válido');
});

test('validación: rechaza NaN (texto corrupto convertido a número inválido)', () => {
  const errors = validateSurchargeTierValues({ ...DEFAULT_SURCHARGE_TIER_VALUES, lastLatePercentage: Number.NaN });
  assert(errors.length > 0, 'NaN nunca es un porcentaje válido');
});

test('validación: acepta porcentaje exactamente cero (recargo simbólico permitido)', () => {
  const errors = validateSurchargeTierValues({ ...DEFAULT_SURCHARGE_TIER_VALUES, firstLatePercentage: 0 });
  assertEqual(errors.length, 0, 'cero es un porcentaje válido (>= 0)');
});

test('proposeSurchargeSettingsChange lanza si los valores propuestos no son válidos', () => {
  let threw = false;
  try {
    proposeSurchargeSettingsChange(
      DEFAULT_SURCHARGE_SETTINGS,
      { ...DEFAULT_SURCHARGE_TIER_VALUES, graceDay: 40 },
      'current_month',
      '2026-07'
    );
  } catch {
    threw = true;
  }
  assert(threw, 'nunca debe guardar una configuración corrupta "por las dudas"');
});

test('DEFAULT_SURCHARGE_TIER_VALUES: enabled: false (decisión de negocio 2026-09-16), días/porcentajes intactos para la mora visual', () => {
  const expected: SurchargeTierValues = {
    enabled: false,
    graceDay: 10,
    firstLateDay: 11,
    firstLatePercentage: 10,
    secondLateDay: 19,
    secondLatePercentage: 15,
    lastLateDay: 27,
    lastLatePercentage: 20,
  };
  assertEqual(JSON.stringify(DEFAULT_SURCHARGE_TIER_VALUES), JSON.stringify(expected), 'ninguna cuenta nueva obtiene un recargo automático por defecto');
});

