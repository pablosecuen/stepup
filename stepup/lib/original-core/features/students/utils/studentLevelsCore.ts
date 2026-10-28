// Puerto VERBATIM del original (`src/features/students/utils/studentLevelsCore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { STANDARD_CEFR_LEVELS } from '../types/index.ts';

/**
 * Corrección (a pedido de Joaquín — niveles combinables): un alumno pasó de
 * tener UN único `level: string` a una lista `levels: string[]` (puede
 * combinar libremente estándar + personalizados). Funciones puras
 * compartidas por el store, la migración de datos antiguos y la UI — mismo
 * patrón de "núcleo puro + I/O separado" que `customLevelsCore.ts`.
 */

/**
 * Acepta CUALQUIER forma con la que un alumno pueda llegar desde
 * AsyncStorage o un respaldo: la nueva (`levels: string[]`), la vieja
 * (`level: string`, de antes de esta corrección) o directamente un valor
 * crudo sin tipar. Nunca pierde un nivel real ya guardado. Se usa en TODO
 * punto donde datos de alumnos/perfiles entran a un store en memoria
 * (hidratación local Y restauración de respaldo) — nunca sólo en uno, para
 * que un alumno viejo no aparezca sin nivel según por dónde haya entrado.
 */
export function normalizeLevelsList(raw: unknown, legacyLevel?: unknown): string[] {
  if (Array.isArray(raw)) {
    const fromArray = raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (fromArray.length > 0) return dedupeLevels(fromArray);
  }
  if (typeof legacyLevel === 'string' && legacyLevel.trim().length > 0) {
    return [legacyLevel];
  }
  return [];
}

function dedupeLevels(levels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const level of levels) {
    if (!seen.has(level)) {
      seen.add(level);
      result.push(level);
    }
  }
  return result;
}

/** Toggle de un chip: si ya está seleccionado lo saca, si no lo agrega — nunca afecta a los demás niveles ya elegidos. */
export function toggleLevel(levels: string[], level: string): string[] {
  return levels.includes(level) ? levels.filter((current) => current !== level) : [...levels, level];
}

/** Texto para mostrar en lugares que sólo tienen espacio para UN string (tarjeta de clase, analítica, "Nuevo alumno" de Nueva clase) — nunca vacío si hay al menos un nivel. */
export function joinLevelsForDisplay(levels: string[]): string {
  return levels.join(', ');
}

/**
 * "Registrar cambio de nivel" y "Reactivar alumno" son flujos que NUNCA se
 * rediseñaron para multiselección (siguen ofreciendo un único nivel CEFR,
 * ver ChangeStatusSheet.tsx/LevelAchievementSheet.tsx) — operan sobre "el"
 * nivel CEFR estándar del alumno dentro de la lista, preservando intactos
 * los demás (personalizados u otros estándar) que ya tuviera.
 */
export function primaryStandardLevel(levels: string[]): string | null {
  return levels.find((level) => STANDARD_CEFR_LEVELS.includes(level)) ?? null;
}

/** Reemplaza la única entrada estándar CEFR presente (si la hay) por `newStandardLevel`, agregándola si no había ninguna — nunca toca niveles personalizados ni otros estándar ya elegidos. */
export function replacePrimaryStandardLevel(levels: string[], newStandardLevel: string): string[] {
  const withoutStandard = levels.filter((level) => !STANDARD_CEFR_LEVELS.includes(level));
  return [newStandardLevel, ...withoutStandard];
}

/** "Tus niveles" cerrada: nombres si entran cómodos, si no la cantidad — nunca un texto tan largo que rompa el layout de la fila. */
export function summarizeSelectedLevelsLabel(names: string[], maxChars = 28): string {
  if (names.length === 0) return '';
  const joined = names.join(', ');
  if (joined.length <= maxChars) return joined;
  return `${names.length} seleccionados`;
}
