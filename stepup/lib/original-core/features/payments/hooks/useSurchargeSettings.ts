// Puerto VERBATIM del original (`src/features/payments/hooks/useSurchargeSettings.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useMemo, useReducer } from '../../../shims/react.ts';
import type { SurchargeSettings } from '../utils/surchargeSettings.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore, subscribeSurchargeSettings } from './surchargeSettingsStore.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): único punto
 * de lectura de `SurchargeSettings` para toda pantalla financiera —
 * "actualización inmediata en TODAS las pantallas" exige que cada
 * consumidor lea siempre este mismo hook (nunca una copia propia), mismo
 * patrón que `useTodayDateKey`/`subscribePayments`. Si la hidratación
 * todavía no terminó, devuelve `DEFAULT_SURCHARGE_SETTINGS` (= el
 * comportamiento vigente hasta ahora) en vez de bloquear el render — apenas
 * hidrata, el `subscribe` dispara un recálculo con el valor real.
 */
export function useSurchargeSettings(): SurchargeSettings {
  const [tick, notifyChanged] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    let active = true;
    hydrateSurchargeSettingsStore()
      .then(() => {
        if (active) notifyChanged();
      })
      .catch(() => {
        // Silencioso a propósito, igual que `useStudentPayments`: la
        // hidratación de recargos no bloquea ninguna pantalla — el default
        // migrado (comportamiento actual) sigue siendo válido mientras
        // tanto.
      });
    return subscribeSurchargeSettings(notifyChanged);
  }, []);

  return useMemo(() => getSurchargeSettingsSnapshot(), [tick]);
}
