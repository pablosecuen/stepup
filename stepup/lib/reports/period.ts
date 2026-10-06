import { billingPeriodOfDateKey, daysBetweenDateKeys, firstDayOfBillingPeriod, lastDateKeyOfBillingPeriod, addDaysToDateKey } from "../payments/dates.ts";

/**
 * Puerto exacto de `periodFinancialSummary.ts::FinancialPeriodPreset`
 * (móvil) — SÓLO estos 5 presets existen realmente para el selector de
 * período de Analíticas financieras. El móvil NO tiene un "selector de año
 * libre" para este selector (ese es un componente distinto, para el
 * Resumen anual/proyección — fuera del alcance real de esta pantalla).
 */
export type FinancialPeriodPreset = "current_month" | "last_3_months" | "last_6_months" | "current_year" | "previous_year";

export const FINANCIAL_PERIOD_PRESET_LABEL: Record<FinancialPeriodPreset, string> = {
  current_month: "Mes actual",
  last_3_months: "Últimos 3 meses",
  last_6_months: "Últimos 6 meses",
  current_year: "Año actual",
  previous_year: "Año anterior",
};

export interface DateRange {
  rangeStart: string;
  rangeEnd: string;
}

function billingPeriodMonths(from: string) {
  const [year, month] = from.split("-").map(Number);
  return { year, month };
}

/** Período 'YYYY-MM' que está `count` meses ANTES de `billingPeriod` — cruza diciembre→enero correctamente. */
function shiftBillingPeriodBack(billingPeriod: string, count: number): string {
  const { year, month } = billingPeriodMonths(billingPeriod);
  const totalMonths = year * 12 + (month - 1) - count;
  const shiftedYear = Math.floor(totalMonths / 12);
  const shiftedMonth = (((totalMonths % 12) + 12) % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

/** Puerto exacto de `resolveFinancialPeriodRange` (móvil) — misma fórmula por preset. */
export function resolveFinancialPeriodRange(preset: FinancialPeriodPreset, evaluationDate: string): DateRange {
  const currentPeriod = billingPeriodOfDateKey(evaluationDate);
  const currentYear = Number(currentPeriod.slice(0, 4));

  switch (preset) {
    case "current_month":
      return { rangeStart: firstDayOfBillingPeriod(currentPeriod), rangeEnd: lastDateKeyOfBillingPeriod(currentPeriod) };
    case "last_3_months":
      return { rangeStart: firstDayOfBillingPeriod(shiftBillingPeriodBack(currentPeriod, 2)), rangeEnd: lastDateKeyOfBillingPeriod(currentPeriod) };
    case "last_6_months":
      return { rangeStart: firstDayOfBillingPeriod(shiftBillingPeriodBack(currentPeriod, 5)), rangeEnd: lastDateKeyOfBillingPeriod(currentPeriod) };
    case "current_year":
      return { rangeStart: `${currentYear}-01-01`, rangeEnd: `${currentYear}-12-31` };
    case "previous_year":
      return { rangeStart: `${currentYear - 1}-01-01`, rangeEnd: `${currentYear - 1}-12-31` };
  }
}

export function dateKeyInRange(dateKey: string, rangeStart: string, rangeEnd: string): boolean {
  return dateKey >= rangeStart && dateKey <= rangeEnd;
}

export interface PeriodComparison {
  current: number;
  previous: number;
  percentChange: number | null;
}

/** Puerto exacto de `comparePeriodValues` (móvil) — nunca divide por cero. */
export function comparePeriodValues(current: number, previous: number): PeriodComparison {
  if (previous === 0) return { current, previous, percentChange: null };
  const percentChange = ((current - previous) / previous) * 100;
  return { current, previous, percentChange: Number.isFinite(percentChange) ? percentChange : null };
}

/**
 * El "período anterior" para comparación — un rango de la MISMA DURACIÓN
 * (en días), inmediatamente anterior al rango dado. Nunca "el mes
 * calendario anterior" a secas (puerto exacto de `previousComparableRange`).
 */
export function previousComparableRange(range: DateRange): DateRange {
  const spanDays = daysBetweenDateKeys(range.rangeStart, range.rangeEnd);
  const previousEnd = addDaysToDateKey(range.rangeStart, -1);
  const previousStart = addDaysToDateKey(previousEnd, -spanDays);
  return { rangeStart: previousStart, rangeEnd: previousEnd };
}
