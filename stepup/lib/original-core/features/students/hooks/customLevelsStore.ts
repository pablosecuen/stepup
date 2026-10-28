// Puerto VERBATIM del original (`src/features/students/hooks/customLevelsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CustomLevel } from '../types/index.ts';
import { loadCustomLevels, saveCustomLevels } from '../../../shared/storage/teacherFlowStorage.ts';
import { addCustomLevelEntry, countStudentsUsingLevel, isDuplicateCustomLevelName, isReservedStandardLevelName, normalizeCustomLevelName, removeCustomLevelEntry, renameCustomLevelEntry } from '../utils/customLevelsCore.ts';
import { countStudentsWithLevel, getStudentsStore, renameStudentsLevel } from './studentStore.ts';
import { renameProfilesLevel } from '../../student-profile/hooks/useStudentProfile.ts';

/**
 * Corrección (a pedido de Joaquín — niveles personalizados): store real —
 * mismo patrón de hidratación perezosa/memoizada ya establecido en
 * `materialsLibraryStore.ts`/`reportHistoryStore.ts` (un único lugar real
 * de escritura, nunca un segundo lugar que también persista esta lista).
 */

const customLevelsStore: CustomLevel[] = [];
let hydrationPromise: Promise<void> | null = null;

export function getCustomLevels(): CustomLevel[] {
  return customLevelsStore.map((level) => ({ ...level }));
}

export function hydrateCustomLevels(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadCustomLevels<CustomLevel[]>().then((saved) => {
      if (Array.isArray(saved) && customLevelsStore.length === 0) {
        customLevelsStore.push(...saved);
      }
    });
  }
  return hydrationPromise;
}

export function replaceCustomLevelsStore(levels: CustomLevel[]): void {
  customLevelsStore.splice(0, customLevelsStore.length, ...levels);
}

function createCustomLevelId(): string {
  return `custom_level_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export type CustomLevelMutationResult =
  | { ok: true; level: CustomLevel }
  | { ok: false; error: string };

/** Valida (vacío, duplicado, choque con un estándar) y persiste — nunca crea un nivel a partir de un nombre inválido. */
export async function addCustomLevel(rawName: string): Promise<CustomLevelMutationResult> {
  await hydrateCustomLevels();
  const name = normalizeCustomLevelName(rawName);
  if (!name) {
    return { ok: false, error: 'Ponele un nombre al nivel.' };
  }
  if (isReservedStandardLevelName(name)) {
    return { ok: false, error: 'Ese nombre ya corresponde a un nivel estándar (A1-C2).' };
  }
  if (isDuplicateCustomLevelName(getCustomLevels(), name)) {
    return { ok: false, error: 'Ya existe un nivel personalizado con ese nombre.' };
  }
  const level: CustomLevel = { id: createCustomLevelId(), name, createdAt: new Date().toISOString() };
  replaceCustomLevelsStore(addCustomLevelEntry(getCustomLevels(), level));
  await saveCustomLevels(getCustomLevels());
  return { ok: true, level };
}

export type CustomLevelRenameResult = { ok: true } | { ok: false; error: string };

/**
 * El nombre es lo que ya vive tal cual en `StudentListItem.level`/
 * `StudentProfile.level` de cualquier alumno que lo use (no un id
 * separado) — renombrar por lo tanto actualiza también a esos alumnos, en
 * la MISMA operación, para que nunca quede un alumno con el nombre viejo
 * "fantasma" mientras el nivel ya se llama distinto en la lista de
 * niveles. Nunca reescribe `levelHistory` (registro histórico).
 */
export async function renameCustomLevel(id: string, rawName: string): Promise<CustomLevelRenameResult> {
  await hydrateCustomLevels();
  const name = normalizeCustomLevelName(rawName);
  if (!name) {
    return { ok: false, error: 'Ponele un nombre al nivel.' };
  }
  const current = getCustomLevels().find((level) => level.id === id);
  if (!current) {
    return { ok: false, error: 'No se encontró el nivel.' };
  }
  if (name === current.name) {
    return { ok: true };
  }
  if (isReservedStandardLevelName(name)) {
    return { ok: false, error: 'Ese nombre ya corresponde a un nivel estándar (A1-C2).' };
  }
  if (isDuplicateCustomLevelName(getCustomLevels(), name, id)) {
    return { ok: false, error: 'Ya existe un nivel personalizado con ese nombre.' };
  }
  replaceCustomLevelsStore(renameCustomLevelEntry(getCustomLevels(), id, name));
  await saveCustomLevels(getCustomLevels());
  await renameStudentsLevel(current.name, name);
  await renameProfilesLevel(current.name, name);
  return { ok: true };
}

export type CustomLevelRemoveResult = { ok: true } | { ok: false; error: string; usageCount: number };

/**
 * Nunca borra silenciosamente un nivel en uso — si algún alumno lo tiene
 * asignado (verificado contra `studentStore`, la lista real), se rechaza
 * con la cantidad exacta, para que la profesora reasigne a esos alumnos
 * primero. Ningún alumno queda nunca con una referencia rota a un nivel
 * que ya no existe.
 */
export async function removeCustomLevel(id: string): Promise<CustomLevelRemoveResult> {
  await hydrateCustomLevels();
  const current = getCustomLevels().find((level) => level.id === id);
  if (!current) {
    return { ok: false, error: 'No se encontró el nivel.', usageCount: 0 };
  }
  const usageCount = countStudentsWithLevel(current.name);
  if (usageCount > 0) {
    return {
      ok: false,
      error:
        usageCount === 1
          ? 'Este nivel está asignado a 1 alumno. Reasigná su nivel antes de eliminarlo.'
          : `Este nivel está asignado a ${usageCount} alumnos. Reasigná su nivel antes de eliminarlo.`,
      usageCount,
    };
  }
  replaceCustomLevelsStore(removeCustomLevelEntry(getCustomLevels(), id));
  await saveCustomLevels(getCustomLevels());
  return { ok: true };
}

/** Reexportado por conveniencia — para que la UI no tenga que importar `customLevelsCore.ts` sólo por esto. */
export function countCustomLevelUsage(levelName: string): number {
  return countStudentsUsingLevel(getStudentsStore(), levelName);
}
