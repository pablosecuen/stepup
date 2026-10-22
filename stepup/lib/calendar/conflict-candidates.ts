import type { ConflictCandidateLesson } from "../calendar-conflicts.ts";
import type { CalendarViewItem } from "./occurrences.ts";

type ViewItemForConflict = Pick<CalendarViewItem, "id" | "start" | "end" | "status" | "isRecurring" | "lessonType" | "recurrenceId"> & Partial<Pick<CalendarViewItem, "studentName" | "title">>;

/**
 * Candidatos de solapamiento a partir de la vista real del calendario.
 *
 * `excludeRecurrenceId` es para el chequeo POSTERIOR a crear una serie: la
 * vista ya incluye las ocurrencias de la regla recién creada, y compararlas
 * contra sí mismas producía un "conflicto real" falso en TODA creación de
 * serie (la ocurrencia se solapa consigo misma). Se excluye únicamente esa
 * serie — cualquier otra serie, o una clase suelta, sigue siendo candidata.
 */
export function toConflictCandidates(items: ViewItemForConflict[], options: { excludeRecurrenceId?: string; excludeRecurrenceIds?: readonly string[] } = {}): ConflictCandidateLesson[] {
  const excluded = new Set([...(options.excludeRecurrenceIds ?? []), ...(options.excludeRecurrenceId ? [options.excludeRecurrenceId] : [])]);
  return items
    .filter((item) => !item.recurrenceId || !excluded.has(item.recurrenceId))
    .map((item) => {
      const label = item.title?.trim() || item.studentName?.trim();
      return {
        id: item.id,
        start: item.start,
        end: item.end,
        status: item.status,
        isRecurring: item.isRecurring,
        lessonType: item.lessonType,
        overlapAllowed: false,
        ...(label ? { label } : {}),
      };
    });
}
