import { Notice } from "@/components/ui/notice";
import { formatCivilDate } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import { REGISTRATION_CHARGE_STATE_LABEL, type RegistrationChargeState } from "@/lib/payments/registration-charge-status";

export interface RegistrationChargeLine {
  studentName: string;
  total: number;
  paid: number;
  balance: number;
  state: RegistrationChargeState;
  payments: { paidAt: string; amount: number }[];
}

/**
 * Situación REAL del cobro de ESTA clase (pagada, parcial o pendiente) con los pagos asignados a ese cobro — nunca los de otra clase, serie o entrenamiento.
 * Una sesión de entrenamiento cubierta por la cuota mensual de su serie lo dice y no muestra cobro por clase.
 */
export function RegistrationChargeCard({ lines, coveredByTrainingPlan }: { lines: RegistrationChargeLine[]; coveredByTrainingPlan: boolean }) {
  if (coveredByTrainingPlan) {
    return (
      <Notice tone="info" title="Cubierta por la cuota mensual del entrenamiento">
        Esta sesión es parte del entrenamiento y se cobra con su cuota mensual: no genera un cobro por clase. Tus clases individuales siguen cobrándose aparte.
      </Notice>
    );
  }
  if (lines.length === 0) return null;
  return (
    <section aria-label="Cobro de esta clase" className="rounded-lg border-[1.5px] border-border bg-surface2 p-4">
      <h2 className="font-display text-card font-semibold">Cobro de esta clase</h2>
      <ul className="mt-2 flex flex-col gap-2.5">
        {lines.map((line) => (
          <li key={line.studentName} className="text-[15px] text-textSecondary">
            <p className="[overflow-wrap:anywhere]">
              <strong className="text-textPrimary">{line.studentName}</strong> · {formatMoney(line.total)} ·{" "}
              <strong className="text-textPrimary">{REGISTRATION_CHARGE_STATE_LABEL[line.state]}</strong>
              {line.state === "parcial" ? ` (pagó ${formatMoney(line.paid)}, falta ${formatMoney(line.balance)})` : ""}
            </p>
            {line.payments.length > 0 && (
              <ul className="mt-0.5 text-[13.5px] text-textMuted">
                {line.payments.map((payment, index) => (
                  <li key={`${payment.paidAt}-${index}`}>
                    Pago del {formatCivilDate(payment.paidAt)}: {formatMoney(payment.amount)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
