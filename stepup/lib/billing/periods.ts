import { CALENDAR_TIMEZONE } from "../calendar/civil-calendar.ts";
import { addDaysToDateKey, getLocalDateKey, localDateTimeToInstantIso } from "../calendar/timezone.ts";

/**
 * Aritmética de períodos y de gracia en FECHAS CIVILES de Argentina. Nunca el día que sale de recortar un `toISOString()` (eso es el
 * día en UTC: entre las 21:00 y las 24:00 de Argentina ya es «mañana»). Todo pasa por `CALENDAR_TIMEZONE` con las utilidades que
 * ya usa el calendario; un día civil se convierte a instante sólo con la zona explícita.
 *
 * Un período pagado es [inicio, fin): el fin es EXCLUSIVO y siempre cae a las 00:00 (hora de Argentina) de un día civil.
 */
export const BILLING_TIME_ZONE = CALENDAR_TIMEZONE;

/** Días corridos de gracia después de un vencimiento rechazado. */
export const GRACE_DAYS = 5;

function parseKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Fecha civil inválida: ${dateKey}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) throw new RangeError(`Fecha civil inválida: ${dateKey}`);
  return parts;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Suma meses a una fecha civil; si el día no existe en el mes de destino se usa el último (31/01 + 1 mes = 28/02 o 29/02). */
export function addMonthsToDateKey(dateKey: string, months: number): string {
  if (!Number.isInteger(months) || months < 0) throw new RangeError("Cantidad de meses inválida.");
  const { year, month, day } = parseKey(dateKey);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/**
 * Las conversiones de zona horaria (`Intl.DateTimeFormat`) son lo más caro del cálculo de períodos, y un lote de renovaciones repite
 * los mismos instantes y días miles de veces (todas las cuentas vencen el mismo día). Son funciones PURAS: se memorizan con un tope
 * (al llegar al límite se vacía el cache) para que el costo no dependa de la cantidad de cuentas.
 */
const MEMO_LIMIT = 20_000;
const dayStartCache = new Map<string, string>();
const dayOfCache = new Map<string, string>();

function memoized(cache: Map<string, string>, key: string, compute: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size >= MEMO_LIMIT) cache.clear();
  const value = compute();
  cache.set(key, value);
  return value;
}

/** Instante de las 00:00 (Argentina) de un día civil. */
export function civilDayStartIso(dateKey: string): string {
  return memoized(dayStartCache, dateKey, () => localDateTimeToInstantIso({ date: dateKey, hour: 0, minute: 0, timeZone: BILLING_TIME_ZONE }));
}

/** Día civil (Argentina) de un instante. */
export function civilDayOf(instantIso: string): string {
  return memoized(dayOfCache, instantIso, () => getLocalDateKey(instantIso, BILLING_TIME_ZONE));
}

/**
 * Período que compra un cobro aprobado, anclado al día civil de su vencimiento: [00:00 del día de vencimiento, 00:00 del mismo
 * día `months` meses después). Cada cobro calcula el suyo con sus propios datos, así el resultado no depende del orden en que
 * llegaron los avisos.
 */
export function coverageOf(dueAtIso: string, months: number): { startIso: string; endIso: string } {
  const startKey = civilDayOf(dueAtIso);
  return { startIso: civilDayStartIso(startKey), endIso: civilDayStartIso(addMonthsToDateKey(startKey, months)) };
}

/**
 * Fin (exclusivo) de la gracia de un vencimiento rechazado: el vencimiento cae el día civil D; la gracia cubre los días D+1 a
 * D+5 completos y el modo limitado empieza a las 00:00 de D+6.
 */
export function graceEndsAtFor(dueAtIso: string): string {
  return civilDayStartIso(addDaysToDateKey(civilDayOf(dueAtIso), GRACE_DAYS + 1));
}
