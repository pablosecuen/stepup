// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/registerPaymentPlan.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { calculateAssignableDebt, calculateAssignableForCharge, planPaymentRegistration, planSingleChargePaymentRegistration } from '../registerPaymentPlan.ts';
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

test('pago completo: salda la única obligación pendiente en una sola asignación', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ originalAmount: 10000 })] };
  const result = planPaymentRegistration({
    paymentId: 'payment-1',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
    state,
    allocationIdPrefix: 'payment-1_alloc_',
  });
  assertEqual(result.payment.amount, 10000, 'importe del pago');
  assertEqual(result.allocations.length, 1, 'una sola asignación');
  assertEqual(result.allocations[0].chargeId, 'charge-1', 'a la única obligación');
  assertEqual(result.allocations[0].amount, 10000, 'por el total');
});

test('pago parcial: asigna lo que hay y deja el resto de la obligación pendiente', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ originalAmount: 10000 })] };
  const result = planPaymentRegistration({
    paymentId: 'payment-1',
    studentId: 's1',
    amount: 4000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
    state,
    allocationIdPrefix: 'payment-1_alloc_',
  });
  assertEqual(result.allocations.length, 1, 'una asignación parcial');
  assertEqual(result.allocations[0].amount, 4000, 'sólo lo pagado');
});

test('distribución entre varias obligaciones: empieza por la de vencimiento más antiguo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-agosto', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 10000 }),
      charge({ id: 'charge-julio', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 }),
    ],
  };
  // Se paga el 5/7: julio está en término (requiere 10000 exactos) y
  // agosto todavía ni venció (requiere sus 10000 completos para saldarse,
  // pero sólo alcanza para una asignación parcial con lo que sobra).
  const result = planPaymentRegistration({
    paymentId: 'payment-1',
    studentId: 's1',
    amount: 15000,
    method: 'transferencia',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
    state,
    allocationIdPrefix: 'payment-1_alloc_',
  });

  assertEqual(result.allocations.length, 2, 'se reparte entre las dos obligaciones');
  const julyAllocation = result.allocations.find((a) => a.chargeId === 'charge-julio')!;
  const augustAllocation = result.allocations.find((a) => a.chargeId === 'charge-agosto')!;
  assertEqual(julyAllocation.amount, 10000, 'julio (la más antigua) se salda primero y por completo');
  assertEqual(augustAllocation.amount, 5000, 'el resto va a agosto, aunque todavía no haya vencido');
});

test('pago retroactivo: la distribución usa el recargo vigente en la fecha real de pago, no en hoy', () => {
  // Vence 1/7; se paga (recién se carga hoy, mucho después) con fecha real
  // 5/7 (en término, requiere sólo 10000). Si se evaluara "hoy" en vez de
  // paidAt, el recargo sería mucho mayor.
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ originalAmount: 10000, dueDate: '2026-07-01' })] };
  const result = planPaymentRegistration({
    paymentId: 'payment-1',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05', // fecha real de pago: en término
    recordedAt: '2026-07-25T12:00:00.000Z', // carga retroactiva, mucho después
    todayDateKey: '2026-07-25',
    state,
    allocationIdPrefix: 'payment-1_alloc_',
  });
  assertEqual(result.allocations.length, 1, 'salda la obligación completa con el importe en término');
  assertEqual(result.allocations[0].amount, 10000, 'sin recargo: se evalúa a la fecha real de pago');
});

test('importe excesivo: rechaza el registro completo cuando supera lo asignable (no admite saldo a favor)', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ originalAmount: 10000 })] };
  let rejected = false;
  try {
    planPaymentRegistration({
      paymentId: 'payment-1',
      studentId: 's1',
      amount: 15000, // supera los 10000 que se pueden asignar
      method: 'efectivo',
      paidAt: '2026-07-05',
      recordedAt: '2026-07-05T12:00:00.000Z',
      todayDateKey: '2026-07-05',
      state,
      allocationIdPrefix: 'payment-1_alloc_',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'se rechaza todo el registro, no se admite un sobrante como saldo a favor');
});

