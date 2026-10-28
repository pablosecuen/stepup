// Puerto VERBATIM del original (`src/features/payments/utils/dailyCollectionsNotice.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { URGENCY_RANK } from './collectionsCenter.ts';

/**
 * Estado mínimo persistido del aviso diario de cobros (Fase Pagos 4C.3) —
 * nunca una estadística financiera derivada, sólo lo indispensable para
 * decidir si ya se descartó hoy y qué tan grave era la situación en ese
 * momento (para poder detectar después si empeoró).
 */
export interface DailyCollectionsNoticeState {
  /** Date key YYYY-MM-DD (huso Buenos Aires) del día en que se tocó "Recordarme mañana". */
  dismissedOnDate: string;
  /** `URGENCY_RANK` de la situación más grave que había en el momento del descarte. */
  dismissedWorstUrgencyRank: number;
}

/** El menor (más severo) `URGENCY_RANK` posible — usado sólo para validar el estado persistido. */
const WORST_POSSIBLE_RANK = Math.min(...Object.values(URGENCY_RANK));
/** El mayor (menos severo) `URGENCY_RANK` posible. */
const LEAST_SEVERE_RANK = Math.max(...Object.values(URGENCY_RANK));

export function isValidUrgencyRank(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= WORST_POSSIBLE_RANK &&
    value <= LEAST_SEVERE_RANK
  );
}

/**
 * Decide si el aviso diario de cobros debe mostrarse en el Home (Fase Pagos
 * 4C.3). Reglas, todas cubiertas por pruebas dedicadas:
 *  - si no queda absolutamente ningún cobro que necesite atención (ni
 *    siquiera uno que venza hoy), nunca se muestra — se oculta de
 *    inmediato, incluso si nunca se descartó;
 *  - si nunca se descartó, o se descartó un día distinto de hoy, se
 *    muestra (primera apertura del día / reaparición al día siguiente);
 *  - si se descartó HOY, sólo vuelve a mostrarse si la situación más grave
 *    actual es más urgente (rango menor) que la que había al descartar —
 *    más entradas en la misma etapa no cuentan como "más urgente", sólo
 *    una etapa peor.
 *
 * `worstUrgencyRank` es el único gate de "hay algo que mostrar": abarca las
 * cuatro categorías (incluida "vence hoy"), a propósito distinto de
 * `totalWithDebt` (que sólo cuenta deuda ya vencida, sin "vence hoy") — un
 * día con obligaciones que vencen hoy pero ninguna vencida todavía SÍ debe
 * mostrar el aviso.
 *
 * Pura — no lee el reloj ni AsyncStorage: recibe `today` y `persisted` ya
 * resueltos, para poder probarla sin mocks.
 */
export function shouldShowDailyCollectionsNotice(input: {
  today: string;
  worstUrgencyRank: number | null;
  persisted: DailyCollectionsNoticeState | null;
}): boolean {
  if (input.worstUrgencyRank === null) return false;
  if (!input.persisted) return true;
  if (input.persisted.dismissedOnDate !== input.today) return true;
  return input.worstUrgencyRank < input.persisted.dismissedWorstUrgencyRank;
}

/** Construye el estado a persistir al tocar "Recordarme mañana". */
export function buildDismissedNoticeState(input: {
  today: string;
  worstUrgencyRank: number;
}): DailyCollectionsNoticeState {
  return { dismissedOnDate: input.today, dismissedWorstUrgencyRank: input.worstUrgencyRank };
}
