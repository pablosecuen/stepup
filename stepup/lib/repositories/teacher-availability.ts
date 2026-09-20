import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { TeacherAvailabilityRow } from "@/lib/db/database.types";
import type { AvailabilityException, TeacherAvailability, WeeklyAvailabilityBlock } from "@/lib/calendar/availability";

/**
 * Repositorio de disponibilidad — una única fila por profesor
 * (`teacher_availability.owner_id` es la PK). Espeja `TeacherAvailability`
 * (móvil) tal cual — `weeklyBlocks`/`exceptions` viajan como jsonb, mismo
 * patrón que `weeks` en `recurrence_rules` (reutiliza el motor puro sin
 * reescribirlo).
 */

function toRecord(row: TeacherAvailabilityRow): TeacherAvailability {
  return {
    schemaVersion: 1,
    timezone: row.timezone,
    weeklyBlocks: row.weekly_blocks as unknown as WeeklyAvailabilityBlock[],
    exceptions: row.exceptions as unknown as AvailabilityException[],
  };
}

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** Nunca falla si el profesor todavía no configuró nada — devuelve el documento vacío por defecto, igual que el móvil. */
export async function getTeacherAvailability(ctx: AuthenticatedDbContext): Promise<TeacherAvailability> {
  const { data, error } = await ctx.supabase.from("teacher_availability").select("*").eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) throw error;
  if (!data) return { schemaVersion: 1, timezone: DEFAULT_TIMEZONE, weeklyBlocks: [], exceptions: [] };
  return toRecord(data as TeacherAvailabilityRow);
}

/** Upsert real — crea la fila si es la primera vez que el profesor guarda disponibilidad. */
export async function saveTeacherAvailability(ctx: AuthenticatedDbContext, availability: TeacherAvailability): Promise<TeacherAvailability> {
  const { data, error } = await ctx.supabase
    .from("teacher_availability")
    .upsert({ owner_id: ctx.ownerId, timezone: availability.timezone, weekly_blocks: availability.weeklyBlocks, exceptions: availability.exceptions })
    .select("*")
    .single();
  if (error) throw error;
  return toRecord(data as TeacherAvailabilityRow);
}
