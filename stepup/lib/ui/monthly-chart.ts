import type { MonthlyCollectedPoint } from "../reports/monthly-collected.ts";

/** Presentación en centavos de la misma serie cobrada: nunca mezcla facturación, deuda ni proyecciones. */
export function monthlyChartModel(series: readonly MonthlyCollectedPoint[]) {
  const points = series.map(point => ({ ...point, cents: Number.isFinite(point.amount) && point.amount > 0 ? Math.round(point.amount * 100) : 0 }));
  const totalCents = points.reduce((sum, point) => sum + point.cents, 0);
  const peakCents = Math.max(0, ...points.map(point => point.cents));
  let used = 0;
  return {
    total: totalCents / 100,
    segments: points.map(point => {
      const percent = totalCents > 0 ? point.cents / totalCents * 100 : 0;
      const offset = 25 - used;
      used += percent;
      return { ...point, percent, offset, isPeak: peakCents > 0 && point.cents === peakCents };
    }),
  };
}
