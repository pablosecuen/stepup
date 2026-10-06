import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceExceptionRow, RecurrenceExceptionType } from "@/lib/db/database.types";
import { readTableByIds } from "@/lib/db/read";

export interface RecurrenceExceptionRecord {
  id: string;
  recurrenceId: string;
  occurrenceKey: string;
  type: RecurrenceExceptionType;
  replacementLessonId: string | null;
}

function toRecord(row: RecurrenceExceptionRow): RecurrenceExceptionRecord {
  return { id: row.id, recurrenceId: row.recurrence_id, occurrenceKey: row.occurrence_key, type: row.exception_type, replacementLessonId: row.replacement_lesson_id };
}

/** Espeja `RecurrenceException[]` — append-only en el móvil; acá se lee tal cual, nunca se edita/borra desde el repositorio. */
export async function listRecurrenceExceptionsForRules(ctx: AuthenticatedDbContext, recurrenceIds: string[]): Promise<RecurrenceExceptionRecord[]> {
  if (recurrenceIds.length === 0) return [];
  // R2: ids de series en lotes de 100 (con muchas series la lista en la URL superaba el límite del gateway) + lectura paginada.
  const data = await readTableByIds<RecurrenceExceptionRow>(ctx.supabase, "recurrence_exceptions", {
    matchColumn: "recurrence_id",
    ids: recurrenceIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  return data.map(toRecord);
}
