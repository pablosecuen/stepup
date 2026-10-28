// Puerto VERBATIM del original (`src/features/payments/utils/registerPaymentPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { buildDatedAllocationsForCharge, calculateSafeAllocationCapacity, isSurchargeWaivedForCharge } from './paymentCalculations.ts';
import { allocatePayment, recordPayment } from './paymentMutations.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';
import type { Payment, PaymentAllocation, PaymentMethod, PaymentsRepositoryState } from '../types/index.ts';

export interface RegisterPaymentPlanInput {
  paymentId: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD, fecha real elegida por la profesora
  recordedAt: string; // ISO, instante real de carga
  todayDateKey: string; // inyectado, igual que recordPayment
  notes?: string;
  /** Estado financiero completo, ya persistido. */
  state: PaymentsRepositoryState;
  /** Prefijo para los ids determinísticos de las asignaciones que genere este pago. */
  allocationIdPrefix: string;
  /** Configuración REAL de recargos vigente — ver `allocatePayment` para el motivo. */
  surchargeSettings?: SurchargeSettings;
}

export interface RegisterPaymentPlanResult {
  payment: Payment;
  allocations: PaymentAllocation[];
}

/**
 * Distribuye un pago entre las obligaciones VIGENTES (no anuladas) del
 * alumno, empezando siempre por la de vencimiento más antiguo. Para cada
 * obligación, usa lo que realmente se debe A LA FECHA REAL DEL PAGO
 * (`paidAt`) — así un pago retroactivo recalcula la deuda con el recargo
 * vigente ese día, no el de hoy. Nunca deja saldo a favor: si el importe
 * supera lo que se puede asignar a las obligaciones pendientes del alumno,
 * rechaza la operación completa (no crea el pago, no crea ninguna
 * asignación parcial). `Payment` y todas sus `PaymentAllocation` se arman
 * en la misma llamada, listos para escribirse juntos en una única mutación
 * atómica del store. Pura — no muta `input.state`.
 */
export function planPaymentRegistration(input: RegisterPaymentPlanInput): RegisterPaymentPlanResult {
  const payment = recordPayment({
    id: input.paymentId,
    studentId: input.studentId,
    amount: input.amount,
    method: input.method,
    paidAt: input.paidAt,
    recordedAt: input.recordedAt,
    todayDateKey: input.todayDateKey,
    notes: input.notes,
  });

  const studentCharges = input.state.charges
    .filter((charge) => charge.studentId === input.studentId && charge.voidedAt === null)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  let simulatedState: PaymentsRepositoryState = {
    ...input.state,
    payments: [...input.state.payments, payment],
  };

  const allocations: PaymentAllocation[] = [];
  let remaining = input.amount;
  let allocationIndex = 0;

  for (const charge of studentCharges) {
    if (remaining <= 0) break;

    // Capacidad segura en `paidAt`, considerando TODAS las asignaciones
    // vigentes del cargo (anteriores y posteriores) — misma función que usa
    // `allocatePayment` para validar, así la distribución nunca ofrece un
    // importe que la validación real termine rechazando.
    const isWaived = isSurchargeWaivedForCharge(charge.id, simulatedState.adjustments);
    const existingDatedAllocations = buildDatedAllocationsForCharge(
      charge.id,
      simulatedState.allocations,
      simulatedState.payments
    );
    const safeCapacity = calculateSafeAllocationCapacity(
      charge,
      existingDatedAllocations,
      input.paidAt,
      isWaived,
      input.surchargeSettings
    );
    if (safeCapacity <= 0) continue;

    const amountToAllocate = Math.min(remaining, safeCapacity);
    allocationIndex += 1;
    const allocation = allocatePayment({
      id: `${input.allocationIdPrefix}${allocationIndex}`,
      paymentId: payment.id,
      chargeId: charge.id,
      amount: amountToAllocate,
      state: simulatedState,
      surchargeSettings: input.surchargeSettings,
    });

    allocations.push(allocation);
    simulatedState = { ...simulatedState, allocations: [...simulatedState.allocations, allocation] };
    remaining -= amountToAllocate;
  }

  if (remaining > 0) {
    throw new RangeError(
      'El importe supera lo que se puede asignar a las obligaciones pendientes del alumno. Todavía no se admite saldo a favor.'
    );
  }

  return { payment, allocations };
}

/**
 * Cuánto se le puede asignar HOY (o en la fecha de pago elegida,
 * `evaluationDate`) a las obligaciones vigentes de un alumno, sumando la
 * capacidad segura de cada una — la misma `calculateSafeAllocationCapacity`
 * que usan `allocatePayment` y `planPaymentRegistration`, así el máximo que
 * la UI muestra siempre coincide con lo que el registro real va a aceptar.
 * Pensada para recalcularse en cada cambio de fecha en el formulario (un
 * pago retroactivo puede tener una capacidad distinta a la de hoy). Pura —
 * no muta `state`.
 */
