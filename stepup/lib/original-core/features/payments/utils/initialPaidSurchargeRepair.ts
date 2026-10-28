// Puerto VERBATIM del original (`src/features/payments/utils/initialPaidSurchargeRepair.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
 * nuevos): reparación segura e idempotente de alumnos ya afectados por el
 * bug real (ver `initialMonthlyBillingPlan.ts`) — un alta declarada "Este
 * mes ya está pago" cerca de fin de mes terminaba con un recargo aplicado
 * porque el `paidAt` usado era "hoy" (tardío respecto del `dueDate`, día 1
 * del mes) en vez de una fecha en término.
 *
 * Sólo corrige con certeza absoluta (`isCertain: true`) los casos donde
 * TODAS estas condiciones se cumplen a la vez:
 *   - cargo mensual vigente del período actual, con saldo pendiente
 *     originado ÚNICAMENTE por el recargo (lo pagado ya cubre exactamente
 *     el importe original, ni más ni menos);
 *   - un único pago vigente asignado a ese cargo (nunca un pago parcial
 *     real ni varios pagos superpuestos — casos ambiguos se descartan por
 *     completo, ni siquiera entran como `needs_confirmation`);
 *   - el alumno se dio de alta durante ESE MISMO período facturado;
 *   - ese pago es el ÚNICO pago histórico del alumno (nunca toca a un
 *     alumno con historial real);
 *   - ninguna otra obligación del alumno tiene deuda de capital real;
 *   - el pago se cargó dentro de los 3 días de la fecha de alta (“durante
 *     el alta o inmediatamente después”).
 *
 * Un cargo que cumple el patrón financiero (recargo + un solo pago exacto)
 * pero falla alguno de los chequeos de certeza extra se devuelve igual,
 * marcado `isCertain: false` — la UI lo usa para ofrecer
 * "[ Corregir situación inicial ]" en vez de aplicar nada solo.
 */
import type {
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
  PaymentsRepositoryState,
} from '../types/index.ts';
import { calculateChargeState } from './paymentCalculations.ts';
import { allocatePayment, recordPayment, replacePayment } from './paymentMutations.ts';
import { ARGENTINA_TIME_ZONE, billingPeriodOfDateKey, daysBetweenDateKeys, localDateKeyInTimeZone } from './paymentDates.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';

export const INITIAL_PAID_SURCHARGE_CORRECTION_REASON =
  'Corrección automática de situación inicial declarada como pagada';

export interface InitialPaidSurchargeCandidate {
  studentId: string;
  chargeId: string;
  billingPeriod: string;
  originalPaymentId: string;
  originalAmount: number;
  surchargeAmount: number;
  balance: number;
  /** true = se puede corregir automáticamente sin preguntar; false = requiere confirmación explícita de la profesora. */
  isCertain: boolean;
}

const RECENT_PAYMENT_WINDOW_DAYS = 3;

/**
 * Recorre TODO el estado financiero — nunca filtra por nombre ni por id de
 * alumno — y devuelve cada obligación mensual del período actual que
 * coincide con el patrón exacto del bug. Pura: no muta ninguna de las
 * colecciones recibidas.
 */
