// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/initialPaidSurchargeRepair.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
 * nuevos): pruebas de la reparación segura e idempotente de alumnos ya
 * afectados por el bug real (recargo incorrecto aplicado a una "situación
 * inicial declarada como pagada"). Contra las funciones puras reales —
 * nunca una reimplementación de prueba.
 */
import type { Payment, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildMonthlyCharge, recordPayment } from '../paymentMutations.ts';
import { allocatePayment } from '../paymentMutations.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { applyInitialPaidSurchargeCorrection, findInitialPaidSurchargeCandidates, INITIAL_PAID_SURCHARGE_CORRECTION_REASON } from '../initialPaidSurchargeRepair.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function buildBuggyState(input: {
  studentId: string;
  dateJoined: string; // ISO
  billingPeriod: string; // YYYY-MM
  paidAtLate: string; // YYYY-MM-DD, posterior al vencimiento
}): PaymentsRepositoryState {
  const dueDate = `${input.billingPeriod}-01`;
  const charge = buildMonthlyCharge({
    studentId: input.studentId,
    billingPeriod: input.billingPeriod,
    dueDate,
    originalAmount: 20000,
    createdAt: `${input.paidAtLate}T15:00:00.000Z`,
    existingCharges: [],
  });
  // Simula el pago tal como lo dejaba el bug ANTES de esta corrección:
  // paidAt = "hoy" (tardío), source ausente (registros históricos nunca
  // tuvieron este campo).
  const payment = recordPayment({
    id: `payment_${input.studentId}_bug`,
    studentId: input.studentId,
    amount: 20000,
    method: 'efectivo',
    paidAt: input.paidAtLate,
    recordedAt: `${input.paidAtLate}T15:00:00.000Z`,
    todayDateKey: input.paidAtLate,
  });
  const allocation = allocatePayment({
    id: `payment_${input.studentId}_bug_alloc_1`,
    paymentId: payment.id,
    chargeId: charge.id,
    amount: 20000,
    state: { charges: [charge], payments: [payment], allocations: [], adjustments: [] },
  });
  return { charges: [charge], payments: [payment], allocations: [allocation], adjustments: [] };
}

const NOW = new Date('2026-07-29T12:00:00.000Z');

/**
 * Corrección 2026-09-16: `findInitialPaidSurchargeCandidates` ya nunca
 * produce un candidato real (su gate de entrada es `surchargeAmount > 0`,
 * imposible ahora). `applyInitialPaidSurchargeCorrection` en sí — la
 * MUTACIÓN (anular + reemitir el pago) — sigue siendo código válido y
 * merece cobertura directa, así que estas pruebas arman el candidato a
 * mano en vez de obtenerlo del detector (que ya no puede producir uno).
 */
function syntheticCandidate(state: PaymentsRepositoryState, studentId: string): {
  studentId: string;
  chargeId: string;
  billingPeriod: string;
  originalPaymentId: string;
  originalAmount: number;
  surchargeAmount: number;
  balance: number;
  isCertain: boolean;
} {
  const charge = state.charges[0];
  return {
    studentId,
    chargeId: charge.id,
    billingPeriod: charge.billingPeriod!,
    originalPaymentId: state.payments[0].id,
    originalAmount: charge.originalAmount,
    surchargeAmount: 0,
    balance: 0,
    isCertain: true,
  };
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): este módulo entero reparaba un bug real de
// recargo (`chargeState.surchargeAmount > 0` era su gate de entrada, ver
// `initialPaidSurchargeRepair.ts` línea ~96) — con `calculateSurchargeAmount`
// devolviendo siempre 0, ese patrón ya NUNCA puede detectarse: no existe
// ningún estado financiero, real o histórico, que hoy recalcule con recargo
// (el motor recalcula todo en caliente contra la configuración vigente, no
// contra un valor persistido). Los 3 casos originales ("certeza", "otra
// deuda", "historial previo") se consolidan en una única prueba que
// confirma la inertización total del detector. El módulo queda como código
// muerto (nunca encuentra nada) — señalado como candidato a eliminación en
// una tarea aparte, fuera del alcance de esta corrección.
// ---------------------------------------------------------------------------

test('findInitialPaidSurchargeCandidates nunca encuentra ningún candidato: sin recargos automáticos, ese patrón de bug ya no puede ocurrir', () => {
  const certainScenario = buildBuggyState({
    studentId: 's_certain',
    dateJoined: '2026-07-26T15:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  assertEqual(
    findInitialPaidSurchargeCandidates({
      now: NOW,
      charges: certainScenario.charges,
      payments: certainScenario.payments,
      allocations: certainScenario.allocations,
      adjustments: certainScenario.adjustments,
      students: [{ id: 's_certain', dateJoined: '2026-07-26T15:00:00.000Z' }],
    }).length,
    0,
    'lo que antes era el caso de "certeza absoluta" ya nunca produce recargo, así que nunca entra como candidato'
  );

  const otraDeudaScenario = buildBuggyState({
    studentId: 's_otra_deuda',
    dateJoined: '2026-07-26T15:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  const realDebtCharge = buildMonthlyCharge({
    studentId: 's_otra_deuda',
    billingPeriod: '2026-06',
    dueDate: '2026-06-01',
    originalAmount: 15000,
    createdAt: '2026-06-01T09:00:00.000Z',
    existingCharges: otraDeudaScenario.charges,
  });
  assertEqual(
    findInitialPaidSurchargeCandidates({
      now: NOW,
      charges: [...otraDeudaScenario.charges, realDebtCharge],
      payments: otraDeudaScenario.payments,
      allocations: otraDeudaScenario.allocations,
      adjustments: otraDeudaScenario.adjustments,
      students: [{ id: 's_otra_deuda', dateJoined: '2026-07-26T15:00:00.000Z' }],
    }).length,
    0,
    'con otra deuda real tampoco: nunca hay recargo que detectar'
  );

  const historialScenario = buildBuggyState({
    studentId: 's_historial',
    dateJoined: '2026-06-01T09:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  const previousPayment = recordPayment({
    id: 'payment_s_historial_prev',
    studentId: 's_historial',
    amount: 15000,
    method: 'efectivo',
    paidAt: '2026-06-05',
    recordedAt: '2026-06-05T09:00:00.000Z',
    todayDateKey: '2026-06-05',
  });
  assertEqual(
    findInitialPaidSurchargeCandidates({
      now: NOW,
      charges: historialScenario.charges,
      payments: [...historialScenario.payments, previousPayment],
      allocations: historialScenario.allocations,
      adjustments: historialScenario.adjustments,
      students: [{ id: 's_historial', dateJoined: '2026-06-01T09:00:00.000Z' }],
    }).length,
    0,
    'con historial de pagos previos tampoco: nunca hay recargo que detectar'
  );
});

test('NUNCA toca una deuda real (pago parcial genuino, no el patrón exacto del bug)', () => {
  const dueDate = '2026-07-01';
  const charge = buildMonthlyCharge({
    studentId: 's_deuda_real',
    billingPeriod: '2026-07',
    dueDate,
    originalAmount: 20000,
    createdAt: '2026-07-20T15:00:00.000Z',
    existingCharges: [],
  });
  // Pago PARCIAL real (10.000 de 20.000) — nunca coincide con "pagó
  // exactamente el capital completo", así que nunca puede confundirse con
  // el patrón del bug.
  const partialPayment = recordPayment({
    id: 'payment_s_deuda_real_1',
    studentId: 's_deuda_real',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-20',
    recordedAt: '2026-07-20T15:00:00.000Z',
    todayDateKey: '2026-07-20',
  });
  const allocation = allocatePayment({
    id: 'payment_s_deuda_real_1_alloc_1',
    paymentId: partialPayment.id,
    chargeId: charge.id,
    amount: 10000,
    state: { charges: [charge], payments: [partialPayment], allocations: [], adjustments: [] },
  });

  const candidates = findInitialPaidSurchargeCandidates({
    now: NOW,
    charges: [charge],
    payments: [partialPayment],
    allocations: [allocation],
    adjustments: [],
    students: [{ id: 's_deuda_real', dateJoined: '2026-07-20T15:00:00.000Z' }],
  });

  assertEqual(candidates.length, 0, 'una deuda real (pago parcial genuino) nunca se identifica como el patrón del bug');
});

test('la corrección deja saldo cero, sin recargo, "on_time", y marca el pago nuevo como situación inicial declarada', () => {
  const state = buildBuggyState({
    studentId: 's_correccion',
    dateJoined: '2026-07-26T15:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  const candidate = syntheticCandidate(state, 's_correccion');

  const result = applyInitialPaidSurchargeCorrection({
    candidate,
    state,
    now: NOW,
    newPaymentId: 'payment_s_correccion_new',
    newAllocationId: 'payment_s_correccion_new_alloc_1',
  });

  const originalPayment = result.nextState.payments.find((p) => p.id === state.payments[0].id)!;
  assert(originalPayment.voidedAt !== null, 'el pago original queda anulado, nunca borrado');
  assertEqual(originalPayment.voidReason, INITIAL_PAID_SURCHARGE_CORRECTION_REASON, 'motivo exacto de la corrección');

  const newPayment = result.nextState.payments.find((p) => p.id === 'payment_s_correccion_new')!;
  assertEqual(newPayment.paidAt, '2026-07-01', 'el pago nuevo queda en término (día 1)');
  assertEqual(newPayment.source, 'initial_student_setup', 'marcado como situación inicial declarada');
  assertEqual(newPayment.replacesPaymentId, originalPayment.id, 'referencia al pago que reemplaza');

  const charge = result.nextState.charges.find((c) => c.id === candidate.chargeId)!;
  const chargeState = calculateChargeState({
    charge,
    allocations: result.nextState.allocations,
    payments: result.nextState.payments,
    adjustments: result.nextState.adjustments,
    evaluationDate: '2026-07-29',
  });
  assertEqual(chargeState.balance, 0, 'saldo cero tras la corrección');
  assertEqual(chargeState.surchargeAmount, 0, 'sin recargo tras la corrección');
  assertEqual(chargeState.stage, 'on_time', '"Pagado en término" tras la corrección');
});

test('IDEMPOTENCIA: el detector real ya nunca encuentra un candidato sobre un estado corregido a mano (ni sobre ningún otro)', () => {
  const state = buildBuggyState({
    studentId: 's_idempotente',
    dateJoined: '2026-07-26T15:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  const students = [{ id: 's_idempotente', dateJoined: '2026-07-26T15:00:00.000Z' }];
  const candidate = syntheticCandidate(state, 's_idempotente');

  const result = applyInitialPaidSurchargeCorrection({
    candidate,
    state,
    now: NOW,
    newPaymentId: 'payment_s_idempotente_new',
    newAllocationId: 'payment_s_idempotente_new_alloc_1',
  });

  const secondPass = findInitialPaidSurchargeCandidates({
    now: NOW,
    charges: result.nextState.charges,
    payments: result.nextState.payments,
    allocations: result.nextState.allocations,
    adjustments: result.nextState.adjustments,
    students,
  });
  assertEqual(secondPass.length, 0, 'sobre el estado ya corregido: ningún candidato — nunca se duplica el ajuste');
});

test('aplicar la corrección sobre un pago ya anulado (reparación repetida a mano) se rechaza con un error claro, nunca crea un segundo ajuste', () => {
  const state = buildBuggyState({
    studentId: 's_doble_manual',
    dateJoined: '2026-07-26T15:00:00.000Z',
    billingPeriod: '2026-07',
    paidAtLate: '2026-07-26',
  });
  const candidate = syntheticCandidate(state, 's_doble_manual');
  const result = applyInitialPaidSurchargeCorrection({
    candidate,
    state,
    now: NOW,
    newPaymentId: 'payment_s_doble_manual_new',
    newAllocationId: 'payment_s_doble_manual_new_alloc_1',
  });

  let threw = false;
  try {
    // Reintentar la MISMA corrección (candidato viejo) contra el estado ya corregido.
    applyInitialPaidSurchargeCorrection({
      candidate,
      state: result.nextState,
      now: NOW,
      newPaymentId: 'payment_s_doble_manual_new_2',
      newAllocationId: 'payment_s_doble_manual_new_2_alloc_1',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'reintentar sobre un pago ya anulado se rechaza explícitamente');
});
