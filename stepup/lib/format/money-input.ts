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

/** Un importe guardado, listo para mostrarse en un campo de texto y volver a leerse sin cambiar de valor: «36000», «36000,5» → «36000,50». */
export function formatMoneyForInput(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  if (Number.isInteger(amount)) return String(amount);
  const cents = Math.round(Math.abs(amount) * 100);
  return `${amount < 0 ? "-" : ""}${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}