test('importe excesivo sin ninguna obligación pendiente: rechaza directamente', () => {
  const state: PaymentsRepositoryState = emptyState(); // sin obligaciones
  let rejected = false;
  try {
    planPaymentRegistration({
      paymentId: 'payment-1',
      studentId: 's1',
      amount: 5000,
      method: 'efectivo',
      paidAt: '2026-07-05',
      recordedAt: '2026-07-05T12:00:00.000Z',
      todayDateKey: '2026-07-05',
      state,
      allocationIdPrefix: 'payment-1_alloc_',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'sin deuda que cubrir, no hay nada asignable');
});

test('ignora obligaciones ya saldadas y las anuladas al distribuir', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-saldada', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 10000 }),
      charge({ id: 'charge-anulada', dueDate: '2026-06-15', billingPeriod: '2026-06', originalAmount: 5000, voidedAt: '2026-06-20T00:00:00.000Z', voidReason: 'error' }),
      charge({ id: 'charge-pendiente', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 8000 }),
    ],
    payments: [
      {
        id: 'payment-previo',
        studentId: 's1',
        amount: 10000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-06-05',
        recordedAt: '2026-06-05T12:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    allocations: [
      { id: 'alloc-previo', paymentId: 'payment-previo', chargeId: 'charge-saldada', studentId: 's1', amount: 10000 },
    ],
  };
  const result = planPaymentRegistration({
    paymentId: 'payment-2',
    studentId: 's1',
    amount: 8000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
    state,
    allocationIdPrefix: 'payment-2_alloc_',
  });
  assertEqual(result.allocations.length, 1, 'una sola asignación');
  assertEqual(result.allocations[0].chargeId, 'charge-pendiente', 'sólo a la obligación realmente pendiente');
});

// ---------------------------------------------------------------------------
// Caso reportado por Codex: pago retroactivo insertado ANTES de un pago
// posterior ya registrado. planPaymentRegistration usaba `calculateChargeState`
// (que suma TODAS las asignaciones sin importar su fecha) para decidir
// cuánto ofrecerle a `allocatePayment`, lo que subestimaba la capacidad real
// y rechazaba pagos retroactivos válidos. Ahora usa
// `calculateSafeAllocationCapacity`, igual que `allocatePayment`.
// ---------------------------------------------------------------------------

test('pago retroactivo con un pago posterior ya registrado: se acepta completo y la deuda resultante es $0 (sin recargo, el requerido es siempre el importe base)', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      {
        id: 'payment-posterior',
        studentId: 's1',
        amount: 6000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-07-20',
        recordedAt: '2026-07-20T12:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    allocations: [
      { id: 'alloc-posterior', paymentId: 'payment-posterior', chargeId: 'charge-1', studentId: 's1', amount: 6000 },
    ],
  };

  const result = planPaymentRegistration({
    paymentId: 'payment-retroactivo',
    studentId: 's1',
    amount: 4000,
    method: 'efectivo',
    paidAt: '2026-07-05', // en término, ANTES del pago ya registrado
    recordedAt: '2026-07-25T12:00:00.000Z',
    todayDateKey: '2026-07-25',
    state,
    allocationIdPrefix: 'payment-retroactivo_alloc_',
  });

  assertEqual(result.allocations.length, 1, 'se acepta una asignación');
  assertEqual(result.allocations[0].amount, 4000, 'los $4.000 retroactivos se aceptan completos, no recortados');

  const finalState: PaymentsRepositoryState = {
    ...state,
    payments: [...state.payments, result.payment],
    allocations: [...state.allocations, ...result.allocations],
  };
  const finalChargeState = calculateChargeState({
    charge: state.charges[0],
    allocations: finalState.allocations,
    payments: finalState.payments,
    adjustments: finalState.adjustments,
    evaluationDate: '2026-07-20',
  });
  assertEqual(finalChargeState.balance, 0, 'la deuda resultante es exactamente $0 (6.000 + 4.000 = 10.000, sin recargo)');
});

test('un importe que sí genera excedente (aun siendo retroactivo) se rechaza', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      {
        id: 'payment-posterior',
        studentId: 's1',
        amount: 6000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-07-20',
        recordedAt: '2026-07-20T12:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    allocations: [
      { id: 'alloc-posterior', paymentId: 'payment-posterior', chargeId: 'charge-1', studentId: 's1', amount: 6000 },
    ],
  };

  let rejected = false;
  try {
    planPaymentRegistration({
      paymentId: 'payment-retroactivo',
      studentId: 's1',
      amount: 5000, // 1000 más que la capacidad segura real (4000, sin recargo)
      method: 'efectivo',
      paidAt: '2026-07-05',
      recordedAt: '2026-07-25T12:00:00.000Z',
      todayDateKey: '2026-07-25',
      state,
      allocationIdPrefix: 'payment-retroactivo_alloc_',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'un excedente real (aunque sea sobre un pago retroactivo) sigue rechazándose');
});

