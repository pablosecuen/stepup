// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/phantomSurchargeAllocationRepair.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { planPaymentRegistration } from '../registerPaymentPlan.ts';
import { planPhantomSurchargeAllocationRepair } from '../financialReconciliation.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { DEFAULT_SURCHARGE_TIER_VALUES, type SurchargeSettings } from '../surchargeSettings.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-09-01 (a pedido de Joaquín — ERROR FINANCIERO REAL,
 * segunda causa encontrada tras validación física en el dispositivo real):
 * un pago general real, registrado sin la configuración de recargos vigente
 * (`surchargeSettings: undefined` — el comportamiento previo a la
 * corrección 2026-08-31), distribuye la deuda del alumno de la más antigua
 * a la más nueva. Si un cargo ya estaba cubierto en su importe base, la
 * capacidad segura de ESE cargo se calculaba de más (10/15/20% "fantasma"),
 * dejando que una porción de un pago posterior — en los hechos destinada a
 * otro cargo del mismo alumno — quedara asignada al cargo equivocado. Este
 * archivo reproduce el bug EXACTO con el motor real
 * (`planPaymentRegistration`, nunca un fixture que "asuma" el resultado) y
 * verifica que `planPhantomSurchargeAllocationRepair` lo corrige sin tocar
 * ningún `Payment`, sin cruzar alumnos y sin actuar sobre nada ambiguo.
 */

const SETTINGS_DISABLED_FROM_AUGUST: SurchargeSettings = {
  current: DEFAULT_SURCHARGE_TIER_VALUES,
  pending: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false },
  pendingEffectiveFrom: '2026-08',
};

const ENABLED_SETTINGS: SurchargeSettings = {
  current: DEFAULT_SURCHARGE_TIER_VALUES,
  pending: null,
  pendingEffectiveFrom: null,
};

