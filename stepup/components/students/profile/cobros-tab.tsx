import { calculatePaidAmountForCharge, calculateChargeBalance } from "@/lib/payments/charge-balance";
import { determineDueStage, isChargeOverdueForDisplay } from "@/lib/payments/due-stage";
import { EmptyState } from "@/components/ui/states";
import { ChargeActions } from "@/components/payments/charge-actions";
import { VoidPaymentButton } from "@/components/payments/void-payment-button";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "@/lib/repositories/payments";

const CHARGE_TYPE_LABEL: Record<string, string> = {
  mensual: "Mensualidad",
  por_clase: "Clase suelta",
  entrenamiento: "Entrenamiento",
  semanal: "Semanal",
  quincenal: "Quincenal",
  paquete: "Paquete",
};

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", otro: "Otro" };

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount);
}

/**
 * Pestaña real de Cobros del alumno — puerto de `CobrosTab.tsx` (móvil),
 * acotado a lo portado en esta fase: obligaciones vigentes/históricas
 * (con acción real "Registrar pago"/"Anular cobro" por cargo) y el
 * historial de pagos (con "Anular" por pago). Nunca muestra ni calcula
 * recargo — ver `lib/payments/due-stage.ts`.
 */
export function CobrosTabContent({
  studentId,
  charges,
  payments,
  allocations,
  todayDateKey,
}: {
  studentId: string;
  charges: PaymentChargeRecord[];
  payments: PaymentRecord[];
  allocations: PaymentAllocationRecord[];
  todayDateKey: string;
}) {
  const voidedAtByPaymentId = new Map(payments.map((p) => [p.id, p.voidedAt]));
  const allocationsLike = allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount, paymentVoidedAt: voidedAtByPaymentId.get(a.paymentId) ?? null }));

  const sortedCharges = [...charges].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));
  const sortedPayments = [...payments].sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-textPrimary">Obligaciones</h2>
        {sortedCharges.length === 0 ? (
          <div className="mt-3">
            <EmptyState message="Todavía no hay cobros generados para este alumno." />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {sortedCharges.map((charge) => {
              const paidAmount = calculatePaidAmountForCharge(charge.id, allocationsLike);
              const balance = calculateChargeBalance(charge, paidAmount);
              const stage = determineDueStage(charge.chargeType, charge.dueDate, todayDateKey);
              const isOverdue = isChargeOverdueForDisplay(charge.chargeType, charge.dueDate, stage, todayDateKey);
              return (
                <li key={charge.id} className={`rounded-lg border p-3.5 ${charge.voidedAt ? "border-border bg-background opacity-60" : "border-border bg-surface shadow-card"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">
                        {CHARGE_TYPE_LABEL[charge.chargeType] ?? charge.chargeType}
                        {charge.trainingSeriesName ? ` · ${charge.trainingSeriesName}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-textMuted">Vence {charge.dueDate}</p>
                    </div>
                    {charge.voidedAt ? (
                      <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textMuted">Anulado</span>
                    ) : balance.isFullyPaid ? (
                      <span className="rounded-pill bg-statusVerde/10 px-2.5 py-1 text-xs font-semibold text-statusVerde">Pagado</span>
                    ) : isOverdue ? (
                      <span className="rounded-pill bg-statusRojo/10 px-2.5 py-1 text-xs font-semibold text-statusRojo">Vencido</span>
                    ) : (
                      <span className="rounded-pill bg-statusPendiente/10 px-2.5 py-1 text-xs font-semibold text-statusPendiente">Pendiente</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-textSecondary">
                    Importe original: <span className="font-medium text-textPrimary">{formatCurrency(charge.originalAmount)}</span>
                    {paidAmount > 0 && <> · Pagado: <span className="font-medium text-textPrimary">{formatCurrency(paidAmount)}</span></>}
                    {!charge.voidedAt && !balance.isFullyPaid && (
                      <>
                        {" "}
                        · Pendiente: <span className="font-semibold text-textPrimary">{formatCurrency(balance.balance)}</span>
                      </>
                    )}
                  </p>
                  {charge.voidedAt && charge.voidReason && <p className="mt-1 text-xs text-textMuted">Motivo: {charge.voidReason}</p>}
                  {!charge.voidedAt && !balance.isFullyPaid && <ChargeActions chargeId={charge.id} studentId={studentId} balance={balance.balance} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-textPrimary">Pagos registrados</h2>
        {sortedPayments.length === 0 ? (
          <div className="mt-3">
            <EmptyState message="Todavía no hay pagos registrados." />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {sortedPayments.map((payment) => (
              <li key={payment.id} className={`rounded-lg border border-border p-3 ${payment.voidedAt ? "bg-background opacity-60" : "bg-surface shadow-card"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-textPrimary">
                    <span className="font-semibold">{formatCurrency(payment.amount)}</span> · {METHOD_LABEL[payment.method] ?? payment.method} · {payment.paidAt}
                  </p>
                  {payment.voidedAt ? (
                    <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textMuted">Anulado</span>
                  ) : (
                    <VoidPaymentButton paymentId={payment.id} />
                  )}
                </div>
                {payment.notes && <p className="mt-1 text-xs text-textMuted">{payment.notes}</p>}
                {payment.voidedAt && payment.voidReason && <p className="mt-1 text-xs text-textMuted">Anulado: {payment.voidReason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
