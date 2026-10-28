import { CalendarDaysIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format/number-format";
import { formatBillingPeriodShort } from "@/lib/payments/engine/features/payments/utils/paymentFormat";
import { MONTH_CATEGORY_LABEL, SCORE_CATEGORY_LABEL } from "@/lib/payments/student-cobros";
import type { StudentPaymentHistory } from "@/lib/payments/engine/features/payments/utils/studentPaymentHistory";
import type { StudentMonthlyPaymentCategory } from "@/lib/payments/engine/features/payments/utils/paymentStats";

const MONTH_CHIP_CLASS: Record<StudentMonthlyPaymentCategory, string> = {
  en_termino: "bg-statusVerde",
  primer_vencimiento: "bg-statusAmarillo",
  segundo_vencimiento: "bg-statusNaranja",
  ultimo_vencimiento: "bg-statusRojo",
  mantiene_deuda: "bg-statusRojo",
};

const LEGEND: Array<{ chip: string; label: string }> = [
  { chip: "bg-statusVerde", label: "En término" },
  { chip: "bg-statusAmarillo", label: "1er vencimiento" },
  { chip: "bg-statusNaranja", label: "2do vencimiento" },
  { chip: "bg-statusRojo", label: "Último venc. o deuda (con «!»)" },
  { chip: "bg-border", label: "Sin obligaciones" },
];

function formatDMY(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function Tile({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-md border-[1.5px] border-border bg-background px-3.5 py-3">
      <p className={`font-display text-[22px] font-semibold leading-tight tf-num [overflow-wrap:anywhere] ${emphasize ? "text-bad" : "text-textPrimary"}`}>{value}</p>
      <p className="mt-0.5 text-[13px] text-textMuted">{label}</p>
    </div>
  );
}

/**
 * «Historial de pagos» de UN alumno (puerto de `PaymentHistorySection`, móvil): evolución de los últimos 12 meses, puntaje y categoría (siempre en texto), aviso explícito de historial insuficiente,
 * obligaciones en término / fuera de término, deuda actual y racha de meses con deuda. Los datos son sólo de ese alumno y salen del motor del original. Cada mes con deuda vigente lleva además un
 * «!» visible: «saldada tarde» y «deuda sin saldar» comparten el color rojo, así que el color solo no alcanza para distinguirlas.
 */
export function PaymentHistorySection({ history, evaluationDate }: { history: StudentPaymentHistory; evaluationDate: string }) {
  const insufficient = history.scoring.category === "historial_insuficiente";
  const hasMonthData = history.months.some((month) => month.category !== null);

  return (
    <section aria-labelledby="payment-history-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="payment-history-title" className="font-display text-section font-semibold">
          Historial de pagos
        </h2>
        <p className="text-[13.5px] text-textMuted">Actualizado al {formatDMY(evaluationDate)}</p>
      </div>
      <Card className="mt-3 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-pill border-[1.5px] border-borderStrong bg-surface px-3 py-1 text-[14px] font-bold text-textPrimary">
            {insufficient && <ExclamationTriangleIcon className="h-4 w-4 text-textMuted" aria-hidden />}
            Categoría: {SCORE_CATEGORY_LABEL[history.scoring.category]}
            {history.scoring.score !== null && <span className="font-semibold text-textSecondary tf-num">{Math.round(history.scoring.score)}/100</span>}
          </span>
        </div>
        {insufficient && <p className="text-[14px] text-textSecondary">Todavía no hay al menos 3 obligaciones resueltas para calcular un puntaje confiable. Se necesitan más meses de historial.</p>}

        <div>
          <h3 className="text-[14.5px] font-bold text-textPrimary">Evolución mensual (últimos 12 meses)</h3>
          {!hasMonthData ? (
            <p className="mt-2 flex items-center gap-2 rounded-md bg-background p-3 text-[14px] text-textSecondary">
              <CalendarDaysIcon className="h-5 w-5 shrink-0 text-textMuted" aria-hidden />
              Todavía no hay obligaciones registradas en los últimos 12 meses.
            </p>
          ) : (
            <>
              <ul className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Estado de pago mes por mes">
                {history.months.map((month) => {
                  const shortLabel = formatBillingPeriodShort(month.period);
                  const description = month.category
                    ? `${shortLabel}: ${MONTH_CATEGORY_LABEL[month.category]}. Facturado ${formatMoney(month.totalDue)}, pagado ${formatMoney(month.totalPaid)}.`
                    : `${shortLabel}: sin obligaciones ese mes`;
                  return (
                    <li key={month.period} className="flex w-11 shrink-0 flex-col items-center gap-1" aria-label={description}>
                      <span
                        title={description}
                        className={`flex h-7 w-7 items-center justify-center rounded-md text-[14px] font-extrabold text-white ${month.category ? MONTH_CHIP_CLASS[month.category] : "bg-border"}`}
                      >
                        {month.category === "mantiene_deuda" ? "!" : ""}
                      </span>
                      <span className="text-[11px] font-semibold text-textSecondary">{shortLabel}</span>
                    </li>
                  );
                })}
              </ul>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-textSecondary">
                {LEGEND.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${item.chip}`} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Deuda actual" value={formatMoney(history.currentDebt)} emphasize={history.currentDebt > 0} />
          <Tile label="Racha de meses con deuda" value={history.monthlyDebtStreak > 0 ? `${history.monthlyDebtStreak} ${history.monthlyDebtStreak === 1 ? "mes" : "meses"}` : "Sin racha"} emphasize={history.monthlyDebtStreak > 0} />
          <Tile label="Pagos en término" value={String(history.onTimeCount)} />
          <Tile label="Pagos fuera de término" value={String(history.lateCount)} emphasize={history.lateCount > 0} />
        </div>
      </Card>
    </section>
  );
}
