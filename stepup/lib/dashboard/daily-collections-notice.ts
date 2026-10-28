import { URGENCY_RANK } from "../payments/engine/features/payments/utils/collectionsCenter.ts";
import { isValidUrgencyRank, type DailyCollectionsNoticeState } from "../payments/engine/features/payments/utils/dailyCollectionsNotice.ts";
import type { CollectionsUrgencySummary } from "../payments/collections-urgency.ts";

/** Dónde recuerda este dispositivo que se tocó «Recordarme mañana» (igual que el original, que lo guarda en el propio dispositivo; no viaja a la base). */
export const DAILY_NOTICE_STORAGE_KEY = "teacherflow:cobros:aviso-diario";

/**
 * Urgencia más grave de lo que hay hoy, con la escala del original: vencido (0) es peor que «vence hoy» (3); `null` si no hay nada que requiera atención. La web no distingue las etapas de mora
 * (primer, segundo y último vencimiento) porque los recargos automáticos están desactivados: toda deuda vencida cae en el rango más grave.
 */
export function worstNoticeRank(summary: CollectionsUrgencySummary): number | null {
  if (summary.overdueCount > 0) return URGENCY_RANK.vencido;
  if (summary.dueToday > 0) return URGENCY_RANK.vence_hoy;
  return null;
}

/** Lee lo guardado con validación estricta: cualquier valor roto se ignora (el aviso vuelve a mostrarse, nunca queda oculto por un dato corrupto). */
export function parseStoredNotice(raw: string | null): DailyCollectionsNoticeState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const { dismissedOnDate, dismissedWorstUrgencyRank } = value as Record<string, unknown>;
    if (typeof dismissedOnDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dismissedOnDate)) return null;
    if (!isValidUrgencyRank(dismissedWorstUrgencyRank)) return null;
    return { dismissedOnDate, dismissedWorstUrgencyRank };
  } catch {
    return null;
  }
}
