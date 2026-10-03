import type { ConflictCandidateLesson } from "../calendar-conflicts.ts";
import type { CalendarViewItem } from "./occurrences.ts";

type ViewItemForConflict = Pick<CalendarViewItem, "id" | "start" | "end" | "status" | "isRecurring" | "lessonType" | "recurrenceId">;

/**
 * Candidatos de solapamiento a partir de la vista real del calendario.
 *
 * `excludeRecurrenceId` es para el chequeo POSTERIOR a crear una serie: la
 * vista ya incluye las ocurrencias de la regla recién creada, y compararlas
 * contra sí mismas producía un "conflicto real" falso en TODA creación de
 * serie (la ocurrencia se solapa consigo misma). Se excluye únicamente esa
 * serie — cualquier otra serie, o una clase suelta, sigue siendo candidata.
 */
export function toConflictCandidates(items: ViewItemForConflict[], options: { excludeRecurrenceId?: string } = {}): ConflictCandidateLesson[] {
  const { excludeRecurrenceId } = options;
  return items
    .filter((item) => !excludeRecurrenceId || item.recurrenceId !== excludeRecurrenceId)
    .map((item) => ({
      id: item.id,
      start: item.start,
      end: item.end,
      status: item.status,
      isRecurring: item.isRecurring,
      lessonType: item.lessonType,
      overlapAllowed: false,
    }));
}
