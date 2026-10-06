/**
 * Formateador ÚNICO de importes, porcentajes, notas y horas de la web (el de fechas y horarios es `date-format.ts`).
 * Antes cada pantalla armaba el suyo: el mismo importe salía «$ 15.000» en el perfil y «$ 15.000,00» en Cobros, y las
 * horas y notas usaban a veces coma y a veces punto.
 *
 * Reglas (es-AR):
 *  - Importes: pesos con separador de miles y SIN decimales cuando el importe es entero; con dos decimales sólo si hay
 *    centavos («$ 1.234,50»). Un valor ausente o inválido devuelve `fallback`, nunca «$ NaN».
 *  - Decimales con coma («2,5 h», «8,5», «12,5%»); un decimal en horas y notas, sin ceros de relleno en horas.
 *  - Los formateadores de Intl se crean una sola vez y llevan locale fijo: servidor y navegador producen el mismo texto.
 */
const DEFAULT_FALLBACK = "—";

const MONEY_CENTS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY_WHOLE = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const UP_TO_ONE_DECIMAL = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** «$ 15.000», «$ 1.234,50». */
export function formatMoney(amount: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  if (!isFiniteNumber(amount)) return fallback;
  // Con centavos se muestran siempre los dos decimales; un importe redondo nunca lleva «,00».
  return Number.isInteger(amount) ? MONEY_WHOLE.format(amount) : MONEY_CENTS.format(amount);
}

/** «80%», «12,5%»; con `signed`, «+5%» / «-5%». Entero si no tiene decimales. */
export function formatPercent(value: number | null | undefined, options: { signed?: boolean; fallback?: string } = {}): string {
  if (!isFiniteNumber(value)) return options.fallback ?? DEFAULT_FALLBACK;
  const body = Number.isInteger(value) ? WHOLE.format(Math.abs(value)) : UP_TO_ONE_DECIMAL.format(Math.abs(value));
  const sign = value < 0 ? "-" : options.signed && value > 0 ? "+" : "";
  return `${sign}${body}%`;
}

/** Número con hasta un decimal y coma: «2,5», «3». */
export function formatDecimal(value: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  return isFiniteNumber(value) ? UP_TO_ONE_DECIMAL.format(value) : fallback;
}

/** Horas: «3 h», «2,5 h». */
export function formatHours(hours: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  if (!isFiniteNumber(hours)) return fallback;
  return `${UP_TO_ONE_DECIMAL.format(hours)} h`;
}

/** Minutos como horas: 150 → «2,5 h». */
export function formatMinutesAsHours(minutes: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  return isFiniteNumber(minutes) ? formatHours(minutes / 60) : fallback;
}

/** Duración de una clase: «60 min». */
export function formatMinutes(minutes: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  return isFiniteNumber(minutes) ? `${WHOLE.format(minutes)} min` : fallback;
}

/** Nota o promedio con un decimal: «8,0», «9,5». */
export function formatGrade(value: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  return isFiniteNumber(value) ? ONE_DECIMAL.format(value) : fallback;
}

/** Cantidad entera con separador de miles: «1.250». */
export function formatCount(value: number | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  return isFiniteNumber(value) ? WHOLE.format(value) : fallback;
}