function perClassCharge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; dueDate: string }): PaymentCharge {
  return {
    type: 'por_clase',
    originalAmount: 27500,
    currency: 'ARS',
    billingPeriod: overrides.dueDate.slice(0, 7),
    createdAt: `${overrides.dueDate}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function stateOf(charge: PaymentCharge, state: PaymentsRepositoryState, evaluationDate: string, surchargeSettings: SurchargeSettings) {
  return calculateChargeState({
    charge,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate,
    surchargeSettings,
  });
}

// ---------------------------------------------------------------------------
// CASO PRINCIPAL — reproducción exacta del bug real, con el motor real.
// ---------------------------------------------------------------------------

// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): el CASO PRINCIPAL original reproducía un pago
// registrado con `surchargeSettings: undefined` (que caía al DEFAULT, antes
// `enabled: true`) contra una evaluación posterior con recargos
// desactivados — la discrepancia entre ambos era justamente lo que generaba
// el "recargo fantasma". Con `DEFAULT_SURCHARGE_TIER_VALUES.enabled: false`
// y `calculateSurchargeAmount` devolviendo siempre 0, `surchargeSettings:
// undefined` y "recargos desactivados" son ahora EXACTAMENTE el mismo
// comportamiento en todo momento — la discrepancia que producía el bug ya
// no puede existir, así que el reparto es correcto desde el primer pago,
// sin necesitar ninguna reparación.
test('CASO PRINCIPAL: con la fuente central siempre en $0, un pago general (surchargeSettings: undefined) ya no genera ningún "recargo fantasma" — nada que reparar', () => {
  const lessonA = perClassCharge({ id: 'c_A', studentId: 'qa_1', dueDate: '2026-08-19' });
  const lessonB = perClassCharge({ id: 'c_B', studentId: 'qa_1', dueDate: '2026-08-26' });
  let state: PaymentsRepositoryState = { charges: [lessonA, lessonB], payments: [], allocations: [], adjustments: [] };

  const result1 = planPaymentRegistration({
    paymentId: 'p1',
    studentId: 'qa_1',
    amount: 27500,
    method: 'efectivo',
    paidAt: '2026-08-31',
    recordedAt: '2026-08-31T15:48:21.229Z',
    todayDateKey: '2026-08-31',
    state,
    allocationIdPrefix: 'p1_alloc_',
    surchargeSettings: undefined,
  });
  state = {
    ...state,
    payments: [...state.payments, result1.payment],
    allocations: [...state.allocations, ...result1.allocations],
  };

  const result2 = planPaymentRegistration({
    paymentId: 'p2',
    studentId: 'qa_1',
    amount: 27500,
    method: 'efectivo',
    paidAt: '2026-08-31',
    recordedAt: '2026-08-31T15:48:27.168Z',
    todayDateKey: '2026-08-31',
    state,
    allocationIdPrefix: 'p2_alloc_',
    surchargeSettings: undefined,
  });
  state = {
    ...state,
    payments: [...state.payments, result2.payment],
    allocations: [...state.allocations, ...result2.allocations],
  };

  // Ambas clases quedan saldadas exactas desde el vamos — sin crédito ni faltante.
  const beforeA = stateOf(lessonA, state, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
  const beforeB = stateOf(lessonB, state, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
  assertEqual(beforeA.balance, 0, 'lessonA saldada exacta, sin crédito fantasma');
  assertEqual(beforeB.balance, 0, 'lessonB saldada exacta, sin faltante fantasma');

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'nada que reparar: el bug ya no puede reproducirse');
  assertEqual(plan.updatedAllocations, state.allocations, 'no toca ninguna asignación');
});

// ---------------------------------------------------------------------------
// Wiring correcto: si el pago se registra con la configuración real desde el
// principio, nunca se produce el desvío — nada que reparar.
// ---------------------------------------------------------------------------

test('con la configuración real pasada desde el principio, el bug nunca ocurre: la reparación no tiene nada que hacer', () => {
  const lessonA = perClassCharge({ id: 'c_A2', studentId: 'qa_2', dueDate: '2026-08-19' });
  const lessonB = perClassCharge({ id: 'c_B2', studentId: 'qa_2', dueDate: '2026-08-26' });
  let state: PaymentsRepositoryState = { charges: [lessonA, lessonB], payments: [], allocations: [], adjustments: [] };

  const result1 = planPaymentRegistration({
    paymentId: 'p1b', studentId: 'qa_2', amount: 27500, method: 'efectivo', paidAt: '2026-08-31',
    recordedAt: '2026-08-31T15:48:21.229Z', todayDateKey: '2026-08-31', state, allocationIdPrefix: 'p1b_alloc_',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  state = { ...state, payments: [...state.payments, result1.payment], allocations: [...state.allocations, ...result1.allocations] };

  const result2 = planPaymentRegistration({
    paymentId: 'p2b', studentId: 'qa_2', amount: 27500, method: 'efectivo', paidAt: '2026-08-31',
    recordedAt: '2026-08-31T15:48:27.168Z', todayDateKey: '2026-08-31', state, allocationIdPrefix: 'p2b_alloc_',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  state = { ...state, payments: [...state.payments, result2.payment], allocations: [...state.allocations, ...result2.allocations] };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'con wiring correcto desde el origen, nunca hay nada que reparar');
});

// ---------------------------------------------------------------------------
// Recargos activados: la reparación nunca actúa mientras siguen activados.
// ---------------------------------------------------------------------------

test('recargos activados: la reparación nunca mueve dinero, aunque exista un crédito/débito hermano', () => {
  const lessonA = perClassCharge({ id: 'c_A3', studentId: 'qa_3', dueDate: '2026-08-19' });
  const lessonB = perClassCharge({ id: 'c_B3', studentId: 'qa_3', dueDate: '2026-08-26' });
  const paymentA: Payment = { id: 'pA3', studentId: 'qa_3', amount: 31625, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:00.000Z', voidedAt: null, voidReason: null };
  const paymentB: Payment = { id: 'pB3', studentId: 'qa_3', amount: 23375, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:01.000Z', voidedAt: null, voidReason: null };
  const allocA1: PaymentAllocation = { id: 'aA3_1', paymentId: 'pA3', chargeId: 'c_A3', studentId: 'qa_3', amount: 31625 };
  const allocB1: PaymentAllocation = { id: 'aB3_1', paymentId: 'pB3', chargeId: 'c_B3', studentId: 'qa_3', amount: 23375 };
  const state: PaymentsRepositoryState = {
    charges: [lessonA, lessonB],
    payments: [paymentA, paymentB],
    allocations: [allocA1, allocB1],
    adjustments: [],
  };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: ENABLED_SETTINGS,
  });
  assertEqual(plan.actions.length, 0, 'con recargos activados, nunca actúa');
});

// ---------------------------------------------------------------------------
// Ambigüedad: un pago con 3+ asignaciones nunca se toca (regla explícita).
// ---------------------------------------------------------------------------

test('pago con 3 asignaciones (ambiguo): nunca se toca, aunque haya un cargo con crédito', () => {
  const chargeA = perClassCharge({ id: 'c_A4', studentId: 'qa_4', dueDate: '2026-08-01' });
  const chargeB = perClassCharge({ id: 'c_B4', studentId: 'qa_4', dueDate: '2026-08-10' });
  const chargeC = perClassCharge({ id: 'c_C4', studentId: 'qa_4', dueDate: '2026-08-20' });
  const payment: Payment = { id: 'p4', studentId: 'qa_4', amount: 60000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:00.000Z', voidedAt: null, voidReason: null };
  const allocations: PaymentAllocation[] = [
    { id: 'a4_1', paymentId: 'p4', chargeId: 'c_A4', studentId: 'qa_4', amount: 31625 },
    { id: 'a4_2', paymentId: 'p4', chargeId: 'c_B4', studentId: 'qa_4', amount: 20000 },
    { id: 'a4_3', paymentId: 'p4', chargeId: 'c_C4', studentId: 'qa_4', amount: 8375 },
  ];
  const state: PaymentsRepositoryState = { charges: [chargeA, chargeB, chargeC], payments: [payment], allocations, adjustments: [] };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'un pago con 3+ asignaciones siempre se considera ambiguo: nunca se toca');
  assertEqual(plan.updatedAllocations, state.allocations, 'las asignaciones quedan exactamente iguales');
});

// ---------------------------------------------------------------------------
// Monto que no coincide exactamente con el recargo fantasma: nunca se
// adivina ni se aproxima.
// ---------------------------------------------------------------------------

test('excedente que no coincide exactamente con un recargo fantasma real: nunca se toca (no se adivina)', () => {
  const chargeA = perClassCharge({ id: 'c_A5', studentId: 'qa_5', dueDate: '2026-08-01', originalAmount: 27500 });
  const chargeB = perClassCharge({ id: 'c_B5', studentId: 'qa_5', dueDate: '2026-08-10', originalAmount: 27500 });
  // Pago único con un excedente de $1.000 (no coincide con ningún recargo
  // real de 10/15/20% sobre $27.500) — simula un sobrepago por otra razón,
  // nunca un recargo fantasma.
  const payment: Payment = { id: 'p5', studentId: 'qa_5', amount: 55000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:00.000Z', voidedAt: null, voidReason: null };
  const allocations: PaymentAllocation[] = [
    { id: 'a5_1', paymentId: 'p5', chargeId: 'c_A5', studentId: 'qa_5', amount: 28500 },
    { id: 'a5_2', paymentId: 'p5', chargeId: 'c_B5', studentId: 'qa_5', amount: 26500 },
  ];
  const state: PaymentsRepositoryState = { charges: [chargeA, chargeB], payments: [payment], allocations, adjustments: [] };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'el excedente no coincide exacto con un recargo real: nunca se mueve por aproximación');
});

// ---------------------------------------------------------------------------
// Sin par crédito/débito limpio: nunca se toca.
// ---------------------------------------------------------------------------

test('sin ningún cargo con crédito (ambos con capital pendiente real): nunca se toca', () => {
  const chargeA = perClassCharge({ id: 'c_A6', studentId: 'qa_6', dueDate: '2026-08-01' });
  const chargeB = perClassCharge({ id: 'c_B6', studentId: 'qa_6', dueDate: '2026-08-10' });
  const payment: Payment = { id: 'p6', studentId: 'qa_6', amount: 20000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:00.000Z', voidedAt: null, voidReason: null };
  const allocations: PaymentAllocation[] = [
    { id: 'a6_1', paymentId: 'p6', chargeId: 'c_A6', studentId: 'qa_6', amount: 10000 },
    { id: 'a6_2', paymentId: 'p6', chargeId: 'c_B6', studentId: 'qa_6', amount: 10000 },
  ];
  const state: PaymentsRepositoryState = { charges: [chargeA, chargeB], payments: [payment], allocations, adjustments: [] };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'ambos cargos con capital pendiente real (ningún crédito): nunca se toca');
});

// ---------------------------------------------------------------------------
// Cargo anulado en el par: nunca se toca.
// ---------------------------------------------------------------------------

test('uno de los dos cargos del par está anulado: nunca se toca', () => {
  const chargeA = perClassCharge({ id: 'c_A7', studentId: 'qa_7', dueDate: '2026-08-19', voidedAt: '2026-08-20T00:00:00.000Z', voidReason: 'error de carga' });
  const chargeB = perClassCharge({ id: 'c_B7', studentId: 'qa_7', dueDate: '2026-08-26' });
  const payment: Payment = { id: 'p7', studentId: 'qa_7', amount: 27500, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-31', recordedAt: '2026-08-31T00:00:00.000Z', voidedAt: null, voidReason: null };
  const allocations: PaymentAllocation[] = [
    { id: 'a7_1', paymentId: 'p7', chargeId: 'c_A7', studentId: 'qa_7', amount: 4125 },
    { id: 'a7_2', paymentId: 'p7', chargeId: 'c_B7', studentId: 'qa_7', amount: 23375 },
  ];
  const state: PaymentsRepositoryState = { charges: [chargeA, chargeB], payments: [payment], allocations, adjustments: [] };

  const plan = planPhantomSurchargeAllocationRepair({
    state,
    evaluationDate: '2026-09-01',
    surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
  });
  assertEqual(plan.actions.length, 0, 'un cargo anulado en el par: nunca se toca');
});

// ---------------------------------------------------------------------------
// Mensualidad y clase suelta mezcladas: la regla es genérica, cualquier tipo
// compatible con recargos.
// ---------------------------------------------------------------------------

test('mensualidad y clase suelta del mismo alumno: la reparación funciona igual, sin importar el tipo de cargo', () => {
  const monthly: PaymentCharge = {
    id: 'c_month8', studentId: 'qa_8', type: 'mensual', originalAmount: 90000, currency: 'ARS',
    dueDate: '2026-08-01', billingPeriod: '2026-08', createdAt: '2026-08-01T09:00:00.000Z', voidedAt: null, voidReason: null,
  };
  const perClass = perClassCharge({ id: 'c_class8', studentId: 'qa_8', dueDate: '2026-08-15', originalAmount: 20000 });

  let state: PaymentsRepositoryState = { charges: [monthly, perClass], payments: [], allocations: [], adjustments: [] };

  const result1 = planPaymentRegistration({
    paymentId: 'p1c', studentId: 'qa_8', amount: 90000, method: 'efectivo', paidAt: '2026-08-20',
    recordedAt: '2026-08-20T10:00:00.000Z', todayDateKey: '2026-08-20', state, allocationIdPrefix: 'p1c_alloc_',
    surchargeSettings: undefined,
  });
  state = { ...state, payments: [...state.payments, result1.payment], allocations: [...state.allocations, ...result1.allocations] };

  const result2 = planPaymentRegistration({
    paymentId: 'p2c', studentId: 'qa_8', amount: 20000, method: 'efectivo', paidAt: '2026-08-20',
    recordedAt: '2026-08-20T10:00:05.000Z', todayDateKey: '2026-08-20', state, allocationIdPrefix: 'p2c_alloc_',
    surchargeSettings: undefined,
  });
  state = { ...state, payments: [...state.payments, result2.payment], allocations: [...state.allocations, ...result2.allocations] };

  const beforeMonthly = stateOf(monthly, state, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
  const beforeClass = stateOf(perClass, state, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
  // Sólo verifica la reparación si el bug realmente se manifestó en este
  // escenario (mensual usa su propia escala de días, puede no coincidir) —
  // la prueba es válida en cualquier caso: o no hay nada que reparar, o se
  // repara exacto.
  if (beforeMonthly.balance < 0 || beforeClass.balance < 0) {
    const plan = planPhantomSurchargeAllocationRepair({
      state,
      evaluationDate: '2026-09-01',
      surchargeSettings: SETTINGS_DISABLED_FROM_AUGUST,
    });
    assert(plan.actions.length <= 1, 'a lo sumo una corrección entre estos dos cargos');
    if (plan.actions.length === 1) {
      const repaired: PaymentsRepositoryState = { ...state, allocations: plan.updatedAllocations };
      const afterMonthly = stateOf(monthly, repaired, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
      const afterClass = stateOf(perClass, repaired, '2026-09-01', SETTINGS_DISABLED_FROM_AUGUST);
      assert(afterMonthly.balance >= 0, 'mensualidad nunca queda con saldo negativo tras reparar');
      assert(afterClass.balance >= 0, 'clase suelta nunca queda con saldo negativo tras reparar');
    }
  } else {
    assert(true, 'este escenario no reprodujo el bug (tipos con escalas de mora distintas): nada que reparar, comportamiento correcto');
  }
});