test('el orden físico de los arrays de charges/payments/allocations no cambia el resultado de la distribución', () => {
  const chargeA = charge({ id: 'charge-a', originalAmount: 10000, dueDate: '2026-07-01' });
  const existingPayment = {
    id: 'payment-posterior',
    studentId: 's1',
    amount: 6000,
    currency: 'ARS' as const,
    method: 'efectivo' as const,
    paidAt: '2026-07-20',
    recordedAt: '2026-07-20T12:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const existingAllocation = {
    id: 'alloc-posterior',
    paymentId: 'payment-posterior',
    chargeId: 'charge-a',
    studentId: 's1',
    amount: 6000,
  };

  const stateInOrder: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [chargeA],
    payments: [existingPayment],
    allocations: [existingAllocation],
  };
  const stateReversedArrays: PaymentsRepositoryState = {
    charges: [...stateInOrder.charges].reverse(),
    payments: [...stateInOrder.payments].reverse(),
    allocations: [...stateInOrder.allocations].reverse(),
    adjustments: [],
  };

  const resultInOrder = planPaymentRegistration({
    paymentId: 'payment-retroactivo',
    studentId: 's1',
    amount: 4000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-25T12:00:00.000Z',
    todayDateKey: '2026-07-25',
    state: stateInOrder,
    allocationIdPrefix: 'payment-retroactivo_alloc_',
  });
  const resultReversed = planPaymentRegistration({
    paymentId: 'payment-retroactivo',
    studentId: 's1',
    amount: 4000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-25T12:00:00.000Z',
    todayDateKey: '2026-07-25',
    state: stateReversedArrays,
    allocationIdPrefix: 'payment-retroactivo_alloc_',
  });

  assertEqual(resultInOrder.allocations[0].amount, 4000, 'orden original: se acepta completo');
  assertEqual(resultReversed.allocations[0].amount, 4000, 'arrays en orden inverso: mismo resultado');
});

test('la vista previa (calculateAssignableDebt) para una fecha retroactiva coincide con lo que planPaymentRegistration termina aceptando', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      {
        id: 'payment-posterior',
        studentId: 's1',
        amount: 6000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-07-20',
        recordedAt: '2026-07-20T12:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    allocations: [
      { id: 'alloc-posterior', paymentId: 'payment-posterior', chargeId: 'charge-1', studentId: 's1', amount: 6000 },
    ],
  };

  // La vista previa para el 05/07 (retroactivo) debe reflejar la capacidad
  // real de ESA fecha (4.000, sin recargo: 10.000 - 6.000 ya asignados el 20/07).
  const previewForRetroactiveDate = calculateAssignableDebt({ studentId: 's1', state, evaluationDate: '2026-07-05' });
  assertEqual(previewForRetroactiveDate, 4000, 'la vista previa usa la capacidad real de la fecha elegida');

  const result = planPaymentRegistration({
    paymentId: 'payment-retroactivo',
    studentId: 's1',
    amount: previewForRetroactiveDate, // exactamente lo que la vista previa dijo que se podía asignar
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-25T12:00:00.000Z',
    todayDateKey: '2026-07-25',
    state,
    allocationIdPrefix: 'payment-retroactivo_alloc_',
  });
  assertEqual(result.allocations[0].amount, previewForRetroactiveDate, 'el plan definitivo acepta exactamente lo que la vista previa anticipó');
});

test('calculateAssignableDebt suma el saldo pendiente de las obligaciones vigentes a una fecha dada', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 10000 }),
      charge({ id: 'c2', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 5000 }),
    ],
  };
  const assignable = calculateAssignableDebt({ studentId: 's1', state, evaluationDate: '2026-07-05' });
  assert(assignable >= 15000, 'suma al menos los dos importes originales (más recargo si corresponde)');
});

// ---------------------------------------------------------------------------
// Problema 4 (reportado por Joaquín — SALDO INCORRECTO EN PAGOS PARCIALES):
// cuota de entrenamiento $80.000, pagado $0, importe ingresado $40.000 →
// saldo esperado $40.000. La interfaz mostraba $67.500 porque calculaba el
// saldo con la deuda TOTAL del alumno ($80.000 + otra obligación de
// $27.500 = $107.500 − $40.000 = $67.500) en vez de usar exclusivamente el
// cargo de entrenamiento seleccionado. `calculateAssignableForCharge` es la
// función que corrige esto: reproduce el caso exacto reportado.
// ---------------------------------------------------------------------------

