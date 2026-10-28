import { CheckIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { SavingsGoalForm } from "@/components/finance/savings-goal-form";
import { PROJECTION_WARNING_MESSAGES, type AnnualBudgetPlan, type MonthBudgetEntry, type MonthBudgetStatus } from "@/lib/payments/annual-budget-plan";
import type { SavingsGoal } from "@/lib/payments/budget-distribution";
import { computeSavingsGoalProgress } from "@/lib/payments/savings-goal";
import { formatMoney } from "@/lib/format/number-format";

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const STATUS_LABEL: Record<MonthBudgetStatus, string> = { real: "Dato real", current_month: "Mes en curso", projected: "Proyección" };

const CARD = "rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5";

/** Columnas apiladas Necesidades / Gustos / Ahorro por mes. Las proyectadas van más claras y con borde punteado: el estado nunca se comunica sólo con el color (también figura en la tabla de abajo). */
function AnnualChart({ plan, year }: { plan: AnnualBudgetPlan; year: string }) {
  const WIDTH = 600;
  const HEIGHT = 190;
  const PAD = { top: 8, bottom: 22, left: 4, right: 4 };
  const slot = (WIDTH - PAD.left - PAD.right) / 12;
  const barWidth = slot * 0.62;
  const max = Math.max(1, ...plan.months.map((month) => month.totalForDistribution));
  const scale = (HEIGHT - PAD.top - PAD.bottom) / max;
  const summary = plan.months.map((month) => `${MONTH_LONG[Number(month.billingPeriod.slice(5, 7)) - 1]}: ${STATUS_LABEL[month.status].toLowerCase()}, ${formatMoney(month.totalForDistribution)}`).join("; ");
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Distribución anual ${year}. ${summary}`} className="h-auto w-full">
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} className="stroke-borderMid" strokeWidth={1} />
      {plan.months.map((month, index) => {
        const x = PAD.left + index * slot + (slot - barWidth) / 2;
        const parts: { key: "needs" | "wants" | "savings"; value: number; className: string }[] = [
          { key: "needs", value: month.needs, className: "fill-dataNeeds" },
          { key: "wants", value: month.wants, className: "fill-pastelLavenderText" },
          { key: "savings", value: month.savings, className: "fill-pastelSageText" },
        ];
        let y = HEIGHT - PAD.bottom;
        const projected = month.status !== "real";
        return (
          <g key={month.billingPeriod} opacity={projected ? 0.5 : 1}>
            {parts.map((part) => {
              const height = part.value * scale;
              y -= height;
              if (height <= 0) return null;
              return <rect key={part.key} x={x} y={y} width={barWidth} height={height} className={part.className} stroke={projected ? "currentColor" : "none"} strokeDasharray={projected ? "3 2" : undefined} strokeWidth={projected ? 1 : 0} />;
            })}
            <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-textMuted" fontSize={11} fontWeight={650}>
              {MONTH_SHORT[index]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LegendItem({ swatch, label, dashed }: { swatch: string; label: string; dashed?: boolean }) {
  return (
    <li className="flex items-center gap-1.5 text-[13.5px] text-textSecondary">
      <span aria-hidden className={`h-3 w-3 rounded-[3px] ${swatch} ${dashed ? "border border-dashed border-textSecondary opacity-60" : ""}`} />
      {label}
    </li>
  );
}

function MonthRow({ month }: { month: MonthBudgetEntry }) {
  const name = `${MONTH_LONG[Number(month.billingPeriod.slice(5, 7)) - 1]} ${month.billingPeriod.slice(0, 4)}`;
  return (
    <Tr>
      <Td data-label="Mes" className="font-[650] capitalize">
        {name}
      </Td>
      <Td data-label="Estado">{STATUS_LABEL[month.status]}</Td>
      <Td data-label={month.status === "real" ? "Cobrado" : "Total estimado"} align="right" numeric>
        {month.status !== "real" && !month.estimateAvailable ? "Sin datos" : formatMoney(month.totalForDistribution)}
      </Td>
      <Td data-label="Necesidades" align="right" numeric>
        {formatMoney(month.needs)}
      </Td>
      <Td data-label="Gustos y gastos variables" align="right" numeric>
        {formatMoney(month.wants)}
      </Td>
      <Td data-label="Ahorro" align="right" numeric>
        {formatMoney(month.savings)}
      </Td>
      <Td data-label="Ahorro teórico acumulado" align="right" numeric>
        {formatMoney(month.cumulativeTheoreticalSavingsProjected)}
      </Td>
    </Tr>
  );
}

/**
 * «Proyección y ahorro» (pestaña del Resumen financiero de la app original): distribución 50/30/20 de los 12 meses del año elegido —meses cerrados con lo realmente cobrado, mes en curso con lo cobrado
 * hasta hoy y meses futuros con el promedio de hasta los últimos 3 meses completos— y el ahorro teórico acumulado real y estimado, siempre por separado. Es una guía orientativa sobre lo cobrado: no representa los
 * gastos ni el ahorro real. El objetivo de ahorro (opcional) muestra su progreso y una sugerencia que la profesora decide aplicar.
 */
export function AnnualProjection({ annual, savingsGoal, distributionSavingsPercent, preset }: { annual: { year: string; availableYears: string[]; plan: AnnualBudgetPlan; evaluationDate: string; monthlyCollected: number }; savingsGoal: SavingsGoal; distributionSavingsPercent: number; preset: string }) {
  const { plan, year, availableYears } = annual;
  const progress = computeSavingsGoalProgress({ goal: savingsGoal, cumulativeRealTheoreticalSavings: plan.cumulativeRealTheoreticalSavings, monthlyCollected: annual.monthlyCollected, evaluationDate: annual.evaluationDate });
  return (
    <section aria-labelledby="proyeccion-titulo" className={`${CARD} mt-5`}>
      <h2 id="proyeccion-titulo" className="font-display text-card font-semibold">
        Proyección y ahorro
      </h2>
      <p className="mt-1 text-[14px] text-textMuted">Proyección orientativa sobre lo cobrado; no representa tus gastos ni tu ahorro real.</p>

      <nav aria-label="Año de la proyección" className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {availableYears.map((option) => {
            const selected = option === year;
            return (
              <li key={option}>
                <PrivateLink
                  href={`/resumen-financiero?preset=${preset}&anio=${option}#proyeccion-titulo`}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`Ver año ${option}`}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"}`}
                >
                  {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                  {option}
                </PrivateLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-4">
        <AnnualChart plan={plan} year={year} />
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Leyenda">
          <LegendItem swatch="bg-dataNeeds" label="Necesidades" />
          <LegendItem swatch="bg-pastelLavenderText" label="Gustos" />
          <LegendItem swatch="bg-pastelSageText" label="Ahorro" />
          <LegendItem swatch="bg-textSecondary" label="Real" />
          <LegendItem swatch="bg-textSecondary" label="Estimado" dashed />
        </ul>
      </div>

      {plan.projectionWarning && <p role="status" className="mt-3 rounded-md border-[1.5px] border-infoLine bg-infoSoft px-3.5 py-2.5 text-[14px] text-textSecondary">{PROJECTION_WARNING_MESSAGES[plan.projectionWarning]}</p>}

      <dl className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        <div className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-3">
          <dt className="text-[13.5px] font-[650] text-textSecondary">Ahorro teórico acumulado con ingresos reales</dt>
          <dd className="mt-0.5 font-display text-[22px] font-semibold tf-num text-textPrimary">{formatMoney(plan.cumulativeRealTheoreticalSavings)}</dd>
        </div>
        <div className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-3">
          <dt className="text-[13.5px] font-[650] text-textSecondary">Ahorro estimado al completar 12 meses</dt>
          <dd className="mt-0.5 font-display text-[22px] font-semibold tf-num text-textPrimary">{formatMoney(plan.cumulativeProjectedTheoreticalSavings)}</dd>
        </div>
      </dl>

      <details className="mt-4 rounded-lg border-[1.5px] border-border">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[14.5px] font-[650] text-textPrimary">Ver detalle mes a mes</summary>
        <div className="px-2 pb-2">
        <Table stackable caption={`Distribución mensual ${year}`}>
          <thead>
            <tr>
              <Th>Mes</Th>
              <Th>Estado</Th>
              <Th align="right">Total</Th>
              <Th align="right">Necesidades</Th>
              <Th align="right">Gustos</Th>
              <Th align="right">Ahorro</Th>
              <Th align="right">Acumulado</Th>
            </tr>
          </thead>
          <tbody>
            {plan.months.map((month) => (
              <MonthRow key={month.billingPeriod} month={month} />
            ))}
          </tbody>
        </Table>
        </div>
      </details>

      <SavingsGoalForm key={`${savingsGoal.enabled}-${savingsGoal.targetAmount}-${savingsGoal.targetDate}`} goal={savingsGoal} cumulativeRealTheoreticalSavings={plan.cumulativeRealTheoreticalSavings} progress={progress} currentSavingsPercent={distributionSavingsPercent} />
    </section>
  );
}
