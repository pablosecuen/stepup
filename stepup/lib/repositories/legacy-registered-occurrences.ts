import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable } from "../db/read.ts";
import { isMissingTableError } from "../transfer/export-destination.ts";
import { buildLegacyRegisteredOccurrenceKeys } from "../lessons/legacy-registered.ts";

/**
 * Ocurrencias de series que TeacherFlow anterior ya registró y cuya clase de calendario faltaba en el respaldo (ver `lib/lessons/legacy-registered.ts`). Sólo lectura, siempre por la cuenta de la
 * sesión. Sin la tabla de incidencias (traslado sin aplicar) o sin incidencias devuelve vacío: la pantalla se comporta como siempre.
 */
export async function loadLegacyRegisteredOccurrenceKeys(ctx: AuthenticatedDbContext): Promise<Set<string>> {
  try {
    const incidents = await readTable<{ id: string; field: string; detail: unknown }>(ctx.supabase, "origin_incidents", {
      columns: "id, field, detail",
      filter: (q) => q.eq("owner_id", ctx.ownerId).eq("entity", "pedagogicalLessons").eq("field", "calendarLessonId"),
    });
    if (incidents.length === 0) return new Set();
    const rules = await readTable<{ id: string; legacy_mobile_id: string | null }>(ctx.supabase, "recurrence_rules", { columns: "id, legacy_mobile_id", filter: (q) => q.eq("owner_id", ctx.ownerId) });
    return buildLegacyRegisteredOccurrenceKeys(incidents, rules);
  } catch (error) {
    if (isMissingTableError(error)) return new Set();
    throw error;
  }
}