test('calculateAssignableForCharge: el saldo del cargo de entrenamiento nunca se mezcla con otra obligación del mismo alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({
        id: 'charge-entrenamiento',
        type: 'entrenamiento',
        dueDate: '2026-09-10',
        billingPeriod: '2026-09',
        originalAmount: 80000,
        trainingBillingAgreementId: 'agreement-1',
      }),
      charge({ id: 'charge-mensual', dueDate: '2026-09-10', billingPeriod: '2026-09', originalAmount: 27500 }),
    ],
  };
  const assignable = calculateAssignableForCharge({ chargeId: 'charge-entrenamiento', state, evaluationDate: '2026-09-16' });
  assertEqual(assignable, 80000, 'el máximo asignable del cargo de entrenamiento es SU propio importe, nunca 80000+27500');

  const remainingAfterPartialPayment = assignable - 40000;
  assertEqual(remainingAfterPartialPayment, 40000, 'con $40.000 pagados, el saldo del cargo de entrenamiento es $40.000 — nunca $67.500');
});

test('calculateAssignableForCharge: 0 si el cargo no existe o ya está anulado', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ id: 'charge-anulado', voidedAt: '2026-09-01T00:00:00.000Z', voidReason: 'error' })] };
  assertEqual(calculateAssignableForCharge({ chargeId: 'charge-inexistente', state, evaluationDate: '2026-09-16' }), 0, 'cargo inexistente');
  assertEqual(calculateAssignableForCharge({ chargeId: 'charge-anulado', state, evaluationDate: '2026-09-16' }), 0, 'cargo anulado');
});

test('calculateAssignableForCharge: dos entrenamientos del mismo alumno no mezclan saldos', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'entrenamiento-a', type: 'entrenamiento', originalAmount: 50000, trainingBillingAgreementId: 'agreement-a' }),
      charge({ id: 'entrenamiento-b', type: 'entrenamiento', originalAmount: 30000, trainingBillingAgreementId: 'agreement-b' }),
    ],
  };
  assertEqual(calculateAssignableForCharge({ chargeId: 'entrenamiento-a', state, evaluationDate: '2026-07-05' }), 50000, 'entrenamiento A no ve el importe de B');
  assertEqual(calculateAssignableForCharge({ chargeId: 'entrenamiento-b', state, evaluationDate: '2026-07-05' }), 30000, 'entrenamiento B no ve el importe de A');
});

test('no muta el estado recibido', () => {
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge({ originalAmount: 10000 })] };
  const snapshot = JSON.stringify(state);
  planPaymentRegistration({
    paymentId: 'payment-1',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
    state,
    allocationIdPrefix: 'payment-1_alloc_',
  });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});

// ---------------------------------------------------------------------------
// planSingleChargePaymentRegistration — Fase Pagos 4B.2: la pregunta de pago
// al finalizar una clase debe aplicarse SIEMPRE al cargo de esa clase
// puntual, nunca repartirse ni colarse hacia otra deuda anterior del mismo
// alumno (a diferencia de planPaymentRegistration, que sí reparte
// empezando por la más antigua).
// ---------------------------------------------------------------------------

test('planSingleChargePaymentRegistration aplica el pago exclusivamente al cargo indicado, nunca a otra deuda anterior del alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-deuda-vieja', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 10000 }),
      charge({
        id: 'charge-clase-hoy',
        type: 'por_clase',
        billingPeriod: undefined,
        savedLessonId: 'lesson-1',
        dueDate: '2026-07-11',
        originalAmount: 9500,
      }),
    ],
  };

  const result = planSingleChargePaymentRegistration({
    paymentId: 'payment-clase-1',
    studentId: 's1',
    chargeId: 'charge-clase-hoy',
    amount: 9500,
    method: 'efectivo',
    paidAt: '2026-07-11',
    recordedAt: '2026-07-11T12:00:00.000Z',
    todayDateKey: '2026-07-11',
    state,
    allocationId: 'payment-clase-1_alloc_1',
  });

  assertEqual(result.allocations.length, 1, 'una única asignación');
  assertEqual(result.allocations[0].chargeId, 'charge-clase-hoy', 'se aplica al cargo de la clase, no a la deuda vieja');
  assertEqual(result.allocations[0].amount, 9500, 'por el importe exacto de la clase');
});

