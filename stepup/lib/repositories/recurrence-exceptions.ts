import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceExceptionRow, RecurrenceExceptionType } from "@/lib/db/database.types";

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
  const { data, error } = await ctx.supabase.from("recurrence_exceptions").select("*").eq("owner_id", ctx.ownerId).in("recurrence_id", recurrenceIds);
  if (error) throw error;
  return (data as RecurrenceExceptionRow[]).map(toRecord);
}
