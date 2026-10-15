import { toDateKey } from "../payments/dates.ts";
import type { DateRange } from "./period.ts";

/**
 * «Evolución de cobros»: dinero EFECTIVAMENTE cobrado por mes. Mismo criterio de caja que «Cobrado» del Resumen financiero
 * (`buildPeriodFinancialSummary`): sólo asignaciones de pagos NO anulados sobre cargos NO anulados, agrupadas por el día REAL
 * de pago (`paidAt`, nunca `recordedAt`) en la zona de Argentina. Nunca usa facturación prevista, pendiente ni vencida, ni datos
 * sintéticos. Pura: recibe lo que la pantalla ya cargó (sin consultas por elemento).
 */
export interface MonthlyCollectedInput {
  charges: readonly { id: string; voidedAt: string | null }[];
  allocations: readonly { chargeId: string; paymentId: string; amount: number }[];
  payments: readonly { id: string; paidAt: string; voidedAt: string | null }[];
}

export interface MonthlyCollectedPoint {
  /** Mes civil `YYYY-MM`. */
  month: string;
  /** Importe cobrado en el mes (con centavos exactos, nunca un flotante a medias). */
  amount: number;
}

/** Suma en centavos enteros para que la suma de meses coincida EXACTO con el total del período. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Cobrado por mes (`YYYY-MM` → centavos), sólo de los meses pedidos. */
export function collectedCentsByMonth(input: MonthlyCollectedInput, months: readonly string[]): Map<string, number> {
  const wanted = new Set(months);
  const activeChargeIds = new Set(input.charges.filter((charge) => charge.voidedAt === null).map((charge) => charge.id));
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const byMonth = new Map<string, number>(months.map((month) => [month, 0]));
  for (const allocation of input.allocations) {
    if (!activeChargeIds.has(allocation.chargeId)) continue;
    const payment = paymentById.get(allocation.paymentId);
    if (!payment || payment.voidedAt !== null) continue;
    const month = toDateKey(payment.paidAt).slice(0, 7);
    if (!wanted.has(month)) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + toCents(allocation.amount));
  }
  return byMonth;
}

export function buildMonthlyCollectedSeries(input: MonthlyCollectedInput, months: readonly string[]): MonthlyCollectedPoint[] {
  const cents = collectedCentsByMonth(input, months);
  return months.map((month) => ({ month, amount: (cents.get(month) ?? 0) / 100 }));
}

/** `YYYY-MM` siguiente (cruza diciembre → enero). */
function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

/** Todos los meses entre dos meses civiles (inclusive), en orden cronológico. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let month = first; month <= last && out.length < 240; month = nextMonth(month)) out.push(month);
  return out;
}

/** Meses CONTEXTO mínimos que muestra el gráfico aunque el período sea de un solo mes («Mes actual»). */
export const MIN_CHART_MONTHS = 6;

/**
 * Meses del gráfico para un período: los del propio rango (cronológicos), sin meses futuros (no hay nada cobrado todavía: nunca
 * se dibuja una barra ficticia) y, si el período es más corto que `MIN_CHART_MONTHS`, completado hacia atrás hasta ese mínimo
 * (el «Mes actual» muestra los últimos 6 meses para que el gráfico tenga sentido; 3 y 6 meses muestran exactamente su rango).
 */
export function chartMonthsForRange(range: DateRange, evaluationDate: string, preset: string): string[] {
  const firstMonth = range.rangeStart.slice(0, 7);
  const lastRangeMonth = range.rangeEnd.slice(0, 7);
  const currentMonth = evaluationDate.slice(0, 7);
  const last = lastRangeMonth > currentMonth ? currentMonth : lastRangeMonth;
  if (last < firstMonth) return [];
  let first = firstMonth;
  if (preset === "current_month") {
    first = last;
    for (let i = 1; i < MIN_CHART_MONTHS; i++) first = previousMonth(first);
  }
  return monthsBetween(first, last);
}

/** Total de una serie (centavos exactos → importe). */
export function sumSeries(series: readonly MonthlyCollectedPoint[]): number {
  return series.reduce((sum, point) => sum + toCents(point.amount), 0) / 100;
}
