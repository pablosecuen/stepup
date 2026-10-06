import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadFinancialOverviewData } from "@/lib/dashboard/load-financial-overview";
import { FINANCIAL_PERIOD_PRESET_LABEL, type FinancialPeriodPreset } from "@/lib/reports/period";
import { ErrorState } from "@/components/ui/states";
import { formatCivilMonth } from "@/lib/format/date-format";
import { formatMinutesAsHours, formatMoney, formatPercent } from "@/lib/format/number-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resumen financiero · TeacherFlow" };

const PRESETS: FinancialPeriodPreset[] = ["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"];
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

export default async function ResumenFinancieroPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const { preset: rawPreset } = await searchParams;
  const preset: FinancialPeriodPreset = PRESETS.includes(rawPreset as FinancialPeriodPreset) ? (rawPreset as FinancialPeriodPreset) : "current_month";

  let data: Awaited<ReturnType<typeof loadFinancialOverviewData>>;
  try {
    const ctx = await requireAuthenticatedDbContext();
    data = await loadFinancialOverviewData(ctx, preset);
  } catch {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar el resumen financiero." />
        <Link href="/resumen-financiero" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  const cancelledTotal =
    data.activity.cancelledCountByReason.conAviso + data.activity.cancelledCountByReason.tardia + data.activity.cancelledCountByReason.profesoraAusente + data.activity.cancelledCountByReason.feriado;
  const topWeekdaysLabel = data.demand.topWeekdays.length > 0 ? data.demand.topWeekdays.map((w) => WEEKDAY_LABEL[w]).join(", ") : "Sin datos suficientes";
  const topSlotsLabel =
    data.demand.topSlots.length > 0 ? data.demand.topSlots.map((s) => `${WEEKDAY_LABEL[s.weekday]} ${formatMinuteOfDay(s.slotStartMinuteOfDay)}`).join(", ") : "Sin datos suficientes";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/inicio" className="text-sm font-semibold text-brandBlue hover:underline">
        ← Volver a Inicio
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Resumen financiero</h1>
      <p className="mt-1.5 text-sm text-textMuted">Sólo montos agregados — nunca nombres de alumnos ni información pedagógica.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Link
            key={p}
            href={`/resumen-financiero?preset=${p}`}
            className={`rounded-pill border px-3 py-1.5 text-xs font-semibold transition-colors ${
              p === preset ? "border-brandBlue bg-brandBlue text-white" : "border-border bg-surface text-textSecondary hover:border-brandBlue/30"
            }`}
          >
            {FINANCIAL_PERIOD_PRESET_LABEL[p]}
          </Link>
        ))}
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-xs text-textMuted">Facturación prevista</p>
          <p className="mt-1 text-xl font-bold text-textPrimary">{formatMoney(data.summary.generated)}</p>
          {data.comparison && <p className="mt-1 text-xs text-textMuted">vs. período anterior: {formatChange(data.comparison.generated.percentChange)}</p>}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-xs text-textMuted">Cobrado (por fecha real de pago)</p>
          <p className="mt-1 text-xl font-bold text-brandBlue">{formatMoney(data.summary.collected)}</p>
          {data.comparison && <p className="mt-1 text-xs text-textMuted">vs. período anterior: {formatChange(data.comparison.collected.percentChange)}</p>}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-xs text-textMuted">Pendiente en término</p>
          <p className="mt-1 text-xl font-bold text-statusPendiente">{formatMoney(data.summary.pending)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-xs text-textMuted">Vencido</p>
          <p className="mt-1 text-xl font-bold text-statusRojo">{formatMoney(data.summary.overdue)}</p>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Actividad del período</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-textMuted">Clases dictadas</p>
            <p className="font-semibold text-textPrimary">{data.activity.heldClassesCount}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Horas dictadas</p>
            <p className="font-semibold text-textPrimary">{formatMinutesAsHours(data.activity.heldMinutes)}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Canceladas</p>
            <p className="font-semibold text-textPrimary">{cancelledTotal}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Reprogramadas</p>
            <p className="font-semibold text-textPrimary">{data.activity.rescheduledReservationsCount}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-textMuted">Presencial</p>
            <p className="font-semibold text-textPrimary">{formatMinutesAsHours(data.modality.presencial)}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Online</p>
            <p className="font-semibold text-textPrimary">{formatMinutesAsHours(data.modality.online)}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Mixta</p>
            <p className="font-semibold text-textPrimary">{formatMinutesAsHours(data.modality.mixta)}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Valor programado de la hora</h2>
        <p className="mt-1 text-xl font-bold text-textPrimary">{data.hourlyRate.generalRatePerHour !== null ? formatMoney(data.hourlyRate.generalRatePerHour) : "Sin datos suficientes"}</p>
        {data.hourlyRate.isEstimate && data.hourlyRate.generalRatePerHour !== null && (
          <p className="mt-1 text-xs text-textMuted">Estimado — todavía hay clases del período sin registrar o el período no cerró.</p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Demanda (últimos 90 días)</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-textMuted">Día más demandado</p>
            <p className="font-semibold text-textPrimary">{topWeekdaysLabel}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Horario más demandado</p>
            <p className="font-semibold text-textPrimary">{topSlotsLabel}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Alumnos — {data.studentYear.year}</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-textMuted">Alumnos únicos atendidos</p>
            <p className="font-semibold text-textPrimary">{data.studentYear.uniqueStudentsAttended}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Alumnos activos</p>
            <p className="font-semibold text-textPrimary">{data.studentYear.activeStudentsNow}</p>
          </div>
          <div>
            <p className="text-xs text-textMuted">Nuevos este año</p>
            <p className="font-semibold text-textPrimary">{data.studentYear.newStudentsThisYear}</p>
          </div>
        </div>
        {data.newStudentsPerMonth.peakMonths.length > 0 && (
          <p className="mt-3 text-xs text-textMuted">
            Mes con más altas: {data.newStudentsPerMonth.peakMonths.map((month) => formatCivilMonth(month)).join(", ")}
            {data.newStudentsPerMonth.previousYearTotal !== null ? ` · año anterior: ${data.newStudentsPerMonth.previousYearTotal} altas totales` : ""}
          </p>
        )}
      </section>
    </div>
  );
}
