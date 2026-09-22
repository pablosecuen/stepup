import { calculateAssignableForCharge } from "./charge-balance.ts";
import type { PaymentAllocationLike, PaymentChargeLike } from "./types.ts";

/**
 * Puerto de `registerPaymentPlan.ts::planPaymentRegistration` (móvil),
 * simplificado por la ausencia estructural de recargos (ver
 * `charge-balance.ts`): distribuye un importe entre las obligaciones
 * VIGENTES de un alumno empezando siempre por la de vencimiento MÁS
 * ANTIGUO. Nunca deja saldo a favor — si el importe supera lo asignable,
 * rechaza la operación COMPLETA (ninguna asignación parcial). Pura: sólo
 * calcula el PLAN de asignaciones (chargeId + amount), nunca escribe nada —
 * la escritura real y atómica ocurre en la RPC `register_payment`, que
 * revalida esta misma aritmética en SQL como fuente de verdad.
 */
export interface AllocationPlanEntry {
  chargeId: string;
  amount: number;
}

export function planOldestFirstAllocation(input: {
  amount: number;
  charges: readonly PaymentChargeLike[];
  allocations: readonly PaymentAllocationLike[];
}): AllocationPlanEntry[] {
  const activeCharges = [...input.charges]
    .filter((charge) => charge.voidedAt === null)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const plan: AllocationPlanEntry[] = [];
  let remaining = input.amount;

  for (const charge of activeCharges) {
    if (remaining <= 0) break;
    const paidAmount = input.allocations
      .filter((allocation) => allocation.chargeId === charge.id && allocation.paymentVoidedAt === null)
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    const capacity = calculateAssignableForCharge(charge, paidAmount);
    if (capacity <= 0) continue;
    const amountToAllocate = Math.min(remaining, capacity);
    plan.push({ chargeId: charge.id, amount: amountToAllocate });
    remaining -= amountToAllocate;
  }

  if (remaining > 0) {
    throw new RangeError(
      "El importe supera lo que se puede asignar a las obligaciones pendientes del alumno. Todavía no se admite saldo a favor.",
    );
  }

  return plan;
}

/** Cuánto se le puede asignar HOY a TODAS las obligaciones vigentes de un alumno — para el formulario general de pago. */
export function calculateAssignableDebt(input: {
  charges: readonly PaymentChargeLike[];
  allocations: readonly PaymentAllocationLike[];
}): number {
  return input.charges
    .filter((charge) => charge.voidedAt === null)
    .reduce((sum, charge) => {
      const paidAmount = input.allocations
        .filter((allocation) => allocation.chargeId === charge.id && allocation.paymentVoidedAt === null)
        .reduce((s, allocation) => s + allocation.amount, 0);
      return sum + calculateAssignableForCharge(charge, paidAmount);
    }, 0);
}
