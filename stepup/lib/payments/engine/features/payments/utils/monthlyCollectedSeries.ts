// Puerto VERBATIM del original (`src/features/payments/utils/monthlyCollectedSeries.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentsRepositoryState } from '../types/index.ts';
import { billingPeriodOfDateKey, toDateKey } from './paymentDates.ts';

/**
 * Fase financiera — Plan de distribución 50/30/20: generaliza a VARIOS
 * períodos el mismo criterio exacto que ya usa `buildHomeFinancialSummary`
 * para "cobrado este mes" — nunca lo reimplementa con otra lógica. Agrupa
 * por `Payment.paidAt` (fecha real de pago, nunca `recordedAt`), usa
 * únicamente `PaymentAllocation.amount` (importe realmente asignado — un
 * pago parcial cuenta sólo por lo asignado), e ignora cargos y pagos
 * anulados por completo. Pura — nunca muta `state`.
 */
export function buildMonthlyCollectedSeries(
  state: PaymentsRepositoryState,
  periods: readonly string[]
): Record<string, number> {
  const activeChargeIds = new Set(state.charges.filter((charge) => charge.voidedAt === null).map((charge) => charge.id));
  const paymentById = new Map(state.payments.map((payment) => [payment.id, payment]));

  const result: Record<string, number> = {};
  periods.forEach((period) => {
    result[period] = 0;
  });

  state.allocations.forEach((allocation) => {
    if (!activeChargeIds.has(allocation.chargeId)) return;
    const payment = paymentById.get(allocation.paymentId);
    if (!payment || payment.voidedAt !== null) return;
    const period = billingPeriodOfDateKey(toDateKey(payment.paidAt));
    if (!(period in result)) return;
    result[period] += allocation.amount;
  });

  return result;
}
