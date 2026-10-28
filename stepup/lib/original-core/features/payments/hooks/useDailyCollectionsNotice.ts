// Puerto VERBATIM del original (`src/features/payments/hooks/useDailyCollectionsNotice.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useState } from '../../../shims/react.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { summarizeCollectionsUrgency, type CollectionsUrgencySummary } from '../utils/collectionsCenter.ts';
import { buildDismissedNoticeState, shouldShowDailyCollectionsNotice, type DailyCollectionsNoticeState } from '../utils/dailyCollectionsNotice.ts';
import { loadDailyCollectionsNoticeState, saveDailyCollectionsNoticeState } from './dailyCollectionsNoticeStore.ts';
import { useCollectionsCenter } from './useCollectionsCenter.ts';

export interface UseDailyCollectionsNoticeResult {
  visible: boolean;
  summary: CollectionsUrgencySummary;
  /** "Recordarme mañana": oculta el aviso por hoy, salvo que después empeore. */
  dismissForToday: () => void;
}

/**
 * Aviso diario de cobros del Home (Fase Pagos 4C.3): reutiliza el mismo
 * Centro de cobros (`useCollectionsCenter`) y el motor financiero existente
 * — nunca recalcula nada por su cuenta. La decisión de mostrarse (toda la
 * lógica de "primera apertura", "descartado hoy", "reapareció al día
 * siguiente", "empeoró") vive en `shouldShowDailyCollectionsNotice`, pura y
 * ya probada; este hook sólo la conecta con el reloj real y con
 * AsyncStorage. Usa la fecha de Buenos Aires. Nunca persiste estadísticas
 * financieras: sólo la marca mínima de descarte.
 */
export function useDailyCollectionsNotice(): UseDailyCollectionsNoticeResult {
  const entries = useCollectionsCenter();
  const [persisted, setPersisted] = useState<DailyCollectionsNoticeState | null>(null);
  const [isPersistedLoaded, setIsPersistedLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    loadDailyCollectionsNoticeState()
      .then((state) => {
        if (active) {
          setPersisted(state);
          setIsPersistedLoaded(true);
        }
      })
      .catch(() => {
        if (active) setIsPersistedLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const today = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
  const summary = summarizeCollectionsUrgency(entries);

  // Mientras el estado persistido todavía no terminó de cargar, no se
  // muestra el aviso — evita un parpadeo mostrándolo de más y ocultándolo
  // apenas se sepa que ya se había descartado hoy.
  const visible =
    isPersistedLoaded &&
    shouldShowDailyCollectionsNotice({
      today,
      worstUrgencyRank: summary.worstUrgencyRank,
      persisted,
    });

  function dismissForToday() {
    if (summary.worstUrgencyRank === null) return;
    const next = buildDismissedNoticeState({ today, worstUrgencyRank: summary.worstUrgencyRank });
    setPersisted(next);
    // No es crítico: si la escritura falla, en la próxima apertura el
    // aviso simplemente vuelve a mostrarse — nunca se pierde información
    // real (no es dato financiero).
    void saveDailyCollectionsNoticeState(next).catch(() => {});
  }

  return { visible, summary, dismissForToday };
}
