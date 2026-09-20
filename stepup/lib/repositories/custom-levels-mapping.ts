import type { CustomLevelRow } from "../db/database.types.ts";
import { STANDARD_LEVELS } from "../students/constants.ts";

/**
 * Lógica PURA de niveles personalizados — puerto de `customLevelsCore.ts`
 * del móvil (`normalizeCustomLevelName`/`isReservedStandardLevelName`/
 * `isDuplicateCustomLevelName`), sin imports de Supabase/Next, probable
 * directo con `node --test` (mismo patrón que `students-mapping.ts`).
 */

export interface CustomLevelRecord {
  id: string;
  name: string;
  createdAt: string;
}

export function toCustomLevelRecord(row: CustomLevelRow): CustomLevelRecord {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** Recorta y colapsa espacios repetidos — nunca acepta un nombre "  B1   avanzado  " tal cual. */
export function normalizeCustomLevelName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function foldForComparison(name: string): string {
  return normalizeCustomLevelName(name).toLocaleLowerCase("es");
}

/** true si `name` coincide (insensible a mayúsculas) con alguno de los 6 niveles CEFR estándar. */
export function isReservedStandardLevelName(name: string): boolean {
  const folded = foldForComparison(name);
  return STANDARD_LEVELS.some((level) => level.toLocaleLowerCase("es") === folded);
}

/** true si `name` ya existe entre `levels` (insensible a mayúsculas/espacios), ignorando `excludeId` (para renombrar sobre sí mismo). */
export function isDuplicateCustomLevelName(levels: CustomLevelRecord[], name: string, excludeId?: string): boolean {
  const folded = foldForComparison(name);
  return levels.some((level) => level.id !== excludeId && foldForComparison(level.name) === folded);
}

export interface LevelNameValidationError {
  message: string;
}

/**
 * Validación pura compartida por crear y renombrar — mismos 3 mensajes
 * exactos que el móvil (`customLevelsStore.ts`). `null` = válido.
 */
export function validateLevelName(
  rawName: string,
  existingLevels: CustomLevelRecord[],
  excludeId?: string
): LevelNameValidationError | null {
  const name = normalizeCustomLevelName(rawName);
  if (name === "") return { message: "Ponele un nombre al nivel." };
  if (isReservedStandardLevelName(name)) {
    return { message: "Ese nombre ya corresponde a un nivel estándar (A1-C2)." };
  }
  if (isDuplicateCustomLevelName(existingLevels, name, excludeId)) {
    return { message: "Ya existe un nivel personalizado con ese nombre." };
  }
  return null;
}
