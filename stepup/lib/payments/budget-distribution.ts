/**
 * Plan de distribución 50/30/20 — puerto exacto de `budgetDistribution.ts`
 * (móvil, `src/features/payments/utils/budgetDistribution.ts`). Motor puro:
 * sin imports de Supabase/Next, testeable directo con `node --test`. Reparte
 * un total de 100 entre "Necesidades"/"Gustos"/"Ahorro" con el método del
 * resto mayor (`splitRemainingByWeight`/`normalizeBudgetDistribution`) —
 * nunca deja que la suma se desvíe de 100 por redondeo independiente de cada
 * valor. Lenguaje siempre orientativo en la UI que consuma esto
 * ("presupuesto sugerido") — nunca afirma gasto/ahorro bancario real.
 */

export interface BudgetDistribution {
  /** Porcentaje 0-100. */
  needs: number;
  /** Porcentaje 0-100. */
  wants: number;
  /** Porcentaje 0-100. */
  savings: number;
}

export const DEFAULT_BUDGET_DISTRIBUTION: BudgetDistribution = {
  needs: 50,
  wants: 30,
  savings: 20,
};

export interface SavingsGoal {
  enabled: boolean;
  targetAmount: number | null;
  /** Date key YYYY-MM-DD. */
  targetDate: string | null;
}

export const DEFAULT_SAVINGS_GOAL: SavingsGoal = {
  enabled: false,
  targetAmount: null,
  targetDate: null,
};

export interface BudgetDistributionSettings {
  distribution: BudgetDistribution;
  savingsGoal: SavingsGoal;
}

export const DEFAULT_BUDGET_DISTRIBUTION_SETTINGS: BudgetDistributionSettings = {
  distribution: DEFAULT_BUDGET_DISTRIBUTION,
  savingsGoal: DEFAULT_SAVINGS_GOAL,
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Reparte un total entero `remaining` (0..100) entre dos valores según sus
 * pesos reales, método del "resto mayor": el punto de redondeo sobrante se
 * asigna a quien tenga la mayor parte fraccionaria pendiente EN ESE momento,
 * nunca siempre al mismo lado — así los dos valores devueltos suman
 * `remaining` EXACTO, sin sesgo acumulable.
 */
function splitRemainingByWeight(remaining: number, weightA: number, weightB: number): [number, number] {
  if (remaining <= 0) return [0, 0];
  const weightTotal = weightA + weightB;
  const normalizedWeightA = weightTotal > 0 ? weightA / weightTotal : 0.5;
  const rawA = remaining * normalizedWeightA;
  const rawB = remaining - rawA;
  let a = Math.floor(rawA);
  let b = Math.floor(rawB);
  let leftover = remaining - (a + b);
  const fracA = rawA - a;
  const fracB = rawB - b;
  let favorA = fracA >= fracB;
  while (leftover > 0) {
    if (favorA) a += 1;
    else b += 1;
    favorA = !favorA;
    leftover -= 1;
  }
  return [a, b];
}

/** Mover "Necesidades": el resto se reparte proporcionalmente entre "Gustos" y "Ahorro" según su peso actual. */
export function adjustNeeds(current: BudgetDistribution, rawNewNeeds: number): BudgetDistribution {
  const newNeeds = clampPercentage(rawNewNeeds);
  const remaining = 100 - newNeeds;
  const [newWants, newSavings] = splitRemainingByWeight(remaining, current.wants, current.savings);
  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/** Mover "Gustos": "Necesidades" se mantiene fija y "Ahorro" absorbe la diferencia (salvo overflow, ver móvil). */
export function adjustWants(current: BudgetDistribution, rawNewWants: number): BudgetDistribution {
  const newWants = clampPercentage(rawNewWants);
  const newSavings = clampPercentage(100 - current.needs - newWants);
  const newNeeds = clampPercentage(100 - newWants - newSavings);
  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/** Mover "Ahorro": la diferencia se reparte en partes iguales entre "Necesidades" y "Gustos" (floor/ceil si es impar). */
export function adjustSavings(current: BudgetDistribution, rawNewSavings: number): BudgetDistribution {
  const newSavings = clampPercentage(rawNewSavings);
  const diff = newSavings - current.savings;
  const deltaNeeds = Math.floor(diff / 2);
  const deltaWants = diff - deltaNeeds;
  let newNeeds = current.needs - deltaNeeds;
  let newWants = current.wants - deltaWants;

  const needsOverflow = newNeeds < 0 ? -newNeeds : newNeeds > 100 ? newNeeds - 100 : 0;
  const wantsOverflow = newWants < 0 ? -newWants : newWants > 100 ? newWants - 100 : 0;

  newNeeds = clampPercentage(newNeeds);
  newWants = clampPercentage(newWants);

  if (needsOverflow > 0) {
    newWants = clampPercentage(newWants - needsOverflow * Math.sign(diff));
  }
  if (wantsOverflow > 0) {
    newNeeds = clampPercentage(newNeeds - wantsOverflow * Math.sign(diff));
  }

  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/**
 * Normaliza cualquier distribución persistida (suma≠100, decimales,
 * negativos, `NaN`) a una válida (enteros, cada uno en [0,100], suma exacta
 * 100), preservando proporciones relativas siempre que sea posible (mismo
 * método del resto mayor, simétrico entre los 3 valores). Si el total es
 * ≤0 (irrecuperable), cae al 50/30/20 por defecto. Idempotente: normalizar
 * un resultado ya válido devuelve el mismo resultado.
 */
export function normalizeBudgetDistribution(distribution: BudgetDistribution): BudgetDistribution {
  const sanitize = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const needs = sanitize(distribution.needs);
  const wants = sanitize(distribution.wants);
  const savings = sanitize(distribution.savings);
  const total = needs + wants + savings;
  if (total <= 0) return { ...DEFAULT_BUDGET_DISTRIBUTION };

  const rawNeeds = (needs / total) * 100;
  const rawWants = (wants / total) * 100;
  const rawSavings = (savings / total) * 100;
  const flNeeds = Math.floor(rawNeeds);
  const flWants = Math.floor(rawWants);
  const flSavings = Math.floor(rawSavings);

  const order: Array<{ key: keyof BudgetDistribution; frac: number }> = [
    { key: "needs" as const, frac: rawNeeds - flNeeds },
    { key: "wants" as const, frac: rawWants - flWants },
    { key: "savings" as const, frac: rawSavings - flSavings },
  ].sort((a, b) => b.frac - a.frac);

  const result: BudgetDistribution = { needs: flNeeds, wants: flWants, savings: flSavings };
  let leftover = 100 - (flNeeds + flWants + flSavings);
  let i = 0;
  while (leftover > 0) {
    result[order[i % order.length].key] += 1;
    leftover -= 1;
    i += 1;
  }

  return {
    needs: clampPercentage(result.needs),
    wants: clampPercentage(result.wants),
    savings: clampPercentage(result.savings),
  };
}

export function resetBudgetDistribution(): BudgetDistribution {
  return { ...DEFAULT_BUDGET_DISTRIBUTION };
}
