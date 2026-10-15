import type { BudgetDistribution } from "./budget-distribution.ts";

/**
 * «Distribución sugerida» (Resumen financiero): proyección ORIENTATIVA sobre el dinero efectivamente cobrado del período. Nunca
 * representa gastos ni ahorro reales. Puro y sin dependencias de Next/Supabase.
 */

export type BudgetCategory = "needs" | "wants" | "savings";
export const BUDGET_CATEGORIES: readonly BudgetCategory[] = ["needs", "wants", "savings"];

export interface BudgetShare {
  category: BudgetCategory;
  percent: number;
  /** Importe sugerido en pesos (con centavos exactos). */
  amount: number;
}

/**
 * Reparte `collected` según los porcentajes en CENTAVOS enteros con el método del resto mayor: los tres importes suman EXACTO el
 * total cobrado (nunca un centavo de más ni de menos por redondeo independiente). Sin cobros (o un total inválido, negativo o
 * no finito) devuelve $ 0 en cada categoría: nunca `NaN`.
 */
export function splitCollectedByPercent(collected: number, distribution: BudgetDistribution): BudgetShare[] {
  const totalCents = Number.isFinite(collected) && collected > 0 ? Math.round(collected * 100) : 0;
  const percents = BUDGET_CATEGORIES.map((category) => distribution[category]);
  const raw = percents.map((percent) => (totalCents * percent) / 100);
  const floors = raw.map((value) => Math.floor(value + 1e-9));
  let leftover = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value + 1e-9) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; leftover > 0 && order.length > 0; i = (i + 1) % order.length) {
    floors[order[i].index] += 1;
    leftover -= 1;
  }
  return BUDGET_CATEGORIES.map((category, index) => ({ category, percent: percents[index], amount: floors[index] / 100 }));
}

export type BudgetInputResult = { ok: true; distribution: BudgetDistribution } | { ok: false; error: string };

export const BUDGET_INPUT_ERROR = "Los tres porcentajes deben ser números enteros entre 0 y 100 y sumar exactamente 100. No se guardó nada.";

function readPercent(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{1,3}$/.test(text)) return null; // «», «-5», «12,5», «1e1», «NaN», «0x10»: todo rechazado
  const number = Number(text);
  return number >= 0 && number <= 100 ? number : null;
}

/**
 * Valida la edición de los tres porcentajes ANTES de tocar nada: los tres presentes, enteros, de 0 a 100 y con suma exacta 100.
 * Un valor parcial (falta alguno), inválido o con suma distinta se RECHAZA entero (no se «arregla» ni se guarda a medias).
 */
export function parseBudgetDistributionInput(raw: { needs: unknown; wants: unknown; savings: unknown }): BudgetInputResult {
  const needs = readPercent(raw.needs);
  const wants = readPercent(raw.wants);
  const savings = readPercent(raw.savings);
  if (needs === null || wants === null || savings === null || needs + wants + savings !== 100) return { ok: false, error: BUDGET_INPUT_ERROR };
  return { ok: true, distribution: { needs, wants, savings } };
}
