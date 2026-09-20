import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { CustomLevelRow } from "@/lib/db/database.types";
import {
  toCustomLevelRecord,
  validateLevelName,
  type CustomLevelRecord,
} from "./custom-levels-mapping";

/**
 * Repositorio de niveles personalizados — única puerta de entrada real a
 * `custom_levels`. Mismo patrón que `students.ts`: lógica pura separada en
 * `custom-levels-mapping.ts`, este archivo es sólo el pegamento de red.
 */
export type { CustomLevelRecord } from "./custom-levels-mapping";

export async function listCustomLevels(ctx: AuthenticatedDbContext): Promise<CustomLevelRecord[]> {
  const { data, error } = await ctx.supabase
    .from("custom_levels")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as CustomLevelRow[]).map(toCustomLevelRecord);
}

export class DuplicateLevelNameError extends Error {}
export class InvalidLevelNameError extends Error {}
export class LevelNotFoundError extends Error {}
export class LevelInUseError extends Error {
  constructor(public readonly usageCount: number) {
    super(
      usageCount === 1
        ? "Este nivel está asignado a 1 alumno. Reasigná su nivel antes de eliminarlo."
        : `Este nivel está asignado a ${usageCount} alumnos. Reasigná su nivel antes de eliminarlo.`
    );
  }
}

/** Crea un nivel personalizado. Valida en la app ANTES del round-trip; el índice único de la base es el respaldo real. */
export async function createCustomLevel(ctx: AuthenticatedDbContext, rawName: string): Promise<CustomLevelRecord> {
  const existing = await listCustomLevels(ctx);
  const validationError = validateLevelName(rawName, existing);
  if (validationError) throw new InvalidLevelNameError(validationError.message);

  const { data, error } = await ctx.supabase
    .from("custom_levels")
    .insert({ owner_id: ctx.ownerId, name: rawName.trim().replace(/\s+/g, " ") })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateLevelNameError("Ya existe un nivel personalizado con ese nombre.");
    throw error;
  }
  return toCustomLevelRecord(data as CustomLevelRow);
}

/**
 * Renombra un nivel con cascada atómica (RPC `rename_custom_level`, ver
 * `supabase/migrations/20260920120000_student_mutation_rpcs.sql`) —
 * actualiza `custom_levels.name` Y `students.levels`/`initial_level` de
 * todos los alumnos propios que lo usan, en la MISMA transacción. Nunca
 * dos escrituras separadas que puedan quedar a medias.
 */
export async function renameCustomLevel(
  ctx: AuthenticatedDbContext,
  id: string,
  rawName: string
): Promise<CustomLevelRecord> {
  const existing = await listCustomLevels(ctx);
  const validationError = validateLevelName(rawName, existing, id);
  if (validationError) throw new InvalidLevelNameError(validationError.message);

  const { data, error } = await ctx.supabase.rpc("rename_custom_level", {
    p_level_id: id,
    p_new_name: rawName.trim().replace(/\s+/g, " "),
  });
  if (error) {
    if (error.code === "23505") throw new DuplicateLevelNameError("Ya existe un nivel personalizado con ese nombre.");
    if (error.code === "P0002") throw new LevelNotFoundError("Nivel no encontrado.");
    throw error;
  }
  return toCustomLevelRecord(data as CustomLevelRow);
}

/** Cuenta cuántos alumnos propios (cualquier estado) usan `levelName` — nunca borra un nivel en uso sin decisión explícita. */
export async function countStudentsUsingLevel(ctx: AuthenticatedDbContext, levelName: string): Promise<number> {
  const { count, error } = await ctx.supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ctx.ownerId)
    .contains("levels", [levelName]);
  if (error) throw error;
  return count ?? 0;
}

/** Elimina un nivel personalizado SÓLO si ningún alumno propio lo usa — nunca una eliminación silenciosa/parcial. */
export async function deleteCustomLevel(ctx: AuthenticatedDbContext, id: string, levelName: string): Promise<void> {
  const usageCount = await countStudentsUsingLevel(ctx, levelName);
  if (usageCount > 0) throw new LevelInUseError(usageCount);

  const { error } = await ctx.supabase.from("custom_levels").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  if (error) throw error;
}