export function calculateAssignableDebt(input: {
  studentId: string;
  state: PaymentsRepositoryState;
  evaluationDate: string;
  /** Configuración REAL de recargos vigente — ver `allocatePayment` para el motivo. */
  surchargeSettings?: SurchargeSettings;
}): number {
  return input.state.charges
    .filter((charge) => charge.studentId === input.studentId && charge.voidedAt === null)
    .reduce((sum, charge) => {
      const isWaived = isSurchargeWaivedForCharge(charge.id, input.state.adjustments);
      const existingDatedAllocations = buildDatedAllocationsForCharge(
        charge.id,
        input.state.allocations,
        input.state.payments
      );
      const capacity = calculateSafeAllocationCapacity(
        charge,
        existingDatedAllocations,
        input.evaluationDate,
        isWaived,
        input.surchargeSettings
      );
      return sum + capacity;
    }, 0);
}

/**
 * Corrección (a pedido de Joaquín — SALDO INCORRECTO EN PAGOS PARCIALES):
 * capacidad segura de UN cargo puntual — nunca la deuda TOTAL del alumno
 * (`calculateAssignableDebt`, de arriba, suma TODAS sus obligaciones
 * vigentes a propósito, para el registro general que reparte empezando por
 * la más antigua). Cuando la profesora eligió un cargo específico (p. ej.
 * desde Centro de cobros), el máximo asignable y el saldo mostrado deben
 * salir EXCLUSIVAMENTE de ESE cargo — otra obligación del mismo alumno
 * (mensualidad, otro entrenamiento) nunca debe alterar este número. Misma
 * `calculateSafeAllocationCapacity` que usan `allocatePayment` y
 * `planSingleChargePaymentRegistration`, así la vista previa nunca diverge
 * de lo que el registro real termina aceptando. `0` si el cargo no existe o
 * ya está anulado. Pura — no muta `state`.
 */
export function calculateAssignableForCharge(input: {
  chargeId: string;
  state: PaymentsRepositoryState;
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
}): number {
  const charge = input.state.charges.find((item) => item.id === input.chargeId && item.voidedAt === null);
  if (!charge) return 0;
  const isWaived = isSurchargeWaivedForCharge(charge.id, input.state.adjustments);
  const existingDatedAllocations = buildDatedAllocationsForCharge(charge.id, input.state.allocations, input.state.payments);
  return calculateSafeAllocationCapacity(charge, existingDatedAllocations, input.evaluationDate, isWaived, input.surchargeSettings);
}

export interface RegisterSingleChargePaymentPlanInput {
  paymentId: string;
  studentId: string;
  /** A diferencia de `planPaymentRegistration`, este pago se aplica a UN cargo puntual, nunca se reparte. */
  chargeId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD
  recordedAt: string; // ISO
  todayDateKey: string;
  notes?: string;
  state: PaymentsRepositoryState;
  allocationId: string;
  /** Configuración REAL de recargos vigente — ver `allocatePayment` para el motivo. */
  surchargeSettings?: SurchargeSettings;
}

/**
 * Registra un pago contra UN cargo específico, sin distribuirlo entre otras
 * obligaciones del alumno — a diferencia de `planPaymentRegistration`
 * (usado por el formulario general de Cobros), que reparte empezando por la
 * más antigua. Pensada para la pregunta de pago al finalizar una clase por
 * clase (Fase Pagos 4B.2): el pago de ESA clase debe aplicarse específicamente
 * a SU cargo, nunca "colarse" para saldar una deuda anterior del mismo
 * alumno. Reutiliza el mismo motor (`recordPayment` + `allocatePayment`),
 * así que respeta exactamente las mismas reglas de capacidad segura
 * (`calculateSafeAllocationCapacity`) y rechaza cualquier excedente. Pura —
 * no muta `input.state`.
 */
export function planSingleChargePaymentRegistration(
  input: RegisterSingleChargePaymentPlanInput
): RegisterPaymentPlanResult {
  const payment = recordPayment({
    id: input.paymentId,
    studentId: input.studentId,
    amount: input.amount,
    method: input.method,
    paidAt: input.paidAt,
    recordedAt: input.recordedAt,
    todayDateKey: input.todayDateKey,
    notes: input.notes,
  });

  const simulatedState: PaymentsRepositoryState = {
    ...input.state,
    payments: [...input.state.payments, payment],
  };

  const allocation = allocatePayment({
    id: input.allocationId,
    paymentId: payment.id,
    chargeId: input.chargeId,
    amount: input.amount,
    state: simulatedState,
    surchargeSettings: input.surchargeSettings,
  });

  return { payment, allocations: [allocation] };
}
