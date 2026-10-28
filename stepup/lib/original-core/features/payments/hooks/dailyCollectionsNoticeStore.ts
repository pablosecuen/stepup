// Puerto VERBATIM del original (`src/features/payments/hooks/dailyCollectionsNoticeStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import { isValidDateKey } from '../utils/paymentDates.ts';
import { isValidUrgencyRank, type DailyCollectionsNoticeState } from '../utils/dailyCollectionsNotice.ts';

/**
 * Clave propia, separada de `PAYMENTS_STORAGE_KEYS` (Fase Pagos 4C.3): el
 * aviso diario no es parte del dominio financiero — es una preferencia de
 * UI mínima ("¿ya lo descarté hoy?"), nunca una estadística financiera
 * derivada. Por eso tampoco participa del esquema de pagos ni del backup:
 * perderla en una restauración sólo significa que el aviso vuelve a
 * mostrarse una vez más, nunca una pérdida de información real.
 */
const STORAGE_KEY = '@teacherflow/daily_collections_notice';

/**
 * Parseo puro, separado de la lectura en AsyncStorage para poder probarlo
 * sin depender de un runtime de React Native. A diferencia del resto del
 * dominio de pagos (donde la corrupción se propaga siempre como error, para
 * nunca esconder una pérdida de datos financieros), acá el contenido es de
 * bajo riesgo: cualquier valor ausente, corrupto o con forma inválida se
 * trata como "nunca se descartó" — el peor caso posible es mostrar el aviso
 * una vez de más, nunca ocultarlo indebidamente ni perder datos reales.
 */
export function parsePersistedDailyCollectionsNoticeState(raw: string | null): DailyCollectionsNoticeState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.dismissedOnDate !== 'string' || !isValidDateKey(candidate.dismissedOnDate)) return null;
  if (!isValidUrgencyRank(candidate.dismissedWorstUrgencyRank)) return null;
  return {
    dismissedOnDate: candidate.dismissedOnDate,
    dismissedWorstUrgencyRank: candidate.dismissedWorstUrgencyRank,
  };
}

export async function loadDailyCollectionsNoticeState(): Promise<DailyCollectionsNoticeState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return parsePersistedDailyCollectionsNoticeState(raw);
  } catch {
    return null;
  }
}

export async function saveDailyCollectionsNoticeState(state: DailyCollectionsNoticeState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
