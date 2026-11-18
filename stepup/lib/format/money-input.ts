/**
 * Importes escritos por la profesora (tarifa del alumno, pagos, cuota de entrenamiento). UNA sola interpretación, estricta, para el navegador y el servidor:
 *   - sólo dígitos: «36000»;
 *   - punto SÓLO como separador de miles, en grupos de 3: «36.000», «1.234.567»;
 *   - coma SÓLO como decimal, con 1 o 2 dígitos: «36000,50», «36.000,5»;
 *   - se admiten un «$» inicial y espacios («$ 36.000»).
 * Nada más se acepta ni se «adivina». Un texto que se podría leer de dos maneras (p. ej. «36.5», «36,000», «1,234.56») se RECHAZA como ambiguo en lugar de elegir una lectura:
 * el fallo que motivó esto fue un campo numérico del navegador que aceptaba «36.000», lo leía como 36 y guardaba $36 en silencio. PURO (sin React ni alias `@/`).
 */
export type MoneyParseResult = { amount: number } | { error: string; reason: "vacio" | "invalido" | "ambiguo" };

const MAX_AMOUNT = 1_000_000_000;

export const MONEY_FORMAT_HELP = "Usá solo números: 36000 o 36.000 (punto para los miles) y coma para los decimales (36.000,50).";

export function parseMoneyInput(raw: string | null | undefined): MoneyParseResult {
  const text = (raw ?? "").replace(/ /g, " ").trim().replace(/^\$\s*/, "").replace(/\s+/g, "");
  if (text === "") return { error: "Ingresá un importe.", reason: "vacio" };

  const finish = (digits: string): MoneyParseResult => {
    const amount = Math.round(Number(digits) * 100) / 100;
    return Number.isFinite(amount) && amount < MAX_AMOUNT ? { amount } : { error: `El importe no es válido. ${MONEY_FORMAT_HELP}`, reason: "invalido" };
  };

  if (/^\d+$/.test(text)) return finish(text);
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return finish(text.replace(/\./g, ""));
  if (/^(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(text)) return finish(text.replace(/\./g, "").replace(",", "."));

  // Se podría leer de dos maneras: se pide escribirlo sin ambigüedad.
  const ambiguous =
    /^\d+\.\d{1,2}$/.test(text) || // 36.5 · 36.50 (¿decimal con punto o miles incompletos?)
    /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) || // 36,000 · 1,234.56 (formato en inglés)
    /^\d+\.\d{3,}$/.test(text) || // 1000.000 · 36.0000 (puntos mal agrupados)
    /^\d+,\d{3}$/.test(text); // 36000,000
  if (ambiguous) return { error: `No se entiende si «${text}» lleva punto de miles o decimales. ${MONEY_FORMAT_HELP}`, reason: "ambiguo" };
  return { error: `El importe no es válido. ${MONEY_FORMAT_HELP}`, reason: "invalido" };
}

/** Agrupa una cadena de dígitos de a tres con punto: «3600» → «3.600», «3600000» → «3.600.000». Sin dígitos devuelve «». */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Un importe guardado, listo para mostrarse en un campo de texto y volver a leerse SIN cambiar de valor: «36000» → «36.000», «36000,5» → «36.000,50», «3» → «3».
 * Es sólo el texto que se ve; el valor numérico que viaja al servidor sale siempre de `parseMoneyInput` (punto = miles, coma = decimales).
 */
export function formatMoneyForInput(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = groupThousands(String(Math.floor(cents / 100)));
  const decimals = cents % 100;
  return `${amount < 0 ? "-" : ""}${whole}${decimals === 0 ? "" : `,${String(decimals).padStart(2, "0")}`}`;
}

export interface MoneyTypingResult {
  /** Texto que debe mostrar el campo. */
  text: string;
  /** Posición del cursor dentro de `text`. */
  caret: number;
}

const STRICT_GROUPED = /^(\d*|\d{1,3}(\.\d{3})+)(,\d{0,2})?$/;
const CLEAN_CHAR = /^[0-9.,$\s]*$/;

