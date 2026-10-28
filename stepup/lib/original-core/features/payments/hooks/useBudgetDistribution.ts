// Puerto VERBATIM del original (`src/features/payments/hooks/useBudgetDistribution.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useMemo, useReducer } from '../../../shims/react.ts';
import type { BudgetDistribution, SavingsGoal } from '../utils/budgetDistribution.ts';
import { adjustNeeds, adjustSavings, adjustWants, resetBudgetDistribution } from '../utils/budgetDistribution.ts';
import { applyBudgetDistributionMutation, getBudgetDistributionSnapshot, hydrateBudgetDistributionStore, subscribeBudgetDistribution } from './budgetDistributionStore.ts';

export interface UseBudgetDistributionResult {
  distribution: BudgetDistribution;
  savingsGoal: SavingsGoal;
  /**
   * Mueve "Necesidades" — la diferencia se reparte proporcionalmente entre
   * las otras dos. `anchorDistribution` opcional (ver comentario más abajo).
   * Devuelve una promesa (resuelta cuando la persistencia terminó, o
   * rechazada si falló) para que quien arrastra pueda esperar a que el
   * valor final quede realmente guardado antes de soltar su propio eco
   * visual local — ver `BudgetDistributionCard.tsx`.
   */
  setNeeds: (value: number, anchorDistribution?: BudgetDistribution) => Promise<void>;
  /** Mueve "Gustos" — "Ahorro" absorbe la diferencia. */
  setWants: (value: number, anchorDistribution?: BudgetDistribution) => Promise<void>;
  /** Mueve "Ahorro" — la diferencia se reparte en partes iguales entre las otras dos. */
  setSavings: (value: number, anchorDistribution?: BudgetDistribution) => Promise<void>;
  reset: () => void;
  setSavingsGoal: (goal: SavingsGoal) => void;
}

/**
 * Fase financiera — Plan de distribución 50/30/20: único punto de lectura Y
 * mutación de la preferencia — mismo patrón que `useSurchargeSettings`. Si
 * la hidratación todavía no terminó, devuelve el default (50/30/20,
 * objetivo desactivado) en vez de bloquear el render.
 */
export function useBudgetDistribution(): UseBudgetDistributionResult {
  const [tick, notifyChanged] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    let active = true;
    hydrateBudgetDistributionStore()
      .then(() => {
        if (active) notifyChanged();
      })
      .catch(() => {
        // Silencioso a propósito, igual que useSurchargeSettings: el default
        // migrado sigue siendo válido mientras tanto.
      });
    return subscribeBudgetDistribution(notifyChanged);
  }, []);

  const settings = useMemo(() => getBudgetDistributionSnapshot(), [tick]);

  // CORRECCIÓN (a pedido de Joaquín — planificador 50/30/20 desequilibrado):
  // el control dispara docenas de eventos por segundo durante UN solo
  // arrastre. Si cada evento recalcula el reparto proporcional tomando como
  // base la ÚLTIMA distribución ya redondeada (la de un evento anterior),
  // ese redondeo repetido en cadena puede "congelar" uno de los dos valores
  // no movidos durante todo el arrastre — confirmado con una simulación real
  // del arrastre continuo. `anchorDistribution` (opcional) permite que quien
  // llama (la tarjeta, al iniciar el gesto con `onSlidingStart`) fije la
  // distribución de referencia UNA sola vez por gesto: todos los eventos del
  // mismo arrastre reparten siempre desde esa misma base fija, nunca desde
  // el resultado —ya redondeado— del evento anterior. Sin `anchorDistribution`
  // (uso normal fuera de un arrastre, p. ej. el botón "Restablecer" o el de
  // sugerencia de `SavingsGoalControl`) se sigue usando la distribución
  // vigente, igual que antes.
  const setNeeds = useCallback(async (value: number, anchorDistribution?: BudgetDistribution) => {
    await applyBudgetDistributionMutation((current) => ({
      ...current,
      distribution: adjustNeeds(anchorDistribution ?? current.distribution, value),
    }));
  }, []);

  const setWants = useCallback(async (value: number, anchorDistribution?: BudgetDistribution) => {
    await applyBudgetDistributionMutation((current) => ({
      ...current,
      distribution: adjustWants(anchorDistribution ?? current.distribution, value),
    }));
  }, []);

  const setSavings = useCallback(async (value: number, anchorDistribution?: BudgetDistribution) => {
    await applyBudgetDistributionMutation((current) => ({
      ...current,
      distribution: adjustSavings(anchorDistribution ?? current.distribution, value),
    }));
  }, []);

  const reset = useCallback(() => {
    void applyBudgetDistributionMutation((current) => ({
      ...current,
      distribution: resetBudgetDistribution(),
    }));
  }, []);

  const setSavingsGoal = useCallback((goal: SavingsGoal) => {
    void applyBudgetDistributionMutation((current) => ({ ...current, savingsGoal: goal }));
  }, []);

  return {
    distribution: settings.distribution,
    savingsGoal: settings.savingsGoal,
    setNeeds,
    setWants,
    setSavings,
    reset,
    setSavingsGoal,
  };
}
