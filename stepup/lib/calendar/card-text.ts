/**
 * Texto de una tarjeta de la grilla según el espacio REAL que tiene — puerto del criterio de la app anterior (`CalendarLessonCard`, modo compacto: primera palabra del nombre,
 * hora de inicio y «Cancel.» en lugar de la hora) y de su fila diaria (hora arriba, nombre abajo). Nunca se oculta un dato: lo que no entra en la tarjeta queda en el nombre accesible y
 * en el cuadro que aparece al pasar el puntero o enfocar con el teclado. PURO.
 */

/** Ancho (px) desde el cual el nombre entra completo; entre `INITIALS_MAX_WIDTH_PX` y este valor entra la primera palabra; por debajo, las iniciales. */
export const FULL_NAME_MIN_WIDTH_PX = 112;
export const INITIALS_MAX_WIDTH_PX = 36;
/** Ancho desde el cual la hora acompaña al nombre en una sola línea. */
export const INLINE_TIME_MIN_WIDTH_PX = 96;

const words = (title: string): string[] => title.trim().split(/\s+/).filter((word) => word !== "");

/** Primera palabra del nombre («Agostina Staffieri» → «Agostina»). */
export function firstWord(title: string): string {
  return words(title)[0] ?? title.trim();
}

/** Dos iniciales (de las dos primeras palabras que empiezan con letra): «Juan Pablo Fernández» → «JP». */
export function initials(title: string): string {
  const letters = words(title)
    .map((word) => Array.from(word).find((character) => /\p{L}/u.test(character)))
    .filter((character): character is string => character !== undefined)
    .slice(0, 2)
    .join("");
  return letters.toLocaleUpperCase("es-AR");
}

/** Cómo se escribe el nombre de la clase en una tarjeta de ese ancho: completo, primera palabra o iniciales. */
export function nameForWidth(title: string, widthPx: number): string {
  if (widthPx >= FULL_NAME_MIN_WIDTH_PX) return title;
  if (widthPx >= INITIALS_MAX_WIDTH_PX) return firstWord(title);
  return initials(title) || firstWord(title);
}

export interface CardStateFacts {
  status: "scheduled" | "cancelled" | "completed" | "rescheduled";
  isElapsed: boolean;
  isActiveReplacement: boolean;
  isInProgress: boolean;
}

/**
 * Texto corto del estado (nunca sólo color): «Cancel.», «Reprog.», «Dictada», «Reemp.», «En curso», «Pasada»; `null` si es una clase programada común. Con `priorityOnly` sólo los
 * estados que cambian lo que la profesora tiene que hacer (cancelada, reprogramada, dictada, reemplazo): «En curso» y «Pasada» ya se ven por la línea de la hora actual y el gris
 * de la escala, y en una tarjeta angosta la hora vale más que repetirlos.
 */
export function compactStateTag(facts: CardStateFacts, priorityOnly = false): string | null {
  if (facts.status === "cancelled") return "Cancel.";
  if (facts.status === "rescheduled") return "Reprog.";
  if (facts.status === "completed") return "Dictada";
  if (facts.isActiveReplacement && !facts.isElapsed) return "Reemp.";
  if (priorityOnly) return null;
  if (facts.isInProgress && !facts.isElapsed) return "En curso";
  if (facts.isElapsed) return "Pasada";
  return null;
}

/**
 * Segunda línea de una tarjeta angosta: el estado importante si lo hay (igual que la app, que muestra «Cancel.» en lugar de la hora) y, si no, la hora de inicio. En una tarjeta
 * ancha se muestran las dos cosas (`wideMeta`).
 */
export function narrowMeta(input: { timeLabel: string; facts: CardStateFacts }): string {
  return compactStateTag(input.facts, true) ?? input.timeLabel;
}

/** Datos de la segunda línea de una tarjeta ancha: hora, quiénes (si es grupal) y estado. */
export function wideMeta(input: { timeLabel: string; groupSize: number | null; tags: string[] }): string {
  const group = input.groupSize && input.groupSize > 1 ? `${input.groupSize} alumnos` : null;
  return [input.timeLabel, group, ...input.tags].filter((part): part is string => Boolean(part)).join(" · ");
}
