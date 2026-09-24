import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { TeacherProfileRow } from "@/lib/db/database.types";

/**
 * Repositorio de perfil de profesora — una única fila por profesor
 * (`teacher_profiles.owner_id` es la PK). Mismo patrón que
 * `teacher-availability.ts`: nunca falla si todavía no hay fila, devuelve un
 * perfil vacío por defecto.
 */

export interface TeacherProfileRecord {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: TeacherProfileRow): TeacherProfileRecord {
  return { displayName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class InvalidTeacherNameError extends Error {}

/** Recorta y colapsa espacios repetidos — mismo criterio que `normalizeCustomLevelName`. */
export function normalizeTeacherName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function getTeacherProfile(ctx: AuthenticatedDbContext): Promise<TeacherProfileRecord> {
  const { data, error } = await ctx.supabase.from("teacher_profiles").select("*").eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) throw error;
  if (!data) return { displayName: "", createdAt: "", updatedAt: "" };
  return toRecord(data as TeacherProfileRow);
}

/** Upsert real — crea la fila si es la primera vez que la profesora guarda su nombre. */
export async function saveTeacherDisplayName(ctx: AuthenticatedDbContext, rawName: string): Promise<TeacherProfileRecord> {
  const displayName = normalizeTeacherName(rawName);
  if (displayName === "") throw new InvalidTeacherNameError("Ponele un nombre a tu perfil.");

  const { data, error } = await ctx.supabase
    .from("teacher_profiles")
    .upsert({ owner_id: ctx.ownerId, display_name: displayName })
    .select("*")
    .single();
  if (error) throw error;
  return toRecord(data as TeacherProfileRow);
}
