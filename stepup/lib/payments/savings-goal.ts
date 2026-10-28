import { parseMoneyInput } from "../format/money-input.ts";
import type { SavingsGoal } from "./budget-distribution.ts";

/**
 * Objetivo de ahorro OPCIONAL del Resumen financiero (puerto de `SavingsGoalControl.tsx` de la app original). Nunca modifica las barras 50/30/20 por su cuenta: sólo muestra progreso y una
 * sugerencia, y la profesora decide si la aplica. «Ahorro teórico» es una guía sobre lo cobrado, no el ahorro real de nadie. Puro (sin React ni Supabase).
 */

/** Meses entre dos fechas civiles (por mes calendario, nunca menos de 1): el divisor de la reserva mensual. */
export function monthsBetweenDateKeys(fromDateKey: string, toDateKey: string): number {
  const [fromYear, fromMonth] = fromDateKey.slice(0, 7).split("-").map(Number);
  const [toYear, toMonth] = toDateKey.slice(0, 7).split("-").map(Number);
  return Math.max(1, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

export interface SavingsGoalProgress {
  /** Hay monto (> 0) y fecha: recién ahí se puede mostrar progreso. */
  complete: boolean;
  progressPercent: number;
  /** Lo que falta dividido en los meses que quedan. */
  monthlyReserveNeeded: number;
  /** Porcentaje del cobrado mensual que cubriría esa reserva (0 si todavía no hay cobros este mes). */
  suggestedSavingsPercent: number;
}

/** Misma matemática que el original: redondeos a entero y topes de 0 a 100. */
export function computeSavingsGoalProgress(input: { goal: SavingsGoal; cumulativeRealTheoreticalSavings: number; monthlyCollected: number; evaluationDate: string }): SavingsGoalProgress {
  const { goal, cumulativeRealTheoreticalSavings, monthlyCollected, evaluationDate } = input;
  if (goal.targetAmount === null || !(goal.targetAmount > 0) || goal.targetDate === null) {
    return { complete: false, progressPercent: 0, monthlyReserveNeeded: 0, suggestedSavingsPercent: 0 };
  }
  const progressPercent = Math.max(0, Math.min(100, Math.round((cumulativeRealTheoreticalSavings / goal.targetAmount) * 100)));
  const remaining = Math.max(0, goal.targetAmount - cumulativeRealTheoreticalSavings);
  const monthlyReserveNeeded = Math.round(remaining / monthsBetweenDateKeys(evaluationDate, goal.targetDate));
  const suggestedSavingsPercent = monthlyCollected > 0 ? Math.max(0, Math.min(100, Math.round((monthlyReserveNeeded / monthlyCollected) * 100))) : 0;
  return { complete: true, progressPercent, monthlyReserveNeeded, suggestedSavingsPercent };
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Lo que la profesora cargó en el formulario, ya validado: el objetivo puede guardarse INCOMPLETO (activado sin monto o sin fecha: «Completá el monto y la fecha para ver el progreso»), como en el
 * original; lo que se escribe tiene que ser válido (importe con interpretación estricta y mayor a 0; fecha real y no anterior a hoy).
 */
export function parseSavingsGoalInput(raw: { enabled: unknown; targetAmount: unknown; targetDate: unknown }, today: string): { ok: true; goal: SavingsGoal } | { ok: false; error: string } {
  const enabled = raw.enabled === "on" || raw.enabled === "true" || raw.enabled === true;
  const amountText = typeof raw.targetAmount === "string" ? raw.targetAmount.trim() : "";
  const dateText = typeof raw.targetDate === "string" ? raw.targetDate.trim() : "";
  let targetAmount: number | null = null;
  if (amountText !== "") {
    const parsed = parseMoneyInput(amountText);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (!(parsed.amount > 0)) return { ok: false, error: "El monto objetivo tiene que ser mayor a 0." };
    targetAmount = parsed.amount;
  }
  let targetDate: string | null = null;
  if (dateText !== "") {
    if (!isRealDateKey(dateText)) return { ok: false, error: "La fecha objetivo no es válida." };
    if (dateText < today) return { ok: false, error: "La fecha objetivo no puede ser anterior a hoy." };
    targetDate = dateText;
  }
  return { ok: true, goal: { enabled, targetAmount, targetDate } };
}
