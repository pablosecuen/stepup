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


/**
 * Semana en el teléfono: el nombre se escribe SIEMPRE en texto horizontal y completo (nunca girado ni partido por sílabas). Una tarjeta baja (una línea) lleva la primera palabra; una de 38 px
 * o más de alto lleva las dos primeras palabras («Juan Pablo», «Grupo B2»), cada una en su línea si no entran juntas. El ancho que necesita el carril sale de la palabra más larga que se va a ver.
 */
export const TWO_NAME_LINES_MIN_HEIGHT_PX = 38;
/** Piso y techo del ancho de un carril (px): por debajo de 40 no entra ni una palabra corta con su margen; por encima de 92 el nombre se acorta con «…» en vez de ensanchar más la columna. */
export const LANE_MIN_PX = 40;
export const LANE_MAX_PX = 92;
/** Lo que gasta una tarjeta de la semana del teléfono fuera del texto: franja izquierda de 3 px, borde derecho de 1 px y 3 px de margen a cada lado, más 2 px de holgura. */
const CARD_CHROME_PX = 12;

/** Palabras que se muestran en la tarjeta de la semana del teléfono según su alto. */
export function mobileNameWords(title: string, heightPx: number): string[] {
  return words(title).slice(0, heightPx >= TWO_NAME_LINES_MIN_HEIGHT_PX ? 2 : 1);
}

/** Letra del nombre en la semana del teléfono: 10,5 px siempre (nunca menos de 10: la columna se ensancha para que el nombre entre, en vez de achicar la letra). */
export function mobileNameFontPx(shown: readonly string[]): number {
  void shown;
  return 10.5;
}

const NARROW_GLYPHS = new Set(Array.from("iljtfrI.,'’:;!|1"));
const WIDE_GLYPHS = new Set(Array.from("mwMW@"));

/** Ancho estimado (px) de un texto en negrita de ese tamaño: letras angostas (i, l, t…), anchas (m, w) y mayúsculas; algo generoso a propósito, porque quedarse corto corta la palabra. */
export function estimateBoldTextWidthPx(text: string, fontPx: number): number {
  let em = 0;
  for (const character of Array.from(text)) {
    if (NARROW_GLYPHS.has(character)) em += 0.32;
    else if (WIDE_GLYPHS.has(character)) em += 0.9;
    else if (character === character.toLocaleUpperCase("es-AR") && character !== character.toLocaleLowerCase("es-AR")) em += 0.68;
    else if (character === " ") em += 0.3;
    else em += 0.6;
  }
  return em * fontPx;
}

/**
 * Tarjeta de UNA línea (clases de menos de 27 px de alto: las cortas): además del nombre lleva, adelante, la hora de inicio o el estado importante («Cancel.», «Reprog.», «Reemp.») cuando el carril
 * es lo bastante ancho. En el teléfono la columna se ensancha para que entre; en escritorio decide el ancho que ya tiene el carril. Mismo cálculo en la grilla y en la tarjeta.
 */
export const SINGLE_LINE_BELOW_HEIGHT_PX = 27;
/** Letra de la hora o del estado en la línea de un solo renglón. */
export const INLINE_META_FONT_PX = 10;
const INLINE_META_GAP_PX = 4;
/** Techo del ancho de un carril de una línea con hora o estado: más que eso el nombre vale más que el dato y el dato queda en el eje de horas y en el cuadro de información. */
export const LANE_MAX_WITH_META_PX = 124;
/** Ícono de grupo/entrenamiento de una tarjeta de una línea: 10 px de ícono y 4 de separación. */
export const SINGLE_LINE_ICON_PX = 14;

/** Ancho estimado del dato (hora o estado): los dígitos miden lo mismo entre sí (cifras tabulares), así que «11:30» no es más angosto que «09:00». */
function estimateMetaWidthPx(meta: string, fontPx: number): number {
  let em = 0;
  for (const character of Array.from(meta)) em += /[0-9]/.test(character) ? 0.64 : character === ":" ? 0.32 : estimateBoldTextWidthPx(character, 1);
  return em * fontPx;
}

/** Ancho (px) que necesita una línea «dato + nombre» con la letra dada, incluidos los márgenes de la tarjeta. */
export function inlineMetaNeedPx(nameWords: readonly string[], nameFontPx: number, meta: string, chromePx: number = CARD_CHROME_PX): number {
  const widest = Math.max(0, ...nameWords.map((word) => estimateBoldTextWidthPx(word, nameFontPx)));
  return Math.ceil(estimateMetaWidthPx(meta, INLINE_META_FONT_PX) + INLINE_META_GAP_PX + widest + chromePx);
}

/** Ancho mínimo (px) del carril que muestra este nombre sin cortar ninguna palabra y, en las tarjetas de una línea, con su hora o estado si entran dentro de `LANE_MAX_WITH_META_PX`. */
export function mobileLaneNeedPx(title: string, heightPx: number, meta?: string, iconPx = 0): number {
  const shown = mobileNameWords(title, heightPx);
  const fontPx = mobileNameFontPx(shown);
  const widest = Math.max(0, ...shown.map((word) => estimateBoldTextWidthPx(word, fontPx)));
  // `iconPx`: el ícono de grupo/entrenamiento va delante del nombre sólo en las tarjetas de una línea.
  const singleLine = heightPx < SINGLE_LINE_BELOW_HEIGHT_PX;
  const extra = singleLine ? iconPx : 0;
  const nameOnly = Math.min(LANE_MAX_PX, Math.max(LANE_MIN_PX, Math.ceil(widest + CARD_CHROME_PX + extra)));
  if (!meta || !singleLine) return nameOnly;
  const withMeta = inlineMetaNeedPx(shown, fontPx, meta, CARD_CHROME_PX + extra);
  return withMeta <= LANE_MAX_WITH_META_PX ? Math.max(nameOnly, withMeta) : nameOnly;
}
/** Escritorio: lo que gastan los márgenes de una tarjeta (borde, relleno y separación) y el ícono de grupo/entrenamiento, que va delante del nombre en los carriles que lo permiten. */
const DESKTOP_CARD_CHROME_PX = 18;
const DESKTOP_ICON_PX = 14;
const DESKTOP_NAME_FONT_PX = 11;
export const DESKTOP_LANE_MAX_PX = 150;

/** Ancho mínimo (px) de un carril de escritorio para que se lea al menos la primera palabra del nombre entera (en los carriles angostos la tarjeta muestra la primera palabra). */
export function desktopLaneNeedPx(title: string, hasIcon: boolean): number {
  const word = firstWord(title);
  return Math.min(DESKTOP_LANE_MAX_PX, Math.ceil(estimateBoldTextWidthPx(word, DESKTOP_NAME_FONT_PX) + DESKTOP_CARD_CHROME_PX + (hasIcon ? DESKTOP_ICON_PX : 0)));
}