test('planSingleChargePaymentRegistration: "pagó el total" usa el saldo exacto permitido del cargo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-clase', type: 'por_clase', billingPeriod: undefined, savedLessonId: 'lesson-1', dueDate: '2026-07-11', originalAmount: 9500 })],
  };
  const result = planSingleChargePaymentRegistration({
    paymentId: 'payment-clase-1',
    studentId: 's1',
    chargeId: 'charge-clase',
    amount: 9500, // el mismo día, sin recargo: el saldo exacto es el importe original
    method: 'efectivo',
    paidAt: '2026-07-11',
    recordedAt: '2026-07-11T12:00:00.000Z',
    todayDateKey: '2026-07-11',
    state,
    allocationId: 'payment-clase-1_alloc_1',
  });
  const finalChargeState = calculateChargeState({
    charge: state.charges[0],
    allocations: [...state.allocations, ...result.allocations],
    payments: [...state.payments, result.payment],
    adjustments: state.adjustments,
    evaluationDate: '2026-07-11',
  });
  assertEqual(finalChargeState.balance, 0, 'queda saldada exacto, sin crédito ni deuda');
});

test('planSingleChargePaymentRegistration rechaza un excedente sobre el cargo puntual', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-clase', type: 'por_clase', billingPeriod: undefined, savedLessonId: 'lesson-1', dueDate: '2026-07-11', originalAmount: 9500 })],
  };
  let rejected = false;
  try {
    planSingleChargePaymentRegistration({
      paymentId: 'payment-clase-1',
      studentId: 's1',
      chargeId: 'charge-clase',
      amount: 9600, // 100 más que el importe de la clase
      method: 'efectivo',
      paidAt: '2026-07-11',
      recordedAt: '2026-07-11T12:00:00.000Z',
      todayDateKey: '2026-07-11',
      state,
      allocationId: 'payment-clase-1_alloc_1',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no admite pagar de más ni dejarlo como saldo a favor');
});

test('planSingleChargePaymentRegistration acepta "ya había pagado" con fecha real retroactiva', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-clase', type: 'por_clase', billingPeriod: undefined, savedLessonId: 'lesson-1', dueDate: '2026-07-11', originalAmount: 9500 })],
  };
  const result = planSingleChargePaymentRegistration({
    paymentId: 'payment-clase-1',
    studentId: 's1',
    chargeId: 'charge-clase',
    amount: 9500,
    method: 'transferencia',
    paidAt: '2026-07-10', // un día antes de la clase: ya lo había pagado
    recordedAt: '2026-07-11T18:00:00.000Z', // se carga recién al guardar la clase
    todayDateKey: '2026-07-11',
    state,
    allocationId: 'payment-clase-1_alloc_1',
  });
  assertEqual(result.payment.paidAt, '2026-07-10', 'conserva la fecha real de pago, no la de carga');
  assertEqual(result.allocations[0].amount, 9500, 'se acepta completo');
});

test('planSingleChargePaymentRegistration rechaza un cargo inexistente o de otro alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-clase', studentId: 's2', type: 'por_clase', billingPeriod: undefined, savedLessonId: 'lesson-1', dueDate: '2026-07-11', originalAmount: 9500 })],
  };
  let rejected = false;
  try {
    planSingleChargePaymentRegistration({
      paymentId: 'payment-clase-1',
      studentId: 's1', // el cargo es de s2
      chargeId: 'charge-clase',
      amount: 9500,
      method: 'efectivo',
      paidAt: '2026-07-11',
      recordedAt: '2026-07-11T12:00:00.000Z',
      todayDateKey: '2026-07-11',
      state,
      allocationId: 'payment-clase-1_alloc_1',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'un cargo de otro alumno se rechaza');
});

test('planSingleChargePaymentRegistration no muta el estado recibido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-clase', type: 'por_clase', billingPeriod: undefined, savedLessonId: 'lesson-1', dueDate: '2026-07-11', originalAmount: 9500 })],
  };
  const snapshot = JSON.stringify(state);
  planSingleChargePaymentRegistration({
    paymentId: 'payment-clase-1',
    studentId: 's1',
    chargeId: 'charge-clase',
    amount: 4000,
    method: 'efectivo',
    paidAt: '2026-07-11',
    recordedAt: '2026-07-11T12:00:00.000Z',
    todayDateKey: '2026-07-11',
    state,
    allocationId: 'payment-clase-1_alloc_1',
  });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});
