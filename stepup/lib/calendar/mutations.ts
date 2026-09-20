import type { CalendarViewItem } from "./occurrences.ts";
import { isActiveReplacement } from "./occurrences.ts";

/**
 * Puerto de `getCancelledSlotReuseDecision`/`isEligibleForCancelledSlotReuse`
 * (móvil, `cancelledSlotReuse.ts`) — las 4 condiciones EXACTAS para que
 * "Reemplazar con otro alumno" esté disponible sobre una clase cancelada:
 * 1) está cancelada; 2) tiene un horario real válido; 3) ese horario es
 * ESTRICTAMENTE futuro; 4) no tiene ya un reemplazo activo (una clase
 * distinta con `freedByLessonId` apuntándole y que ella misma no esté
 * cancelada). Única fuente de esta decisión — nunca una segunda copia de
 * la condición en la UI.
 */
export interface CancelledSlotReuseDecision {
  eligible: boolean;
  reason: "not_cancelled" | "invalid_schedule" | "not_future" | "already_has_active_replacement" | null;
}

export function getCancelledSlotReuseDecision(item: CalendarViewItem, all: CalendarViewItem[], now: Date): CancelledSlotReuseDecision {
  if (item.status !== "cancelled") return { eligible: false, reason: "not_cancelled" };
  const startTime = new Date(item.start).getTime();
  if (!Number.isFinite(startTime)) return { eligible: false, reason: "invalid_schedule" };
  if (startTime <= now.getTime()) return { eligible: false, reason: "not_future" };
  if (hasActiveReplacementForCancelledSlot(item, all)) return { eligible: false, reason: "already_has_active_replacement" };
  return { eligible: true, reason: null };
}

function hasActiveReplacementForCancelledSlot(item: CalendarViewItem, all: CalendarViewItem[]): boolean {
  return all.some((candidate) => candidate.id !== item.id && candidate.freedByLessonId === item.id && candidate.status !== "cancelled");
}

export { isActiveReplacement };
