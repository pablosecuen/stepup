// Puerto VERBATIM del original (`src/features/calendar/utils/calendarClassTitle.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
 * clase): validación/normalización puras del título propio de una clase
 * (`CalendarLesson.classTitle`/`RecurrenceRule.classTitle`) — nunca toca
 * `studentName`, `participants` ni ningún dato del alumno. Vive separado
 * de `calendarParticipants.ts` (que sí importa `CalendarLesson`) para
 * quedar mínimo y fácil de reusar tanto desde la UI como desde los planes
 * de mutación.
 */

export const CLASS_TITLE_MAX_LENGTH = 60;

/**
 * Recorta espacios al comienzo y al final. Un resultado vacío significa
 * "sin título personalizado" — nunca se guarda una cadena vacía ni sólo
 * espacios: `undefined` es la única forma válida de "no hay título".
 */
export function normalizeClassTitle(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export interface ClassTitleValidation {
  isValid: boolean;
  error: string | null;
}

/**
 * Válido si, una vez recortado, el texto está vacío (elimina el título) o
 * no supera el límite. Deliberadamente no restringe qué caracteres se
 * pueden usar (letras, números, signos de puntuación normales — nada de
 * eso se rechaza), sólo el largo.
 */
export function validateClassTitleInput(raw: string): ClassTitleValidation {
  const trimmed = raw.trim();
  if (trimmed.length > CLASS_TITLE_MAX_LENGTH) {
    return {
      isValid: false,
      error: `El nombre no puede superar los ${CLASS_TITLE_MAX_LENGTH} caracteres.`,
    };
  }
  return { isValid: true, error: null };
}
