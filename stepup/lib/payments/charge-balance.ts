import type { PaymentAllocationLike, PaymentChargeLike } from "./types.ts";

/**
 * Puerto SIMPLIFICADO de `paymentCalculations.ts::calculateSafeAllocationCapacity`
 * (móvil). El original resuelve una capacidad "seguraCapacity" comparando
 * varios checkpoints de fecha porque el recargo podía variar con el día de
 * evaluación. Como esta fase NUNCA calcula recargo (`calculateSurchargeAmount`
 * siempre devuelve 0 — decisión de negocio confirmada, ver `due-stage.ts`),
 * el monto requerido en cualquier checkpoint colapsa siempre a
 * `originalAmount`, sin importar la fecha — por eso acá la capacidad es
 * aritmética simple, EQUIVALENTE en resultado al motor móvil bajo recargo 0
 * (nunca una regla nueva). Las condonaciones (`payment_adjustments`) también
 * quedan fuera a propósito: con recargo siempre 0, una condonación de
 * recargo no puede alterar ya ningún resultado (mismo hallazgo documentado
 * en WEB_PARITY_PLAN.md) — no existe UI para crearlas, tampoco en el móvil.
 */

/** Suma de asignaciones VIGENTES (pago no anulado) para un cargo puntual. */
export function calculatePaidAmountForCharge(chargeId: string, allocations: readonly PaymentAllocationLike[]): number {
  return allocations
    .filter((allocation) => allocation.chargeId === chargeId && allocation.paymentVoidedAt === null)
    .reduce((sum, allocation) => sum + allocation.amount, 0);
}

export interface ChargeBalance {
  totalDue: number;
  paidAmount: number;
  balance: number;
  isFullyPaid: boolean;
}

/** Total adeudado (= originalAmount, nunca recargo), pagado y saldo pendiente de UN cargo puntual. */
export function calculateChargeBalance(
  charge: Pick<PaymentChargeLike, "originalAmount">,
  paidAmount: number,
): ChargeBalance {
  const balance = Math.max(0, charge.originalAmount - paidAmount);
  return { totalDue: charge.originalAmount, paidAmount, balance, isFullyPaid: balance === 0 };
}

/**
 * Cuánto se le puede asignar todavía a UN cargo puntual — nunca la deuda
 * total del alumno (ver `calculateAssignableDebt`). `0` si el cargo ya está
 * anulado.
 */
export function calculateAssignableForCharge(
  charge: Pick<PaymentChargeLike, "originalAmount" | "voidedAt"> | undefined,
  paidAmount: number,
): number {
  if (!charge || charge.voidedAt !== null) return 0;
  return Math.max(0, charge.originalAmount - paidAmount);
}
