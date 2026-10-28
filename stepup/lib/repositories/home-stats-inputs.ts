import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import { instantDateKey } from "@/lib/calendar/civil-calendar";

interface RegistrationRow {
  id: string;
  scheduled_start_at: string | null;
  actual_started_at: string | null;
  created_at: string;
  actual_duration_minutes: number | null;
}

/**
 * Lo que necesitan los indicadores de Inicio de las clases dictadas (finalizadas y que cuentan como clase): la duración real de las de este mes y todas las notas generales reales.
 * Sólo lecturas. `monthKey` es AAAA-MM (mes civil de Argentina); el día de cada clase es el del instante programado, real o de alta, en hora de Argentina.
 */
export async function loadHomeStatsInputs(ctx: AuthenticatedDbContext, monthKey: string): Promise<{ monthMinutes: Array<number | null>; grades: number[] }> {
  const held = await readTable<RegistrationRow>(ctx.supabase, "lesson_registrations", {
    columns: "id, scheduled_start_at, actual_started_at, created_at, actual_duration_minutes",
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "completed").eq("counts_as_class", true),
  });
  const monthMinutes = held
    .filter((row) => instantDateKey(row.scheduled_start_at ?? row.actual_started_at ?? row.created_at).slice(0, 7) === monthKey)
    .map((row) => (row.actual_duration_minutes === null ? null : Number(row.actual_duration_minutes)));
  const evaluations = await readTableByIds<{ id: string; general_grade: number | null }>(ctx.supabase, "lesson_registration_evaluations", {
    columns: "id, general_grade",
    matchColumn: "lesson_registration_id",
    ids: held.map((row) => row.id),
    filter: (query) => query.eq("owner_id", ctx.ownerId).not("general_grade", "is", null),
  });
  return { monthMinutes, grades: evaluations.map((row) => Number(row.general_grade)) };
}
