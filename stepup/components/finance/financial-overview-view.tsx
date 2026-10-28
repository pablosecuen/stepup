import type { ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { CollectedEvolutionChart } from "@/components/finance/collected-evolution-chart";
import { BudgetSuggestion } from "@/components/finance/budget-suggestion";
import { AnnualProjection } from "@/components/finance/annual-projection";
import { ErrorState } from "@/components/ui/states";
import type { FinancialOverviewData } from "@/lib/dashboard/load-financial-overview";
import { FINANCIAL_PERIOD_PRESET_LABEL, type FinancialPeriodPreset } from "@/lib/reports/period";
import { formatCivilDate, formatCivilMonth, formatCivilMonthAbbrev, formatCivilMonthLongYear } from "@/lib/format/date-format";
import { formatCount, formatHours, formatMoney, formatPercent } from "@/lib/format/number-format";

export const FINANCIAL_PRESETS: FinancialPeriodPreset[] = ["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"];
// Lunes = 0 … domingo = 6 (como el motor de demanda).
const WEEKDAY_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const LEVEL_BUCKET_LABEL: Record<string, string> = { sin_nivel: "Sin nivel", nivel_mixto: "Nivel mixto" };
const MODALITY_LABEL: Record<string, string> = { online: "Online", presencial: "Presencial", mixta: "Mixta" };

/** Variación porcentual con signo, redondeada a entero (la comparación entre períodos no necesita decimales). */
function formatChange(value: number | null): string {
  return formatPercent(value === null ? null : Math.round(value), { signed: true });
}

function formatSlot(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Horas enteras para los totales (igual que la app: 345,5 → 346 h). */
function formatWholeHours(hours: number): string {
  return `${formatCount(Math.round(hours))} h`;
}

const CARD = "rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5";

function Kpi({ label, value, valueClass = "text-textPrimary", foot }: { label: string; value: string; valueClass?: string; foot?: ReactNode }) {
  return (
    <div className={`${CARD} [container-type:inline-size]`}>
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      {/* El importe se ajusta al ancho de SU tarjeta (nunca se parte un número en dos renglones): 36 px cuando hay lugar, menos cuando la tarjeta es angosta. */}
      <p className={`mt-1.5 font-display text-[clamp(18px,13cqw,36px)] font-medium leading-none tracking-tight tf-num [overflow-wrap:anywhere] ${valueClass}`}>{value}</p>
      {foot && <p className="mt-2 text-[13px] text-textMuted">{foot}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-3">
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      <p className="mt-1 font-display text-[30px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

/** Fila de una distribución: etiqueta, valor en texto y una barra proporcional (decorativa: el valor ya está escrito). */
function ShareRow({ label, value, percent }: { label: string; value: string; percent: number }) {
  const width = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14.5px]">
        <span className="text-textSecondary">{label}</span>
        <span className="font-bold tf-num text-textPrimary">{value}</span>
      </div>
      <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-pill bg-paperDeep">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-b-0 last:pb-0 first:pt-0 min-[480px]:flex-row min-[480px]:items-baseline min-[480px]:justify-between min-[480px]:gap-4">
      <dt className="text-[14px] text-textMuted">{label}</dt>
      <dd className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere] min-[480px]:text-right">{value}</dd>
    </div>
  );
}

/**
 * Resumen financiero (presentación). La página resuelve los datos del período; esta vista sólo los dibuja con los formateadores
 * únicos de dinero, porcentajes, horas y meses. Sólo montos agregados: nunca nombres de alumnos.
 */
export function FinancialOverviewView({ data, preset }: { data: FinancialOverviewData; preset: FinancialPeriodPreset }) {
  // Mes civil `AAAA-MM` de cada mes pico de altas (para escribirlo con el formateador único).
  const peakMonthKeys = data.newStudentsPerMonth.peakMonths.map((month) => `${data.newStudentsPerMonth.year}-${String(month).padStart(2, "0")}`);
  const chartFirst = data.collectedSeries[0]?.month;
  const chartLast = data.collectedSeries[data.collectedSeries.length - 1]?.month;
  const chartCaption =
    chartFirst && chartLast ? (chartFirst === chartLast ? `Cobrado en ${formatCivilMonthLongYear(chartFirst)}` : `Cobrado por mes, de ${formatCivilMonthLongYear(chartFirst)} a ${formatCivilMonthLongYear(chartLast)}`) : "Cobrado por mes";

  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader
        title="Resumen financiero"
        subtitle="Tus cobros, actividad y una guía para organizar lo ingresado."
        action={
          <PrivateButtonLink href="/resumen-financiero/comportamiento-de-pago" variant="secondary">
            Comportamiento de pago
          </PrivateButtonLink>
        }
      />
      <PaymentsSectionNav current="overview" />

      <nav aria-label="Período" className="mt-5">
        <ul className="flex flex-wrap gap-2">
          {FINANCIAL_PRESETS.map((p) => {
            const selected = p === preset;
            return (
              <li key={p}>
                <PrivateLink
                  href={`/resumen-financiero?preset=${p}`}
                  aria-current={selected ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${
                    selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
                  }`}
                >
                  {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                  {FINANCIAL_PERIOD_PRESET_LABEL[p]}
                </PrivateLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label="Cifras del período" className="mt-5 grid grid-cols-2 gap-3 max-[400px]:grid-cols-1 nav:grid-cols-4 nav:gap-4">
        <Kpi
          label="Facturación prevista"
          value={formatMoney(data.summary.generated)}
          foot={data.comparison ? <>vs. período anterior: {formatChange(data.comparison.generated.percentChange)}</> : undefined}
        />
        <Kpi
          label="Cobrado (por fecha real de pago)"
          value={formatMoney(data.summary.collected)}
          valueClass="text-accentDark"
          foot={data.comparison ? <>vs. período anterior: {formatChange(data.comparison.collected.percentChange)}</> : undefined}
        />
        <Kpi label="Pendiente en término" value={formatMoney(data.summary.pending)} />
        <Kpi label="Vencido" value={formatMoney(data.summary.overdue)} valueClass="text-bad" />
      </section>

      <section aria-label="Este mes" className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3 nav:mt-4 nav:gap-4">
        <Kpi label="Deuda de meses anteriores" value={formatMoney(data.monthSnapshot.priorPeriodsDebt)} valueClass={data.monthSnapshot.priorPeriodsDebt > 0 ? "text-bad" : "text-textPrimary"} />
        <Kpi label="Alumnos que pagaron este mes" value={formatCount(data.monthSnapshot.studentsPaidThisMonth)} />
        <Kpi label="Alumnos con deuda" value={formatCount(data.monthSnapshot.studentsWithDebt)} valueClass={data.monthSnapshot.studentsWithDebt > 0 ? "text-bad" : "text-textPrimary"} />
      </section>

      {/* Dos tarjetas lado a lado cuando entran (escritorio ancho) y en una columna en móvil. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <section aria-labelledby="evolucion-titulo" className={CARD}>
          <h2 id="evolucion-titulo" className="font-display text-card font-semibold">
            Evolución de cobros
          </h2>
          <div className="mt-3">
            <CollectedEvolutionChart series={data.collectedSeries} caption={chartCaption} />
          </div>
        </section>

        <section aria-labelledby="distribucion-titulo" className={CARD}>
          <h2 id="distribucion-titulo" className="font-display text-card font-semibold">
            Distribución sugerida
          </h2>
          <div className="mt-2">
            <BudgetSuggestion collected={data.summary.collected} distribution={data.budget} />
          </div>
        </section>
      </div>

      <AnnualProjection annual={data.annual} savingsGoal={data.savingsGoal} distributionSavingsPercent={data.budget.savings} preset={preset} />

      <section aria-labelledby="actividad-titulo" className={`${CARD} mt-5`}>
        <h2 id="actividad-titulo" className="font-display text-card font-semibold">
          Actividad del período
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 nav:grid-cols-4">
          <Stat label="Clases dictadas" value={data.activity.heldLessonCount} />
          <Stat label="Horas dictadas" value={formatWholeHours(data.activity.heldHours)} />
          <Stat label="Horas reprogramadas" value={formatWholeHours(data.activity.rescheduledHours)} />
          <Stat label="Horas canceladas" value={formatWholeHours(data.activity.cancelledHours)} />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 nav:grid-cols-2">
        <section aria-labelledby="hora-titulo" className={CARD}>
          <h2 id="hora-titulo" className="font-display text-card font-semibold">
            Valor programado de tu hora
          </h2>
          {data.hourlyRate.generalRatePerHour === null ? (
            <p className="mt-3 text-[15px] text-textMuted">Todavía no hay clases programadas en este período.</p>
          ) : (
            <>
              <p className="mt-3 font-display text-[36px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">
                {formatMoney(data.hourlyRate.generalRatePerHour)}
              </p>
              <p className="mt-2 text-[13.5px] text-textMuted">
                General{data.hourlyRate.isEstimate ? " (estimado: el período todavía no cerró)" : ""}. Calculado con {formatCount(Math.round(data.hourlyRate.totalProgrammedHours))} horas programadas y{" "}
                {formatCount(data.hourlyRate.lessonCount)} clase(s), del {formatCivilDate(data.range.rangeStart)} al {formatCivilDate(data.range.rangeEnd)}.
              </p>
              <h3 className="mt-4 text-[14px] font-[650] text-textMuted">Según nivel</h3>
              <dl className="mt-1">
                {data.hourlyRate.byLevel.map((entry) => (
                  <DetailRow key={entry.level} label={LEVEL_BUCKET_LABEL[entry.level] ?? (entry.level === "" ? "Sin nivel" : entry.level)} value={entry.ratePerHour !== null ? formatMoney(entry.ratePerHour) : "—"} />
                ))}
              </dl>
            </>
          )}
        </section>

        <section aria-labelledby="demanda-titulo" className={CARD}>
          <h2 id="demanda-titulo" className="font-display text-card font-semibold">
            Demanda semanal y horaria
          </h2>
          <p className="mt-1 text-[13px] text-textMuted">
            Últimos 90 días, del {formatCivilDate(data.demand.rangeStart)} al {formatCivilDate(data.demand.rangeEnd)}.
          </p>
          {data.demand.topWeekdays.length === 0 ? (
            <p className="mt-3 text-[15px] text-textMuted">Todavía no hay clases suficientes en los últimos 90 días.</p>
          ) : (
            <>
              <h3 className="mt-3 text-[14px] font-[650] text-textMuted">{data.demand.topWeekdays.length === 1 ? "Día más demandado" : "Días más demandados (empate)"}</h3>
              <ul className="mt-1 space-y-1">
                {data.demand.topWeekdays.map((entry) => (
                  <li key={entry.weekday} className="text-[15px] text-textPrimary">
                    <b className="font-[650]">{WEEKDAY_LABEL[entry.weekday]}</b> · {formatHours(entry.occupiedHours)} ocupadas · {formatCount(entry.lessonCount)} clase(s) · {formatPercent(Math.round(entry.percentOfWeeklyDemand))} de la demanda semanal
                  </li>
                ))}
              </ul>
              <h3 className="mt-4 text-[14px] font-[650] text-textMuted">{data.demand.topSlots.length > 3 ? "Horarios más demandados (con empates)" : "Horarios más demandados"}</h3>
              <ul className="mt-1 space-y-1">
                {data.demand.topSlots.map((slot) => (
                  <li key={`${slot.hour}-${slot.minute}`} className="text-[15px] text-textPrimary">
                    <b className="font-[650]">{formatSlot(slot.hour, slot.minute)}</b> · {formatCount(slot.lessonCount)} clase(s) · {formatHours(slot.occupiedHours)} ocupadas
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section aria-labelledby="anual-titulo" className={`${CARD} mt-5`}>
        <h2 id="anual-titulo" className="font-display text-card font-semibold">
          Resumen anual {data.year}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <Stat label="Horas dictadas" value={formatWholeHours(data.annualActivity.heldHours)} />
          <Stat label="Horas reprogramadas" value={formatWholeHours(data.annualActivity.rescheduledHours)} />
          <Stat label="Horas canceladas" value={formatWholeHours(data.annualActivity.cancelledHours)} />
        </div>
        <h3 className="mt-5 text-[14px] font-[650] text-textMuted">Modalidad más utilizada</h3>
        {data.modality.breakdown.every((entry) => entry.hours <= 0) ? (
          <p className="mt-2 text-[15px] text-textMuted">Todavía no hay clases dictadas este año.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-4 nav:grid-cols-3 nav:gap-6">
            {data.modality.breakdown.map((entry) => (
              <ShareRow
                key={entry.modality}
                label={`${MODALITY_LABEL[entry.modality]}${data.modality.mostUsed.includes(entry.modality) ? " · Más utilizada" : ""}`}
                value={`${formatPercent(Math.round(entry.percent))} · ${formatWholeHours(entry.hours)} · ${formatCount(entry.lessonCount)} clase(s)`}
                percent={entry.percent}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="alumnos-titulo" className={`${CARD} mt-5`}>
        <h2 id="alumnos-titulo" className="font-display text-card font-semibold">
          Alumnos del año — {data.studentYear.year}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <Stat label="Alumnos únicos atendidos" value={data.studentYear.uniqueStudentsAttended} />
          <Stat label="Activos actualmente" value={data.studentYear.activeStudentsNow} />
          <Stat label="Nuevos este año" value={data.studentYear.newStudentsThisYear} />
        </div>
        <h3 className="mt-5 text-[14px] font-[650] text-textMuted">Incorporación mensual</h3>
        <ol className="mt-2 grid grid-cols-6 gap-x-2 gap-y-3 min-[560px]:grid-cols-12">
          {data.newStudentsPerMonth.months.map((entry) => (
            <li key={entry.month} className="text-center">
              <p className={`font-display text-[20px] leading-none tf-num ${data.newStudentsPerMonth.peakMonths.includes(entry.month) ? "font-bold text-accentDark" : "font-semibold text-textPrimary"}`}>{entry.count}</p>
              <p className="mt-1 text-[12.5px] text-textMuted">{formatCivilMonthAbbrev(`${data.newStudentsPerMonth.year}-${String(entry.month).padStart(2, "0")}`)}</p>
            </li>
          ))}
        </ol>
        {data.newStudentsPerMonth.peakMonths.length > 0 && (
          <p className="mt-3 text-[13.5px] text-textMuted">
            Mes con más altas:{" "}
            <b className="font-[650] text-textSecondary">{peakMonthKeys.map((month) => formatCivilMonth(month)).join(", ")}</b>
          </p>
        )}
        <p className="mt-4 text-[13.5px] text-textMuted">
          Total del año: {data.newStudentsPerMonth.total} ·{" "}
          {data.newStudentsPerMonth.previousYearTotal === null ? "Sin comparación disponible con el año anterior." : `Año anterior: ${data.newStudentsPerMonth.previousYearTotal} alumno(s) nuevo(s).`}
        </p>
      </section>
    </div>
  );
}

/** Error al cargar el Resumen financiero: el mensaje de siempre y un reintento. */
export function FinancialOverviewErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Resumen financiero" />
      <PaymentsSectionNav current="overview" />
      <div className="mt-6 flex flex-col items-start gap-2">
        <div className="w-full">
          <ErrorState message="No pudimos cargar el resumen financiero." />
        </div>
        <PrivateLink href="/resumen-financiero" className={linkClass()}>
          Reintentar
        </PrivateLink>
      </div>
    </div>
  );
}
