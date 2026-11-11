import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import { monthMinutesOf } from "@/lib/dashboard/home-stats";

interface RegistrationRow {
  id: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  created_at: string;
  actual_duration_minutes: number | null;
}

/**
 * Lo que necesitan los indicadores de Inicio de las clases dictadas (finalizadas y que cuentan como clase): la duración de las de este mes y todas las notas generales reales.
 * Sólo lecturas. `monthKey` es AAAA-MM (mes civil de Argentina); el día de cada clase es el del instante en que se dictó (real, o programado, o de alta), en hora de Argentina. Una reprogramada no cuenta
 * (su registro no «cuenta como clase»); la clase nueva se cuenta una sola vez. La duración sale de `resolveClassMinutes`: la real guardada, el inicio y fin reales (lo que escribe la web) o la programada.
 */
export async function loadHomeStatsInputs(ctx: AuthenticatedDbContext, monthKey: string): Promise<{ monthMinutes: Array<number | null>; grades: number[] }> {
  const held = await readTable<RegistrationRow>(ctx.supabase, "lesson_registrations", {
    columns: "id, scheduled_start_at, scheduled_end_at, actual_started_at, actual_ended_at, created_at, actual_duration_minutes",
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "completed").eq("counts_as_class", true),
  });
  const monthMinutes = monthMinutesOf(
    held.map((row) => ({ actualDurationMinutes: row.actual_duration_minutes === null ? null : Number(row.actual_duration_minutes), actualStartedAt: row.actual_started_at, actualEndedAt: row.actual_ended_at, scheduledStartAt: row.scheduled_start_at, scheduledEndAt: row.scheduled_end_at, createdAt: row.created_at })),
    monthKey
  );
  const evaluations = await readTableByIds<{ id: string; general_grade: number | null }>(ctx.supabase, "lesson_registration_evaluations", {
    columns: "id, general_grade",
    matchColumn: "lesson_registration_id",
    ids: held.map((row) => row.id),
    filter: (query) => query.eq("owner_id", ctx.ownerId).not("general_grade", "is", null),
  });
  return { monthMinutes, grades: evaluations.map((row) => Number(row.general_grade)) };
}
