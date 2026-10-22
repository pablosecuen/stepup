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
  if (facts.isActiveReplacement && !facts.isElapsed && facts.status !== "completed") return "Reemp.";
  // «Dictada» (clase ya registrada) ya se ve por el gris de la escala y se dice completo en la tarjeta ancha: en una angosta la hora vale más (como en la app).
  if (priorityOnly) return null;
  if (facts.status === "completed") return "Dictada";
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

const VOWELS = new Set(Array.from("aeiouáéíóúüAEIOUÁÉÍÓÚÜ"));
const STRONG = new Set(Array.from("aeoáéóíúAEOÁÉÓÍÚ"));
const ACCENTED_WEAK = new Set(Array.from("íúÍÚ"));
const INSEPARABLE = new Set(["pl", "pr", "bl", "br", "fl", "fr", "gl", "gr", "cl", "cr", "dr", "tr", "kr", "kl", "ch", "ll", "rr"]);
const SOFT_HYPHEN = "\u00AD";

/** ¿La letra en esa posición suena como vocal? La «u» de «qu» y de «gu» antes de e/i es muda (parte del dígrafo): «Joaquín», «Guillermo». */
function isVowelAt(letters: string[], index: number): boolean {
  const letter = letters[index];
  if (!VOWELS.has(letter)) return false;
  if (letter.toLowerCase() === "u") {
    const before = letters[index - 1]?.toLowerCase();
    const after = letters[index + 1]?.toLowerCase();
    if (before === "q") return false;
    if (before === "g" && after !== undefined && "eéiíy".includes(after)) return false;
  }
  return true;
}

/** ¿Las dos vocales seguidas forman un diptongo (una sola sílaba)? Dos fuertes («le-o») o una débil acentuada («rí-o») hacen hiato. */
function isDiphthong(a: string, b: string): boolean {
  if (ACCENTED_WEAK.has(a) || ACCENTED_WEAK.has(b)) return false;
  return !(STRONG.has(a) && STRONG.has(b));
}

/** Sílabas de una palabra en español (regla práctica: diptongos, grupos de consonantes inseparables y «una consonante pasa a la sílaba siguiente»). */
export function syllablesEs(word: string): string[] {
  const letters = Array.from(word);
  const syllables: string[] = [];
  let current = "";
  let index = 0;
  while (index < letters.length) {
    current += letters[index];
    const isVowel = isVowelAt(letters, index);
    const next = letters[index + 1];
    if (isVowel && next !== undefined) {
      if (isVowelAt(letters, index + 1)) {
        // vocal + vocal: sigue la misma sílaba si es diptongo; si no, hay hiato y se corta acá
        if (!isDiphthong(letters[index], next)) {
          syllables.push(current);
          current = "";
        }
      } else {
        // vocal + consonantes + vocal: se reparten los grupos de consonantes
        let end = index + 1;
        while (end < letters.length && !isVowelAt(letters, end)) end++;
        // «qu» y «gu» (e/i) cuentan como UNA consonante.
        const cluster: string[] = [];
        for (let k = index + 1; k < end; k++) {
          if ("qgQG".includes(letters[k]) && k + 1 < end && letters[k + 1].toLowerCase() === "u") {
            cluster.push(letters[k] + letters[k + 1]);
            k++;
          } else cluster.push(letters[k]);
        }
        if (end < letters.length && cluster.length > 0) {
          let keep = 0; // cuántas consonantes (unidades) se quedan en esta sílaba
          if (cluster.length === 2) keep = INSEPARABLE.has(cluster.join("").toLowerCase()) ? 0 : 1;
          else if (cluster.length === 3) keep = INSEPARABLE.has(cluster.slice(1).join("").toLowerCase()) ? 1 : 2;
          else if (cluster.length >= 4) keep = 2;
          const kept = cluster.slice(0, keep).join("");
          current += kept;
          syllables.push(current);
          current = "";
          index += Array.from(kept).length;
        }
      }
    }
    index++;
  }
  if (current) syllables.push(current);
  return syllables;
}

/**
 * La palabra con guiones blandos entre sílabas (invisibles salvo donde el navegador corta la línea: ahí aparece el guion): «Guadalupe» → «Gua-da-lu-pe». Una tarjeta de 40 px de ancho puede
 * partir un nombre largo en dos líneas sin dejar una letra suelta: no se corta después de la primera ni antes de la última si esa sílaba tiene una sola letra.
 */
export function softHyphenateEs(word: string): string {
  const parts = syllablesEs(word);
  if (parts.length < 2) return word;
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && (merged[merged.length - 1].length < 2 || part.length < 2)) merged[merged.length - 1] += part;
    else merged.push(part);
  }
  return merged.join(SOFT_HYPHEN);
}