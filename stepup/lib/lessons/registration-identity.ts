/** Resolve identity from the server calendar item, never from stale browser references.
 * A materialized (including rescheduled) lesson already has a stable primary key.
 * Recurrence keys are only needed when materializing a virtual occurrence.
 */
export function registrationIdentity(item: {
  materializedLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex?: number | null;
}) {
  if (item.materializedLessonId) {
    return { calendarLessonId: item.materializedLessonId, recurrenceId: null, occurrenceKey: null, recurrenceIndex: null };
  }
  if (!item.recurrenceId || !item.occurrenceKey) {
    throw new Error("No pudimos identificar esta clase. Volvé al calendario y reintentá.");
  }
  return { calendarLessonId: null, recurrenceId: item.recurrenceId, occurrenceKey: item.occurrenceKey, recurrenceIndex: item.recurrenceIndex ?? null };
}
