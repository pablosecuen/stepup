/**
 * Puerto exacto de `firstMonthProration.ts::computeProportionalAmount`
 * (móvil, `FIRST_MONTH_PRORATION_RULE_VERSION = 2`) — escalón fijo por
 * CANTIDAD de ocurrencias reales restantes, nunca una fracción continua:
 *   0 restantes -> $0
 *   1 restante  -> cuotaMensual / classesPerFullPeriod (valor de una clase)
 *   2 restantes -> 50% de la cuota mensual
 *   3+ restantes -> cuota mensual completa
 * Reutilizada TAL CUAL tanto por la mensualidad de clases como por la cuota
 * de entrenamiento (caso real portado en esta fase: commit móvil `2ae2994`).
 * `Math.max(classesPerFullPeriod, 1)` es sólo defensivo (nunca divide por
 * cero).
 */
export const FIRST_MONTH_PRORATION_RULE_VERSION = 2;

export function computeProportionalAmount(
  monthlyAmount: number,
  classesRemaining: number,
  classesPerFullPeriod: number,
): number {
  if (classesRemaining <= 0) return 0;
  if (classesRemaining === 1) return Math.round(monthlyAmount / Math.max(classesPerFullPeriod, 1));
  if (classesRemaining === 2) return Math.round(monthlyAmount * 0.5);
  return monthlyAmount;
}

export type FirstMonthProrationCriterion = "proportional" | "full" | "custom" | "no_charge";

export interface FirstMonthProrationSuggestion {
  billingPeriod: string;
  effectiveJoinDate: string;
  classesRemaining: number;
  classesPerFullPeriod: number;
  permanentMonthlyAmount: number;
  proportionalAmount: number;
}

/** Traduce el criterio elegido al importe final a cargar. `'custom'` exige un importe entero positivo. */
export function resolveFirstMonthChargeAmount(
  suggestion: FirstMonthProrationSuggestion,
  criterion: FirstMonthProrationCriterion,
  customAmount?: number,
): number {
  switch (criterion) {
    case "proportional":
      return suggestion.proportionalAmount;
    case "full":
      return suggestion.permanentMonthlyAmount;
    case "custom":
      if (!Number.isFinite(customAmount) || (customAmount as number) <= 0) {
        throw new RangeError("El importe personalizado debe ser un número positivo.");
      }
      return Math.round(customAmount as number);
    case "no_charge":
      return 0;
    default:
      throw new Error("Criterio de primer mes desconocido.");
  }
}