/** Cuántos caracteres «significativos» (dígitos y coma) hay antes de `caret`: el punto es sólo adorno y el $ o los espacios se descartan. */
function significantBefore(text: string, caret: number): number {
  let count = 0;
  for (let index = 0; index < Math.min(caret, text.length); index += 1) if (/[0-9,]/.test(text[index])) count += 1;
  return count;
}

/** Posición justo después del `count`-ésimo carácter significativo de `text` (0 si `count` es 0). */
function caretAfterSignificant(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/[0-9,]/.test(text[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}

/**
 * Formato mientras se escribe, sin esperar al guardado: «360000» → «360.000», «36000,5» → «36.000,5». `previous` es lo que mostraba el campo, `next` lo que quedó tras la tecla o el pegado y
 * `caret` la posición del cursor en `next`. Mantiene el cursor junto a los mismos dígitos aunque se corrija en el medio.
 *
 * NO adivina: los puntos que puso el propio campo son adorno y se recalculan, pero un punto escrito o pegado por la usuaria que no sea un separador de miles válido («36.5», «1,234.56») se deja
 * tal cual para que `parseMoneyInput` lo rechace como ambiguo. Una tecla que no puede formar un importe (una letra, una tercera cifra decimal) se ignora; un pegado raro se deja sin tocar.
 */
export function formatMoneyTyping(previous: string, next: string, caret: number): MoneyTypingResult {
  const untouched: MoneyTypingResult = { text: next, caret };
  if (next === "") return { text: "", caret: 0 };

  // Qué cambió respecto de lo que había: prefijo y sufijo comunes (acotados para no cruzarse).
  let prefix = 0;
  const limit = Math.min(previous.length, next.length);
  while (prefix < limit && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  const inserted = next.slice(prefix, next.length - suffix);
  const rejectKey = (): MoneyTypingResult => ({ text: previous, caret: Math.max(0, Math.min(previous.length, caret - inserted.length)) });

  if (!CLEAN_CHAR.test(inserted)) return inserted.length === 1 ? rejectKey() : untouched;

  const cleaned = next.replace(/[$\s]/g, "");
  const sigBefore = significantBefore(next, caret);
  const commaAt = cleaned.indexOf(",");
  const hasComma = commaAt >= 0;
  const left = hasComma ? cleaned.slice(0, commaAt) : cleaned;
  const right = hasComma ? cleaned.slice(commaAt + 1) : "";
  if (right.includes(",")) return inserted.length === 1 ? rejectKey() : untouched;

  const strict = STRICT_GROUPED.test(cleaned);
  if (!strict) {
    // Un punto recién escrito o pegado que no agrupa miles, o un texto que ya traía puntos sueltos: no se reinterpreta.
    if (inserted.includes(".")) return untouched;
    const previousClean = STRICT_GROUPED.test(previous.replace(/[$\s]/g, ""));
    if (!previousClean) return untouched;
  }
  const digits = left.replace(/\./g, "");
  if (!/^\d*$/.test(digits) || !/^\d*$/.test(right)) return untouched;
  if (right.length > 2) return inserted.length === 1 ? rejectKey() : untouched;

  // Ceros a la izquierda: «05» → «5»; «,5» → «0,5». Los ceros quitados antes del cursor no cuentan.
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  const removedZeros = digits.length - trimmed.length;
  let body = trimmed;
  let count = Math.max(0, sigBefore - Math.min(removedZeros, sigBefore));
  if (body === "" && hasComma) {
    body = "0";
    if (count > 0) count += 1;
  }
  const text = `${groupThousands(body)}${hasComma ? `,${right}` : ""}`;
  return { text, caret: caretAfterSignificant(text, count) };
}

/** Al salir del campo: una coma sin decimales («36.000,») se quita; todo lo demás queda como está. */
export function normalizeMoneyOnBlur(text: string): string {
  return /^[\d.]+,$/.test(text) ? text.slice(0, -1) : text;
}
