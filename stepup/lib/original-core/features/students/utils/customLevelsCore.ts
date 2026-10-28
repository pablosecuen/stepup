// Puerto VERBATIM del original (`src/features/students/utils/customLevelsCore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CustomLevel, StudentListItem } from '../types/index.ts';
import { STANDARD_CEFR_LEVELS } from '../types/index.ts';

/**
 * Corrección (a pedido de Joaquín — niveles personalizados): núcleo puro
 * de `customLevelsStore.ts` — mismo patrón ya establecido en
 * `reportHistoryCore.ts`/`textItemEditDomain.ts` (separar la lógica de
 * negocio testeable del I/O real de AsyncStorage), para poder probar estas
 * reglas con datos en memoria, sin ningún adaptador real.
 */

export function normalizeCustomLevelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function foldForComparison(name: string): string {
  return normalizeCustomLevelName(name).toLocaleLowerCase();
}

/** `true` si `name` ya coincide (sin importar mayúsculas/espacios) con uno de los 6 niveles CEFR estándar — esos nombres quedan reservados. */
export function isReservedStandardLevelName(name: string): boolean {
  const folded = foldForComparison(name);
  return STANDARD_CEFR_LEVELS.some((level) => level.toLocaleLowerCase() === folded);
}

/** `true` si ya existe un nivel personalizado con ese nombre (sin importar mayúsculas/espacios) — `excludeId` para permitir renombrar sin chocar contra sí mismo. */
export function isDuplicateCustomLevelName(levels: CustomLevel[], name: string, excludeId?: string): boolean {
  const folded = foldForComparison(name);
  return levels.some((level) => level.id !== excludeId && foldForComparison(level.name) === folded);
}

export function addCustomLevelEntry(levels: CustomLevel[], entry: CustomLevel): CustomLevel[] {
  return [...levels, entry];
}

export function renameCustomLevelEntry(levels: CustomLevel[], id: string, name: string): CustomLevel[] {
  return levels.map((level) => (level.id === id ? { ...level, name } : level));
}

export function removeCustomLevelEntry(levels: CustomLevel[], id: string): CustomLevel[] {
  return levels.filter((level) => level.id !== id);
}

/**
 * Cantidad de alumnos (de cualquier estado — activo, pausado, archivado,
 * etc.) que hoy tienen este nivel entre los suyos. Corrección (a pedido de
 * Joaquín — niveles combinables): un alumno puede combinar varios niveles a
 * la vez, así que esto cuenta por INCLUSIÓN en la lista, nunca por
 * coincidencia exacta de un único valor — si no, un alumno con
 * `['A1', 'Infantes']` nunca contaría como usuario de "Infantes".
 */
export function countStudentsUsingLevel(students: Pick<StudentListItem, 'levels'>[], levelName: string): number {
  return students.filter((student) => student.levels.includes(levelName)).length;
}
