import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable } from "../db/read.ts";
import { isMissingTableError } from "../transfer/export-destination.ts";
import { NO_EXCLUDED_STUDENTS } from "../data-exclusion/exclusion.ts";

/**
 * Alumnos de PRUEBA confirmados (R16) cuyos datos se excluyen de agenda, pendientes y estadísticas. Sólo lectura, siempre por la cuenta de la sesión. Sin la tabla (migración sin aplicar) o sin filas
 * vigentes devuelve vacío: la aplicación se comporta exactamente como siempre. Una exclusión revocada (`revoked_at`) deja de aplicarse.
 */
export async function loadExcludedStudentIds(ctx: AuthenticatedDbContext): Promise<ReadonlySet<string>> {
  try {
    const rows = await readTable<{ id: string; student_id: string }>(ctx.supabase, "test_data_exclusions", {
      columns: "id, student_id",
      filter: (query) => query.eq("owner_id", ctx.ownerId).is("revoked_at", null),
    });
    return rows.length === 0 ? NO_EXCLUDED_STUDENTS : new Set(rows.map((row) => row.student_id));
  } catch (error) {
    if (isMissingTableError(error)) return NO_EXCLUDED_STUDENTS;
    throw error;
  }
}