export function findInitialPaidSurchargeCandidates(input: {
  now: Date;
  charges: PaymentCharge[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  adjustments: PaymentAdjustment[];
  students: Array<{ id: string; dateJoined: string }>;
  /** Configuración REAL de recargos vigente — sin esto, el patrón "saldo restante originado únicamente por recargo" se detectaba como si los recargos siempre estuvieran activados, aunque la profesora los haya desactivado. */
  surchargeSettings?: SurchargeSettings;
}): InitialPaidSurchargeCandidate[] {
  const todayDateKey = localDateKeyInTimeZone(input.now, ARGENTINA_TIME_ZONE);
  const currentBillingPeriod = billingPeriodOfDateKey(todayDateKey);
  const studentById = new Map(input.students.map((student) => [student.id, student]));

  const candidates: InitialPaidSurchargeCandidate[] = [];

  input.charges.forEach((charge) => {
    if (charge.type !== 'mensual') return;
    if (charge.voidedAt !== null) return;
    if (charge.billingPeriod !== currentBillingPeriod) return;

    const chargeState = calculateChargeState({
      charge,
      allocations: input.allocations,
      payments: input.payments,
      adjustments: input.adjustments,
      evaluationDate: todayDateKey,
      surchargeSettings: input.surchargeSettings,
    });

    // "saldo restante originado únicamente por recargo": lo pagado cubre
    // EXACTO el capital, ni más ni menos — nunca un pago parcial real.
    if (chargeState.surchargeAmount <= 0) return;
    if (chargeState.balance <= 0) return;
    if (chargeState.paidAmount !== charge.originalAmount) return;

    const chargeAllocations = input.allocations.filter((allocation) => allocation.chargeId === charge.id);
    const activePayments = new Map(
      input.payments.filter((payment) => payment.voidedAt === null).map((payment) => [payment.id, payment])
    );
    const activeAllocations = chargeAllocations.filter((allocation) => activePayments.has(allocation.paymentId));
    // Más de un pago/asignación vigente para este cargo: caso ambiguo,
    // nunca se toca — ni con certeza ni pidiendo confirmación.
    if (activeAllocations.length !== 1) return;

    const allocation = activeAllocations[0];
    if (allocation.amount !== charge.originalAmount) return;
    const payment = activePayments.get(allocation.paymentId);
    if (!payment) return;

    const student = studentById.get(charge.studentId);
    if (!student) return;

    const studentDateKey = localDateKeyInTimeZone(new Date(student.dateJoined), ARGENTINA_TIME_ZONE);
    const studentJoinedThisPeriod = billingPeriodOfDateKey(studentDateKey) === charge.billingPeriod;

    const studentActivePayments = input.payments.filter(
      (candidatePayment) => candidatePayment.studentId === charge.studentId && candidatePayment.voidedAt === null
    );
    const isOnlyHistoricalPayment = studentActivePayments.length === 1 && studentActivePayments[0].id === payment.id;

    const studentCharges = input.charges.filter(
      (candidateCharge) => candidateCharge.studentId === charge.studentId && candidateCharge.voidedAt === null
    );
    const hasRealCapitalDebtElsewhere = studentCharges.some((candidateCharge) => {
      if (candidateCharge.id === charge.id) return false;
      const candidateState = calculateChargeState({
        charge: candidateCharge,
        allocations: input.allocations,
        payments: input.payments,
        adjustments: input.adjustments,
        evaluationDate: todayDateKey,
        surchargeSettings: input.surchargeSettings,
      });
      return candidateState.balance > 0;
    });

    const daysSinceJoin = daysBetweenDateKeys(studentDateKey, payment.paidAt);
    const paymentRecordedNearJoin = daysSinceJoin >= 0 && daysSinceJoin <= RECENT_PAYMENT_WINDOW_DAYS;

    const isCertain =
      studentJoinedThisPeriod && isOnlyHistoricalPayment && !hasRealCapitalDebtElsewhere && paymentRecordedNearJoin;

    candidates.push({
      studentId: charge.studentId,
      chargeId: charge.id,
      billingPeriod: charge.billingPeriod!,
      originalPaymentId: payment.id,
      originalAmount: charge.originalAmount,
      surchargeAmount: chargeState.surchargeAmount,
      balance: chargeState.balance,
      isCertain,
    });
  });

  return candidates;
}

export interface InitialPaidSurchargeCorrectionResult {
  nextState: PaymentsRepositoryState;
  studentId: string;
  billingPeriod: string;
  chargeId: string;
  previousSurchargeAmount: number;
  voidedPaymentId: string;
  newPaymentId: string;
}

/**
 * Corrige UN candidato contra un `state` ya confirmado (siempre llamado
 * desde dentro de `applyPaymentsMutation`, nunca contra un snapshot viejo —
 * así queda naturalmente serializado ante corridas concurrentes). Nunca
 * borra el pago original: lo anula y registra uno nuevo con el mismo
 * importe/método, `paidAt` corregido a `charge.dueDate` (siempre en
 * término) y `recordedAt` igual al original (nunca se inventa cuándo se
 * cargó de verdad). Reutiliza `replacePayment`/`allocatePayment`, el mismo
 * mecanismo de "corregir un pago" ya existente en el dominio — nunca un
 * segundo motor de mutaciones.
 */
export function applyInitialPaidSurchargeCorrection(input: {
  candidate: InitialPaidSurchargeCandidate;
  state: PaymentsRepositoryState;
  now: Date;
  newPaymentId: string;
  newAllocationId: string;
  reason?: string;
}): InitialPaidSurchargeCorrectionResult {
  const { candidate, state, now, newPaymentId, newAllocationId } = input;
  const reason = input.reason?.trim() || INITIAL_PAID_SURCHARGE_CORRECTION_REASON;

  const charge = state.charges.find((item) => item.id === candidate.chargeId);
  if (!charge || charge.voidedAt !== null) {
    throw new Error('La obligación ya no está vigente — no hay nada que corregir.');
  }
  const originalPayment = state.payments.find((item) => item.id === candidate.originalPaymentId);
  if (!originalPayment || originalPayment.voidedAt !== null) {
    throw new Error('El pago original ya no está vigente — probablemente ya se corrigió antes.');
  }

  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const nowIso = now.toISOString();

  const newPayment = recordPayment({
    id: newPaymentId,
    studentId: candidate.studentId,
    amount: originalPayment.amount,
    method: originalPayment.method,
    paidAt: charge.dueDate,
    recordedAt: originalPayment.recordedAt,
    todayDateKey,
    notes: originalPayment.notes,
    source: 'initial_student_setup',
  });

  const { payments: paymentsAfterReplace, newPayment: linkedNewPayment } = replacePayment(
    state.payments,
    originalPayment.id,
    reason,
    nowIso,
    newPayment
  );

  const newAllocation = allocatePayment({
    id: newAllocationId,
    paymentId: linkedNewPayment.id,
    chargeId: charge.id,
    amount: originalPayment.amount,
    state: { ...state, payments: paymentsAfterReplace },
  });

  const nextState: PaymentsRepositoryState = {
    ...state,
    payments: paymentsAfterReplace,
    allocations: [...state.allocations, newAllocation],
  };

  return {
    nextState,
    studentId: candidate.studentId,
    billingPeriod: candidate.billingPeriod,
    chargeId: charge.id,
    previousSurchargeAmount: candidate.surchargeAmount,
    voidedPaymentId: originalPayment.id,
    newPaymentId: linkedNewPayment.id,
  };
}
