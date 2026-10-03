import { addDaysToDateKey, getDateKeyJsDay, getLocalDateKey, getLocalTimeKey, localDateTimeToInstantIso } from "./timezone.ts";

/**
 * Fechas CIVILES del Calendario web. Un día del calendario es una clave
 * `YYYY-MM-DD` (hora de pared de `CALENDAR_TIMEZONE`), nunca un `Date`: un
 * `Date` creado con `new Date(año, mes, día)` en el servidor (UTC en Vercel)
 * cruza la frontera servidor→navegador como un instante UTC y el navegador
 * (Argentina, UTC-3) lo vuelve a leer UN DÍA ANTES. Por eso:
 *
 *  - servidor y cliente intercambian sólo claves civiles (strings);
 *  - la aritmética de días es sobre claves (`addDaysToDateKey`, UTC puro);
 *  - un instante (ISO) se convierte a día/hora civil con la zona explícita;
 *  - una clave se convierte a instante sólo para consultar timestamps
 *    (`dayRangeInstants`), siempre con la zona explícita.
 *
 * Todo es puro y no depende de la zona del proceso (`TZ`) ni del locale/ICU
 * del navegador: servidor y cliente producen exactamente los mismos textos.
 */
export const CALENDAR_TIMEZONE = "America/Argentina/Buenos_Aires";

export const WEEKDAY_SHORT_MONDAY_FIRST = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"] as const;

const WEEKDAY_NAMES_BY_JS_DAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;
// Mismas abreviaturas que producía `toLocaleDateString("es-AR", { month: "short" })`.
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"] as const;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Devuelve la clave si es una fecha civil real (`2026-02-30` no lo es); `null` si no. */
export function parseCivilDateKey(value: string | null | undefined): string | null {
  if (!value || !DATE_KEY.test(value)) return null;
  try {
    addDaysToDateKey(value, 0); // valida con ida y vuelta, sin pasar por la zona del proceso
    return value;
  } catch {
    return null;
  }
}

/** Día civil "hoy" en la zona del calendario para un instante dado. */
export function todayDateKey(now: Date, timeZone: string = CALENDAR_TIMEZONE): string {
  return getLocalDateKey(now.toISOString(), timeZone);
}

/** Día civil de un instante ISO en la zona del calendario. */
export function instantDateKey(iso: string, timeZone: string = CALENDAR_TIMEZONE): string {
  return getLocalDateKey(iso, timeZone);
}

/** Minutos desde las 00:00 civiles de un instante ISO en la zona del calendario. */
export function instantMinutesOfDay(iso: string, timeZone: string = CALENDAR_TIMEZONE): number {
  const [hour, minute] = getLocalTimeKey(iso, timeZone).split(":").map(Number);
  return hour * 60 + minute;
}

/** "HH:mm" (24 h) de un instante ISO en la zona del calendario. */
export function instantTimeLabel(iso: string, timeZone: string = CALENDAR_TIMEZONE): string {
  return getLocalTimeKey(iso, timeZone);
}

/** Lunes (clave civil) de la semana lunes→domingo que contiene `dateKey`. */
export function mondayOfWeek(dateKey: string): string {
  const jsDay = getDateKeyJsDay(dateKey);
  return addDaysToDateKey(dateKey, jsDay === 0 ? -6 : 1 - jsDay);
}

/** Las siete claves civiles lunes→domingo a partir del lunes `weekStartKey`. */
export function weekDateKeys(weekStartKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStartKey, index));
}

/** Posición 0..6 con lunes primero (índice de `WEEKDAY_SHORT_MONDAY_FIRST`). */
export function weekdayIndexMondayFirst(dateKey: string): number {
  const jsDay = getDateKeyJsDay(dateKey);
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}

/**
 * Instantes que cubren de las 00:00:00.000 de `firstKey` hasta el último
 * milisegundo de `lastKey` (incluido todo el domingo), en la zona explícita.
 */
