import { calculateChargeBalance } from "../payments/charge-balance.ts";
import { determineDueStage, isChargeOverdueForDisplay } from "../payments/due-stage.ts";
import { toDateKey } from "../payments/dates.ts";
import { dateKeyInRange, type DateRange } from "./period.ts";
import type { PaymentChargeLike } from "../payments/types.ts";

/**
 * Puerto exacto de `buildPeriodFinancialSummary` (móvil,
 * `periodFinancialSummary.ts`). "Facturación prevista" es de base
 * DEVENGADO (`dueDate` dentro del rango, cargos activos, sin importar si
 * están pagados); "Cobrado" es de base CAJA (`payment.paidAt` real dentro
 * del rango, nunca `recordedAt`) — por diseño, prevista NO tiene por qué
 * ser igual a cobrado + pendiente + vencido (dos bases contables
 * distintas, documentado explícitamente en el móvil). Nunca cuenta
 * recargo (estructuralmente desactivado, commit móvil `94ce7be`). Pura.
 */
export interface PeriodFinancialSummaryInput {
  charges: readonly (PaymentChargeLike & { studentId: string })[];
  allocations: readonly { chargeId: string; paymentId: string; amount: number }[];
  payments: readonly { id: string; paidAt: string; voidedAt: string | null }[];
  range: DateRange;
  evaluationDate: string;
}

export interface PeriodFinancialSummary {
  generated: number;
  collected: number;
  pending: number;
  overdue: number;
}

export function buildPeriodFinancialSummary(input: PeriodFinancialSummaryInput): PeriodFinancialSummary {
  const activeCharges = input.charges.filter((charge) => charge.voidedAt === null);
  const chargesInRange = activeCharges.filter((charge) => dateKeyInRange(charge.dueDate, input.range.rangeStart, input.range.rangeEnd));
  const activeChargeIds = new Set(activeCharges.map((charge) => charge.id));

  const generated = chargesInRange.reduce((sum, charge) => sum + charge.originalAmount, 0);

  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));

  // Asignaciones VIGENTES (pago no anulado) — resuelto acá mismo contra
  // `payments`, nunca requiere que el llamador ya sepa de antemano qué
  // pago está anulado (evita el campo redundante `paymentVoidedAt` que sí
  // necesita el Centro de Cobros para otro propósito).
  const activeAllocations = input.allocations.filter((allocation) => {
    const payment = paymentById.get(allocation.paymentId);
    return !!payment && payment.voidedAt === null;
  });

  let collected = 0;
  activeAllocations.forEach((allocation) => {
    if (!activeChargeIds.has(allocation.chargeId)) return;
    const payment = paymentById.get(allocation.paymentId);
    if (!payment || !dateKeyInRange(toDateKey(payment.paidAt), input.range.rangeStart, input.range.rangeEnd)) return;
    collected += allocation.amount;
  });

  let pending = 0;
  let overdue = 0;
  chargesInRange.forEach((charge) => {
    const paidAmount = activeAllocations.filter((a) => a.chargeId === charge.id).reduce((sum, a) => sum + a.amount, 0);
    const balance = calculateChargeBalance(charge, paidAmount);
    if (balance.balance <= 0) return;
    const stage = determineDueStage(charge.chargeType, charge.dueDate, input.evaluationDate);
    if (isChargeOverdueForDisplay(charge.chargeType, charge.dueDate, stage, input.evaluationDate)) {
      overdue += balance.balance;
    } else {
      pending += balance.balance;
    }
  });

  return { generated, collected, pending, overdue };
}
