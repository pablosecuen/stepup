import { BanknotesIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon, NoSymbolIcon, QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import { EXCESS_STATUS_LABEL, excessExplanation, excessLinesForCharge, excessLinesForPayment, sumExcess } from "@/lib/payments/excess";
import { OriginIncidentNote } from "@/components/registro/origin-incidents-card";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { calculatePaidAmountForCharge, calculateChargeBalance } from "@/lib/payments/charge-balance";
import { determineDueStage, isChargeOverdueForDisplay } from "@/lib/payments/due-stage";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { ChargeActions } from "@/components/payments/charge-actions";
import { BillingPlanCard } from "@/components/students/profile/billing-plan-card";
import { MonthlyStatusCard } from "@/components/students/profile/monthly-status-card";
import { PaymentHistorySection } from "@/components/payments/student-payment-history";
import { buildStudentCobrosOverview } from "@/lib/payments/student-cobros";
import { formatBillingPeriodLong } from "@/lib/payments/engine/features/payments/utils/paymentFormat";
import type { StudentBillingPlan } from "@/lib/payments/billing-plan";
import { VoidPaymentButton } from "@/components/payments/void-payment-button";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "@/lib/repositories/payments";
import { formatCivilDate, formatDateValue } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";

const CHARGE_TYPE_LABEL: Record<string, string> = {
  mensual: "Mensualidad",
  por_clase: "Clase suelta",
  entrenamiento: "Entrenamiento",
  semanal: "Semanal",
  quincenal: "Quincenal",
  paquete: "Paquete",
};

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", otro: "Otro" };

const ICON = "h-3.5 w-3.5";

/**
 * Pestaña real de Cobros del alumno — puerto de `CobrosTab.tsx` (móvil),
 * acotado a lo portado en esta fase: obligaciones vigentes/históricas
 * (con acción real "Registrar pago"/"Anular cobro" por cargo) y el
 * historial de pagos (con "Anular" por pago). Nunca muestra ni calcula
 * recargo — ver `lib/payments/due-stage.ts`.
 */
export function CobrosTabContent({
  studentId,
  studentName,
  billingPlan,
  charges,
  payments,
  allocations,
  chargeIncidents = {},
  todayDateKey,
}: {
  studentId: string;
  studentName: string;
  /** Plan de cobro vigente (resuelto: el explícito o el derivado del tipo de facturación legado). */
  billingPlan: StudentBillingPlan;
  charges: PaymentChargeRecord[];
  payments: PaymentRecord[];
  allocations: PaymentAllocationRecord[];
  /** Incidencias heredadas del traslado por cobro (opcional). */
  chargeIncidents?: Record<string, OriginIncidentView[]>;
  todayDateKey: string;
}) {
  const voidedAtByPaymentId = new Map(payments.map((p) => [p.id, p.voidedAt]));
  const paymentsById = new Map(payments.map((p) => [p.id, p]));
  const allocationsLike = allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount, paymentVoidedAt: voidedAtByPaymentId.get(a.paymentId) ?? null }));

  const overview = buildStudentCobrosOverview({ studentId, plan: billingPlan, charges, payments, allocations, todayDateKey });
  const declaredInitialIds = new Set(overview.declaredInitialPaymentIds);
  const currentMonth = overview.currentMonth;

  const sortedCharges = [...charges].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));
  const sortedPayments = [...payments].sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));

  return (
    <div className="flex flex-col gap-8">
      <BillingPlanCard studentId={studentId} studentName={studentName} plan={billingPlan} charges={charges} todayDateKey={todayDateKey} />
      {currentMonth && overview.suggested && (
        <MonthlyStatusCard
          studentId={studentId}
          monthLabel={formatBillingPeriodLong(currentMonth.billingPeriod)}
          status={currentMonth.label}
          amount={currentMonth.charge?.originalAmount ?? (billingPlan.type === "monthly" ? billingPlan.amount : null)}
          declaredInitial={declaredInitialIds.size > 0}
          canMarkPaid={currentMonth.label !== "pagado" && currentMonth.label !== "comienza_proximo_mes" && !overview.suggested.alreadySettled}
          suggestedAmount={overview.suggested.amount}
        />
      )}
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-section font-semibold">Obligaciones</h2>
          {sortedCharges.length > 0 && <p className="text-[14px] text-textMuted">{sortedCharges.length} registrada{sortedCharges.length === 1 ? "" : "s"}</p>}
        </div>
        {sortedCharges.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={BanknotesIcon} message="Todavía no hay cobros generados para este alumno." />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {sortedCharges.map((charge) => {
              const paidAmount = calculatePaidAmountForCharge(charge.id, allocationsLike);
              const balance = calculateChargeBalance(charge, paidAmount);
              const stage = determineDueStage(charge.chargeType, charge.dueDate, todayDateKey);
              const isOverdue = isChargeOverdueForDisplay(charge.chargeType, charge.dueDate, stage, todayDateKey);
              const excessLines = excessLinesForCharge(charge.id, allocations, voidedAtByPaymentId);
              const partial = !charge.voidedAt && !balance.isFullyPaid && paidAmount > 0 && charge.originalAmount > 0;
              return (
                <li
                  key={charge.id}
                  className={`rounded-lg border-[1.5px] p-4 nav:p-5 ${charge.voidedAt ? "border-dashed border-borderMid bg-background" : "border-border bg-surface shadow-card"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">
                        {CHARGE_TYPE_LABEL[charge.chargeType] ?? charge.chargeType}
                        {charge.trainingSeriesName ? ` · ${charge.trainingSeriesName}` : ""}
                      </p>
                      <p className="mt-0.5 text-[13.5px] text-textMuted">Vence {formatCivilDate(charge.dueDate)}</p>
                    </div>
                    {charge.voidedAt ? (
                      <Badge icon={<NoSymbolIcon className={ICON} aria-hidden />}>Anulado</Badge>
                    ) : balance.isFullyPaid ? (
                      <Badge tone="ok" icon={<CheckCircleIcon className={ICON} aria-hidden />}>
                        Pagado
                      </Badge>
                    ) : isOverdue ? (
                      <Badge tone="bad" icon={<ExclamationCircleIcon className={ICON} aria-hidden />}>
                        Vencido
                      </Badge>
                    ) : (
                      <Badge icon={<ClockIcon className={ICON} aria-hidden />}>Pendiente</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[14.5px] text-textSecondary">
                    <p>
                      <span className="font-display text-[26px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">{formatMoney(charge.originalAmount)}</span>{" "}
                      <span className="text-[13px] text-textMuted">importe original</span>
                    </p>
                    {paidAmount > 0 && (
                      <p>
                        Pagado: <span className="font-bold tf-num text-textPrimary">{formatMoney(paidAmount)}</span>
                      </p>
                    )}
                    {!charge.voidedAt && !balance.isFullyPaid && (
                      <p>
                        Pendiente: <span className="font-bold tf-num text-textPrimary">{formatMoney(balance.balance)}</span>
                      </p>
                    )}
                  </div>
                  {partial && (
                    <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-pill bg-paperDeep">
                      <div className="h-full rounded-pill bg-accent" style={{ width: `${Math.min(100, Math.round((paidAmount / charge.originalAmount) * 100))}%` }} />
                    </div>
                  )}
                  {charge.voidedAt && charge.voidReason && <p className="mt-2 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">Motivo: {charge.voidReason}</p>}
                  {excessLines.length > 0 && (
                    <div className="mt-3 rounded-md border border-border bg-background p-3 text-[14px] text-textSecondary" role="note">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={excessLines.every((l) => l.status === "recargo_confirmado") ? "info" : "warn"} icon={<QuestionMarkCircleIcon className={ICON} aria-hidden />}>
                          {excessLines.every((l) => l.status === "recargo_confirmado") ? EXCESS_STATUS_LABEL.recargo_confirmado : EXCESS_STATUS_LABEL.pendiente_de_clasificacion}
                        </Badge>
                        <span>
                          Se cobró <span className="font-bold tf-num text-textPrimary">{formatMoney(sumExcess(excessLines))}</span> por encima del importe base.
                        </span>
                      </p>
                      <p className="mt-1 [overflow-wrap:anywhere]">{excessExplanation(excessLines.some((l) => l.status === "pendiente_de_clasificacion") ? "pendiente_de_clasificacion" : "recargo_confirmado")}</p>
                      <ul className="mt-1 space-y-0.5 text-[13.5px] text-textMuted">
                        {excessLines.map((line) => {
                          const payment = paymentsById.get(line.paymentId);
                          return (
                            <li key={line.allocationId}>
                              {formatMoney(line.amount)} en el pago{payment ? " del " + formatDateValue(payment.paidAt) + " (" + (METHOD_LABEL[payment.method] ?? payment.method) + ")" : ""} · {EXCESS_STATUS_LABEL[line.status]}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <OriginIncidentNote incidents={chargeIncidents[charge.id] ?? []} />
                  {!charge.voidedAt && !balance.isFullyPaid && <ChargeActions
                      chargeId={charge.id}
                      studentId={studentId}
                      balance={balance.balance}
                      context={{
                        studentName,
                        concept: `${CHARGE_TYPE_LABEL[charge.chargeType] ?? charge.chargeType}${charge.trainingSeriesName ? ` · ${charge.trainingSeriesName}` : ""}`,
                        dueDate: charge.dueDate,
                        originalAmount: charge.originalAmount,
                      }}
                    />
                  }
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-section font-semibold">Pagos registrados</h2>
        {sortedPayments.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={BanknotesIcon} message="Todavía no hay pagos registrados." />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {sortedPayments.map((payment) => (
              <li
                key={payment.id}
                className={`flex items-center gap-3 rounded-lg border-[1.5px] border-border px-3.5 py-3 ${payment.voidedAt ? "bg-background" : "bg-surface shadow-card"}`}
              >
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-paperDeep text-textSecondary">
                  <BanknotesIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-textPrimary [overflow-wrap:anywhere]">
                    <span className="font-bold tf-num">{formatMoney(payment.amount)}</span> · {payment.source === "initial_student_setup" ? "Situación inicial declarada" : METHOD_LABEL[payment.method] ?? payment.method} · {formatDateValue(payment.paidAt)}
                  </p>
                  {excessLinesForPayment(payment.id, allocations, voidedAtByPaymentId).map((line) => (
                    <p key={line.allocationId} className="mt-0.5 text-[13.5px] text-textSecondary [overflow-wrap:anywhere]">
                      Incluye <span className="font-bold tf-num">{formatMoney(line.amount)}</span> por encima del importe base de una obligación · {EXCESS_STATUS_LABEL[line.status]}
                    </p>
                  ))}
                  {payment.source === "initial_student_setup" && <p className="mt-0.5 text-[13.5px] text-textSecondary">Situación inicial declarada al registrar al alumno.</p>}
                  {payment.notes && <p className="mt-0.5 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">{payment.notes}</p>}
                  {payment.voidedAt && payment.voidReason && <p className="mt-0.5 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">Anulado: {payment.voidReason}</p>}
                </div>
                {payment.voidedAt ? <Badge icon={<NoSymbolIcon className={ICON} aria-hidden />}>Anulado</Badge> : <VoidPaymentButton paymentId={payment.id} context={{ studentName, amount: payment.amount, method: METHOD_LABEL[payment.method] ?? payment.method, paidAt: payment.paidAt }} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PaymentHistorySection history={overview.history} evaluationDate={todayDateKey} />
    </div>
  );
}