export function dayRangeInstants(firstKey: string, lastKey: string, timeZone: string = CALENDAR_TIMEZONE): { startIso: string; endIso: string } {
  const startIso = localDateTimeToInstantIso({ date: firstKey, hour: 0, minute: 0, timeZone });
  const nextDayStartIso = localDateTimeToInstantIso({ date: addDaysToDateKey(lastKey, 1), hour: 0, minute: 0, timeZone });
  return { startIso, endIso: new Date(Date.parse(nextDayStartIso) - 1).toISOString() };
}

export type CalendarView = "week" | "day";

export interface CalendarWindow {
  view: CalendarView;
  todayKey: string;
  /** Lunes de la semana pedida (o la actual). */
  weekStartKey: string;
  /** Día pedido (o hoy), usado por la vista de día. */
  dayKey: string;
  /** Las 7 claves de la semana, o la única del día. */
  dayKeys: string[];
  previousKey: string;
  nextKey: string;
  rangeStartIso: string;
  rangeEndIso: string;
}

/**
 * Resuelve todo lo que necesita la página del Calendario a partir de los
 * parámetros de la URL y del instante actual. Un `week`/`day` inválido cae a
 * hoy; un `week` que no es lunes se normaliza al lunes de su semana.
 */
export function resolveCalendarWindow(params: { view?: string; week?: string; day?: string }, now: Date, timeZone: string = CALENDAR_TIMEZONE): CalendarWindow {
  const view: CalendarView = params.view === "day" ? "day" : "week";
  const todayKey = todayDateKey(now, timeZone);
  const weekStartKey = mondayOfWeek(parseCivilDateKey(params.week) ?? todayKey);
  const dayKey = parseCivilDateKey(params.day) ?? todayKey;
  const dayKeys = view === "week" ? weekDateKeys(weekStartKey) : [dayKey];
  const { startIso, endIso } = dayRangeInstants(dayKeys[0], dayKeys[dayKeys.length - 1], timeZone);

  return {
    view,
    todayKey,
    weekStartKey,
    dayKey,
    dayKeys,
    previousKey: view === "week" ? addDaysToDateKey(weekStartKey, -7) : addDaysToDateKey(dayKey, -1),
    nextKey: view === "week" ? addDaysToDateKey(weekStartKey, 7) : addDaysToDateKey(dayKey, 1),
    rangeStartIso: startIso,
    rangeEndIso: endIso,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function keyParts(dateKey: string): { year: number; month: number; day: number; jsDay: number } {
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)), day: Number(dateKey.slice(8, 10)), jsDay: getDateKeyJsDay(dateKey) };
}

/** Rótulo del encabezado semanal: "28 - 04-oct de octubre de 2026" (mismo formato que antes, sin Intl). */
export function formatWeekRangeLabel(weekStartKey: string): string {
  const start = keyParts(weekStartKey);
  const end = keyParts(addDaysToDateKey(weekStartKey, 6));
  const endLabel = start.month === end.month ? twoDigits(end.day) : `${twoDigits(end.day)}-${MONTH_SHORT[end.month - 1]}`;
  return `${twoDigits(start.day)} - ${endLabel} de ${MONTH_NAMES[end.month - 1]} de ${end.year}`;
}

/** "sábado, 3 de octubre de 2026". */
export function formatCivilDayLabel(dateKey: string): string {
  const { year, month, day, jsDay } = keyParts(dateKey);
  return `${WEEKDAY_NAMES_BY_JS_DAY[jsDay]}, ${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
}

/** "sábado, 3 de octubre" (sin año). */
export function formatCivilDayLabelShort(dateKey: string): string {
  const { month, day, jsDay } = keyParts(dateKey);
  return `${WEEKDAY_NAMES_BY_JS_DAY[jsDay]}, ${day} de ${MONTH_NAMES[month - 1]}`;
}
