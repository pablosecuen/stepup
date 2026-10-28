// Puerto VERBATIM del original (`src/features/payments/utils/budgetDistribution.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Fase financiera — Plan de distribución 50/30/20 (a pedido de Joaquín):
 * motor puro que reparte el dinero REALMENTE cobrado en tres categorías —
 * "Necesidades", "Gustos y gastos variables" y "Ahorro" — con tres barras
 * ajustables que SIEMPRE suman exactamente 100%. Nunca conoce gastos ni
 * ahorro bancario real de la profesora: es una guía orientativa, nunca una
 * afirmación de lo que "gastó" o "ahorró" de verdad — ver los textos reales
 * en `BudgetDistributionSection.tsx` ("presupuesto sugerido"/"distribución
 * teórica"/"ahorro teórico").
 */

export interface BudgetDistribution {
  /** Porcentaje 0–100. */
  needs: number;
  /** Porcentaje 0–100. */
  wants: number;
  /** Porcentaje 0–100. */
  savings: number;
}

export const DEFAULT_BUDGET_DISTRIBUTION: BudgetDistribution = {
  needs: 50,
  wants: 30,
  savings: 20,
};

/**
 * Objetivo de ahorro OPCIONAL (desactivado por defecto) — nunca modifica
 * las barras 50/30/20 por su cuenta; sólo se usa para mostrar progreso y
 * sugerencias, siempre con confirmación explícita de la profesora para
 * aplicar cualquier cambio a la distribución.
 */
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
 * CORRECCIÓN (a pedido de Joaquín — planificador 50/30/20 desequilibrado):
 * causa raíz real del desbalanceo visible al arrastrar: cada control nativo
 * dispara `onValueChange` muchas veces por segundo durante UN solo arrastre
 * (no sólo al soltar), y la versión anterior redondeaba los otros dos
 * valores CADA UNO por separado (`Math.round` independiente) y después
 * "parchaba" el residuo de ese redondeo siempre sobre el mismo de los dos
 * valores no movidos (el mayor). Repetido decenas de veces en un solo
 * arrastre, ese sesgo sistemático se acumulaba y el valor favorecido crecía
 * muy por encima de lo que le correspondía proporcionalmente, mientras el
 * otro quedaba prácticamente congelado — el desequilibrio visible en video.
 *
 * `splitRemainingByWeight` es la función canónica única de equilibrio:
 * reparte un total entero `remaining` (0..100) entre dos valores según sus
 * pesos reales (que suman 1) con el método del "resto mayor" — el punto de
 * redondeo sobrante se asigna a quien tenga la mayor parte fraccionaria
 * pendiente EN ESE momento, nunca siempre al mismo lado — así los dos
 * valores devueltos suman `remaining` EXACTO, sin parches posteriores ni
 * sesgo acumulable.
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

/**
 * Mover "Necesidades": la diferencia se reparte PROPORCIONALMENTE entre
 * "Gustos" y "Ahorro" según su peso actual — si ambos están en cero, se
 * reparte por igual. Exacto por construcción: wants+savings = remaining
 * siempre, nunca necesita un parche de redondeo posterior.
 */
export function adjustNeeds(current: BudgetDistribution, rawNewNeeds: number): BudgetDistribution {
  const newNeeds = clampPercentage(rawNewNeeds);
  const remaining = 100 - newNeeds;
  const [newWants, newSavings] = splitRemainingByWeight(remaining, current.wants, current.savings);
  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/**
 * Mover "Gustos": "Necesidades" se mantiene fija y "Ahorro" absorbe toda la
 * diferencia — sin redondeo intermedio (son enteros desde el origen), salvo
 * en el caso límite en que Necesidades + Gustos ya no entran en 100: ahí
 * Gustos sigue respetando el valor pedido, Ahorro nunca queda fuera de
 * [0, 100], y es Necesidades (la fija) la que cede lo estrictamente
 * necesario para que la suma siga siendo exactamente 100.
 */
export function adjustWants(current: BudgetDistribution, rawNewWants: number): BudgetDistribution {
  const newWants = clampPercentage(rawNewWants);
  const newSavings = clampPercentage(100 - current.needs - newWants);
  const newNeeds = clampPercentage(100 - newWants - newSavings);
  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/**
 * Mover "Ahorro": la diferencia se reparte en partes IGUALES entre
 * "Necesidades" y "Gustos" (repartida exacta con `floor`/`ceil` cuando la
 * diferencia es impar, nunca con redondeo independiente de cada lado) — si
 * uno de los dos toca su límite (0 o 100), el remanente se traslada íntegro
 * al otro.
 */
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

  // El remanente que "Necesidades" no pudo absorber (por tocar su límite)
  // se traslada íntegro a "Gustos", y viceversa.
  if (needsOverflow > 0) {
    newWants = clampPercentage(newWants - needsOverflow * Math.sign(diff));
  }
  if (wantsOverflow > 0) {
    newNeeds = clampPercentage(newNeeds - wantsOverflow * Math.sign(diff));
  }

  return { needs: newNeeds, wants: newWants, savings: newSavings };
}

/**
 * CORRECCIÓN (a pedido de Joaquín — planificador 50/30/20 desequilibrado):
 * normaliza cualquier distribución persistida — incluida una histórica
 * inválida (suma distinta de 100, decimales, negativos, `NaN`) — a una
 * distribución válida (enteros, cada uno en [0, 100], suma exacta 100),
 * preservando las proporciones relativas originales siempre que sea
 * posible (método del resto mayor, misma función canónica de equilibrio).
 * Nunca borra la configuración original en el almacenamiento — sólo corrige
 * el valor EN USO — y si es totalmente irrecuperable (los tres en 0,
 * negativos o `NaN`) cae al 50/30/20 por defecto, nunca deja un estado
 * imposible en pantalla. Operación IDEMPOTENTE: normalizar un resultado ya
 * válido devuelve exactamente el mismo resultado.
 */
export function normalizeBudgetDistribution(distribution: BudgetDistribution): BudgetDistribution {
  const sanitize = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const needs = sanitize(distribution.needs);
  const wants = sanitize(distribution.wants);
  const savings = sanitize(distribution.savings);
  const total = needs + wants + savings;
  if (total <= 0) return { ...DEFAULT_BUDGET_DISTRIBUTION };

  // Método del resto mayor simétrico entre los tres valores — cada uno se
  // trunca a su parte entera y el/los puntos de redondeo sobrantes (0, 1 o
  // 2, nunca más) se asignan a quien tenga la mayor parte fraccionaria
  // pendiente, sin favorecer siempre al mismo de los tres.
  const rawNeeds = (needs / total) * 100;
  const rawWants = (wants / total) * 100;
  const rawSavings = (savings / total) * 100;
  const flNeeds = Math.floor(rawNeeds);
  const flWants = Math.floor(rawWants);
  const flSavings = Math.floor(rawSavings);

  const order: Array<{ key: keyof BudgetDistribution; frac: number }> = [
    { key: 'needs' as const, frac: rawNeeds - flNeeds },
    { key: 'wants' as const, frac: rawWants - flWants },
    { key: 'savings' as const, frac: rawSavings - flSavings },
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

export interface BudgetDistributionAmounts {
  needs: number;
  wants: number;
  savings: number;
}

/**
 * Convierte la distribución (porcentajes) en importes reales sobre el
 * dinero REALMENTE cobrado — nunca sobre facturación generada ni saldo
 * pendiente. Corrige el residuo de redondeo en centavos sobre "Ahorro"
 * (el último renglón, igual criterio que la corrección de porcentajes) para
 * que los tres importes sumen EXACTO el total recibido, nunca $0.01 de más
 * o de menos por redondeo independiente de cada fila.
 */
export function applyBudgetDistribution(
  collectedAmount: number,
  distribution: BudgetDistribution
): BudgetDistributionAmounts {
  if (collectedAmount <= 0) return { needs: 0, wants: 0, savings: 0 };
  const needs = Math.round((collectedAmount * distribution.needs) / 100);
  const wants = Math.round((collectedAmount * distribution.wants) / 100);
  const savings = Math.round(collectedAmount) - needs - wants;
  return { needs, wants, savings };
}
