export type RegistrationChargeState = "pagada" | "parcial" | "pendiente";

export interface RegistrationChargeSummary {
  total: number;
  paid: number;
  balance: number;
  state: RegistrationChargeState;
  /** Pagos vigentes (no anulados) asignados a ESTE cobro, del más viejo al más nuevo. */
  payments: { paidAt: string; amount: number }[];
}

/** Situación real del cobro de UNA clase: sólo cuentan los pagos vigentes asignados a ese cobro (nunca los de otra clase, serie o entrenamiento). PURO. */
export function summarizeRegistrationCharge(input: {
  originalAmount: number;
  allocations: readonly { paymentId: string; amount: number }[];
  payments: ReadonlyMap<string, { paidAt: string; voidedAt: string | null }>;
}): RegistrationChargeSummary {
  const live = input.allocations
    .map((allocation) => ({ allocation, payment: input.payments.get(allocation.paymentId) }))
    .filter((entry): entry is { allocation: { paymentId: string; amount: number }; payment: { paidAt: string; voidedAt: string | null } } => !!entry.payment && entry.payment.voidedAt === null);
  const paid = live.reduce((sum, entry) => sum + entry.allocation.amount, 0);
  const balance = Math.max(0, input.originalAmount - paid);
  const state: RegistrationChargeState = balance === 0 && input.originalAmount > 0 ? "pagada" : paid > 0 ? "parcial" : "pendiente";
  return {
    total: input.originalAmount,
    paid,
    balance,
    state,
    payments: live.map((entry) => ({ paidAt: entry.payment.paidAt, amount: entry.allocation.amount })).sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0)),
  };
}

export const REGISTRATION_CHARGE_STATE_LABEL: Record<RegistrationChargeState, string> = { pagada: "Pagada", parcial: "Pago parcial", pendiente: "Pendiente" };
