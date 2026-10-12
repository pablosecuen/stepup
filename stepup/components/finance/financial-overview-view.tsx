import type { ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { linkClass } from "@/components/ui/button";
import { BackLink, PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/states";
import type { FinancialOverviewData } from "@/lib/dashboard/load-financial-overview";
import { FINANCIAL_PERIOD_PRESET_LABEL, type FinancialPeriodPreset } from "@/lib/reports/period";
import { formatCivilMonth } from "@/lib/format/date-format";
import { formatMinutesAsHours, formatMoney, formatPercent } from "@/lib/format/number-format";

export const FINANCIAL_PRESETS: FinancialPeriodPreset[] = ["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"];
const WEEKDAY_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Variación porcentual con signo, redondeada a entero (la comparación entre períodos no necesita decimales). */
function formatChange(value: number | null): string {
  return formatPercent(value === null ? null : Math.round(value), { signed: true });
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const CARD = "rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5";

function Kpi({ label, value, valueClass = "text-textPrimary", foot }: { label: string; value: string; valueClass?: string; foot?: ReactNode }) {
  return (
    <div className={CARD}>
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      <p className={`mt-1.5 font-display text-[30px] font-medium leading-none tracking-tight tf-num [overflow-wrap:anywhere] nav:text-[36px] ${valueClass}`}>{value}</p>
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
function ShareRow({ label, minutes, max }: { label: string; minutes: number; max: number }) {
  const width = max > 0 ? Math.max(0, Math.min(100, Math.round((minutes / max) * 100))) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14.5px]">
        <span className="text-textSecondary">{label}</span>
        <span className="font-bold tf-num text-textPrimary">{formatMinutesAsHours(minutes)}</span>
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
  const cancelledTotal =
    data.activity.cancelledCountByReason.conAviso + data.activity.cancelledCountByReason.tardia + data.activity.cancelledCountByReason.profesoraAusente + data.activity.cancelledCountByReason.feriado;
  const topWeekdaysLabel = data.demand.topWeekdays.length > 0 ? data.demand.topWeekdays.map((w) => WEEKDAY_LABEL[w]).join(", ") : "Sin datos suficientes";
  const topSlotsLabel =
    data.demand.topSlots.length > 0 ? data.demand.topSlots.map((s) => `${WEEKDAY_LABEL[s.weekday]} ${formatMinuteOfDay(s.slotStartMinuteOfDay)}`).join(", ") : "Sin datos suficientes";
  const maxModalityMinutes = Math.max(data.modality.presencial, data.modality.online, data.modality.mixta);

  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/inicio">Volver a Inicio</BackLink>
      <div className="mt-3">
        <PageHeader title="Resumen financiero" subtitle="Sólo montos agregados — nunca nombres de alumnos ni información pedagógica." />
      </div>

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

      <section className={`${CARD} mt-5`}>
        <h2 className="font-display text-card font-semibold">Actividad del período</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 nav:grid-cols-4">
          <Stat label="Clases dictadas" value={data.activity.heldClassesCount} />
          <Stat label="Horas dictadas" value={formatMinutesAsHours(data.activity.heldMinutes)} />
          <Stat label="Canceladas" value={cancelledTotal} />
          <Stat label="Reprogramadas" value={data.activity.rescheduledReservationsCount} />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 nav:grid-cols-3 nav:gap-6">
          <ShareRow label="Presencial" minutes={data.modality.presencial} max={maxModalityMinutes} />
          <ShareRow label="Online" minutes={data.modality.online} max={maxModalityMinutes} />
          <ShareRow label="Mixta" minutes={data.modality.mixta} max={maxModalityMinutes} />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 nav:grid-cols-2">
        <section className={CARD}>
          <h2 className="font-display text-card font-semibold">Valor programado de la hora</h2>
          <p className="mt-3 font-display text-[36px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">
            {data.hourlyRate.generalRatePerHour !== null ? formatMoney(data.hourlyRate.generalRatePerHour) : "Sin datos suficientes"}
          </p>
          {data.hourlyRate.isEstimate && data.hourlyRate.generalRatePerHour !== null && (
            <p className="mt-2.5 text-[13.5px] text-textMuted">Estimado — todavía hay clases del período sin registrar o el período no cerró.</p>
          )}
        </section>

        <section className={CARD}>
          <h2 className="font-display text-card font-semibold">Demanda (últimos 90 días)</h2>
          <dl className="mt-3">
            <DetailRow label="Día más demandado" value={topWeekdaysLabel} />
            <DetailRow label="Horario más demandado" value={topSlotsLabel} />
          </dl>
        </section>
      </div>

      <section className={`${CARD} mt-5`}>
        <h2 className="font-display text-card font-semibold">Alumnos — {data.studentYear.year}</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <Stat label="Alumnos únicos atendidos" value={data.studentYear.uniqueStudentsAttended} />
          <Stat label="Alumnos activos" value={data.studentYear.activeStudentsNow} />
          <Stat label="Nuevos este año" value={data.studentYear.newStudentsThisYear} />
        </div>
        {data.newStudentsPerMonth.peakMonths.length > 0 && (
          <p className="mt-4 text-[13.5px] text-textMuted">
            Mes con más altas:{" "}
            <b className="font-[650] text-textSecondary">
              {data.newStudentsPerMonth.peakMonths.map((month) => formatCivilMonth(month)).join(", ")}
            </b>
            {data.newStudentsPerMonth.previousYearTotal !== null ? ` · año anterior: ${data.newStudentsPerMonth.previousYearTotal} altas totales` : ""}
          </p>
        )}
      </section>
    </div>
  );
}

/** Error al cargar el Resumen financiero: el mensaje de siempre y un reintento. */
export function FinancialOverviewErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/inicio">Volver a Inicio</BackLink>
      <div className="mt-3">
        <PageHeader title="Resumen financiero" />
      </div>
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
