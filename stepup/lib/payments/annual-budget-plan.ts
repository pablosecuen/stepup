// Puerto VERBATIM de `annualBudgetProjection.ts` (app original, features/payments/utils): plan anual de 12 meses (real / mes actual / proyectado) y ahorro teórico acumulado.
// Pura. La lógica no cambió; sólo los imports. Pruebas originales portadas en `__tests__/annual-budget-plan.test.ts`.
import { applyBudgetDistribution, type BudgetDistribution } from "./budget-distribution.ts";
import { billingPeriodOfDateKey, nextBillingPeriod } from "./dates.ts";

export type MonthBudgetStatus = 'real' | 'current_month' | 'projected';

export interface MonthBudgetEntry {
  /** 'YYYY-MM'. */
  billingPeriod: string;
  status: MonthBudgetStatus;
  /** Dinero REALMENTE cobrado hasta el momento de evaluación para este mes (0 en meses futuros; parcial en el mes actual). */
  realAmount: number;
  /**
   * Importe usado para calcular la distribución de este mes: igual a
   * `realAmount` en meses 'real'; en 'current_month' es el mayor entre
   * `realAmount` y la proyección (nunca por debajo de lo ya cobrado); en
   * 'projected' es la proyección sola (0 si no hay historial suficiente).
   */
  totalForDistribution: number;
  /** `false` únicamente cuando este mes necesitaba una proyección y no hay ningún mes histórico real para calcularla. */
  estimateAvailable: boolean;
  needs: number;
  wants: number;
  savings: number;
  /** Ahorro teórico acumulado hasta este mes INCLUSIVE, usando sólo dinero REAL (0 de aporte en meses proyectados y en la extensión estimada del mes actual). */
  cumulativeTheoreticalSavingsReal: number;
  /** Ahorro teórico acumulado hasta este mes INCLUSIVE, usando `totalForDistribution` (mezcla real + proyectado). */
  cumulativeTheoreticalSavingsProjected: number;
}

export type ProjectionWarning = 'no_history' | 'limited_history' | null;

export interface AnnualBudgetPlan {
  months: MonthBudgetEntry[];
  /** "Ahorro teórico acumulado con ingresos reales" — nunca mezclado con el estimado. */
  cumulativeRealTheoreticalSavings: number;
  /** "Ahorro estimado al completar 12 meses" — nunca mezclado con el real. */
  cumulativeProjectedTheoreticalSavings: number;
  projectionWarning: ProjectionWarning;
}

const MAX_HISTORY_MONTHS = 3;

/**
 * Los últimos hasta 3 períodos ESTRICTAMENTE anteriores a `currentPeriod`
 * con un valor real presente en `monthlyCollectedByPeriod` (0 cobrado es un
 * dato real válido — sólo un período AUSENTE del mapa cuenta como "sin
 * datos", nunca inventado). Orden: el más reciente primero, para que
 * "hasta los últimos tres" tome siempre los más cercanos a hoy.
 */
function collectHistoricalRealAmounts(
  currentPeriod: string,
  monthlyCollectedByPeriod: Record<string, number>
): number[] {
  const amounts: number[] = [];
  let cursor = currentPeriod;
  // Recorre hacia atrás mes a mes — nunca asume que los períodos disponibles
  // en el mapa son consecutivos ni que empiezan justo antes de currentPeriod.
  for (let i = 0; i < 240 && amounts.length < MAX_HISTORY_MONTHS; i++) {
    cursor = previousBillingPeriod(cursor);
    if (cursor in monthlyCollectedByPeriod) {
      amounts.push(monthlyCollectedByPeriod[cursor]);
    }
  }
  return amounts;
}

function previousBillingPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) - 1;
  const prevYear = Math.floor(totalMonths / 12);
  const prevMonth = (totalMonths % 12) + 1;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Fase financiera — Plan de distribución 50/30/20, gráfico de 12 meses:
 * clasifica cada mes del año seleccionado en real/actual/proyectado y
 * calcula su distribución 50/30/20 y el ahorro teórico acumulado, real y
 * proyectado por separado (nunca sumados bajo una cifra ambigua).
 *
 * Reglas de proyección (verbatim del pedido):
 * - Meses completos transcurridos: cobros reales, tal cual.
 * - Mes actual: lo cobrado realmente + una extensión estimada, nunca por
 *   debajo de lo ya cobrado.
 * - Meses futuros: promedio de hasta los últimos 3 meses completos con
 *   datos reales (ANTERIORES al mes actual real, sin importar el año
 *   seleccionado en el gráfico).
 * - 1 o 2 meses de historial: se usan igual, con advertencia de historial
 *   limitado. 0 meses: nunca se inventa un número — advertencia explícita.
 *
 * Pura — `monthlyCollectedByPeriod` debe incluir tanto los períodos del año
 * mostrado como los períodos históricos anteriores a `evaluationDate`
 * necesarios para promediar (responsabilidad del llamador, ver
 * `useAnnualBudgetPlan.ts`).
 */
export function buildAnnualBudgetPlan(input: {
  year: string; // 'YYYY'
  evaluationDate: string; // date key YYYY-MM-DD, Buenos Aires
  distribution: BudgetDistribution;
  monthlyCollectedByPeriod: Record<string, number>;
}): AnnualBudgetPlan {
  const { year, evaluationDate, distribution, monthlyCollectedByPeriod } = input;
  const currentPeriod = billingPeriodOfDateKey(evaluationDate);

  const historicalAmounts = collectHistoricalRealAmounts(currentPeriod, monthlyCollectedByPeriod);
  const projectedMonthlyTotal = average(historicalAmounts);
  const hasAnyHistory = historicalAmounts.length > 0;
  const hasFullHistory = historicalAmounts.length >= MAX_HISTORY_MONTHS;

  const periods: string[] = [];
  let period = `${year}-01`;
  for (let i = 0; i < 12; i++) {
    periods.push(period);
    period = nextBillingPeriod(period);
  }

  let cumulativeReal = 0;
  let cumulativeProjected = 0;
  let neededEstimateAtLeastOnce = false;
  let anyEstimateUnavailable = false;

  const months: MonthBudgetEntry[] = periods.map((billingPeriod) => {
    const realAmount = monthlyCollectedByPeriod[billingPeriod] ?? 0;
    let status: MonthBudgetStatus;
    let totalForDistribution: number;
    let estimateAvailable = true;

    if (billingPeriod < currentPeriod) {
      status = 'real';
      totalForDistribution = realAmount;
    } else if (billingPeriod === currentPeriod) {
      status = 'current_month';
      neededEstimateAtLeastOnce = true;
      if (!hasAnyHistory) {
        estimateAvailable = false;
        anyEstimateUnavailable = true;
        totalForDistribution = realAmount;
      } else {
        totalForDistribution = Math.max(realAmount, projectedMonthlyTotal);
      }
    } else {
      status = 'projected';
      neededEstimateAtLeastOnce = true;
      if (!hasAnyHistory) {
        estimateAvailable = false;
        anyEstimateUnavailable = true;
        totalForDistribution = 0;
      } else {
        totalForDistribution = projectedMonthlyTotal;
      }
    }

    const amounts = applyBudgetDistribution(totalForDistribution, distribution);
    const realAmounts = applyBudgetDistribution(realAmount, distribution);

    cumulativeReal += status === 'projected' ? 0 : realAmounts.savings;
    cumulativeProjected += amounts.savings;

    return {
      billingPeriod,
      status,
      realAmount,
      totalForDistribution,
      estimateAvailable,
      needs: amounts.needs,
      wants: amounts.wants,
      savings: amounts.savings,
      cumulativeTheoreticalSavingsReal: cumulativeReal,
      cumulativeTheoreticalSavingsProjected: cumulativeProjected,
    };
  });

  let projectionWarning: ProjectionWarning = null;
  if (neededEstimateAtLeastOnce) {
    if (anyEstimateUnavailable) projectionWarning = 'no_history';
    else if (!hasFullHistory) projectionWarning = 'limited_history';
  }

  return {
    months,
    cumulativeRealTheoreticalSavings: cumulativeReal,
    cumulativeProjectedTheoreticalSavings: cumulativeProjected,
    projectionWarning,
  };
}

export const PROJECTION_WARNING_MESSAGES: Record<Exclude<ProjectionWarning, null>, string> = {
  no_history: 'Todavía no hay datos suficientes para proyectar.',
  limited_history: 'Proyección con historial limitado.',
};
