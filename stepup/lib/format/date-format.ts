import { CALENDAR_TIMEZONE, instantDateKey, instantTimeLabel, parseCivilDateKey, todayDateKey } from "../calendar/civil-calendar.ts";
import { addDaysToDateKey, getDateKeyJsDay } from "../calendar/timezone.ts";

/**
 * Formateador ÚNICO de fechas y horas de la web. Todo se muestra en la hora de pared de Argentina
 * (`America/Argentina/Buenos_Aires`), nunca en la zona del proceso: en Vercel el servidor corre en UTC, así que un
 * `toLocaleDateString("es-AR")` sin `timeZone` mostraba el día siguiente (y la hora +3) a toda clase de la noche
 * argentina, y el navegador (UTC-3) renderizaba otro texto que el servidor (error de hidratación).
 *
 * Reglas:
 *  - Un instante (ISO) se pasa a día/hora civil con la zona explícita (`instantDateKey`/`instantTimeLabel`).
 *  - Un día civil (`YYYY-MM-DD`: vencimientos, altas, períodos) NUNCA pasa por `Date`: se reordena como texto.
 *  - Formato de fecha: día/mes/año ("05/10/2026"); hora: 24 h ("18:00").
 *  - Los nombres de días y meses salen de tablas propias, no del ICU de cada navegador: servidor y cliente producen
 *    exactamente los mismos textos (mismas abreviaturas que daba `es-AR`: "lun, 5 oct", "mié, 30 sept").
 *  - Un valor ausente o inválido devuelve `fallback`, nunca "Invalid Date" ni una fecha inventada.
 */
export const DISPLAY_TIME_ZONE = CALENDAR_TIMEZONE;

const DEFAULT_FALLBACK = "—";
const DATE_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
// Mes civil "YYYY-MM": mes 01-12 exacto (nunca "2026-9", "2026-13" ni una fecha completa).
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const WEEKDAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"] as const;
const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

// Instante con ZONA explícita: "2026-10-05T00:30:00Z", "2026-10-05T00:30:00.123+00:00" o el formato de PostgREST/Postgres
// "2026-10-05 00:30:00+00". Sin zona ("2026-10-05T10:00") o con otro formato ("2026-10-5") NO se interpreta: `new Date` lo
// leería en la zona del proceso (otra vez el mismo error), así que se rechaza y se muestra el texto de reemplazo.
const INSTANT_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** El instante como `Date` (UTC real), o `null` si el valor no es un instante válido con zona. */
function toInstant(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (!INSTANT_WITH_ZONE.test(value)) return null;
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Día civil (en Argentina) de un instante, o `null` si no es un instante válido. */
function civilKeyOfInstant(value: string | Date | null | undefined): string | null {
  const date = toInstant(value);
  return date ? instantDateKey(date.toISOString()) : null;
}

function parts(dateKey: string): { year: string; month: number; day: number; weekday: number } {
  return { year: dateKey.slice(0, 4), month: Number(dateKey.slice(5, 7)), day: Number(dateKey.slice(8, 10)), weekday: getDateKeyJsDay(dateKey) };
}

/** "05/10/2026" a partir de una clave civil `YYYY-MM-DD` (sin `Date`, sin zona). */
export function formatCivilDate(dateKey: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = parseCivilDateKey(dateKey);
  if (!key) return fallback;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

/** "01/10/2026 a 31/10/2026". Si falta cualquiera de los dos extremos, `fallback`. */
export function formatCivilDateRange(start: string | null | undefined, end: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const from = parseCivilDateKey(start);
  const to = parseCivilDateKey(end);
  if (!from || !to) return fallback;
  return `${formatCivilDate(from)} a ${formatCivilDate(to)}`;
}

/** "12/10" (día/mes, sin año) a partir de una clave civil `YYYY-MM-DD` — para rótulos cortos como "desde 12/10". Sin `Date`, sin zona. */
export function formatCivilDayMonth(dateKey: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = parseCivilDateKey(dateKey);
  if (!key) return fallback;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/** "septiembre de 2026" a partir de un mes civil `YYYY-MM` (sin `Date`, sin zona). Cualquier otra cosa → `fallback`. */
export function formatCivilMonth(value: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const match = value ? MONTH_KEY.exec(value) : null;
  if (!match) return fallback;
  return `${MONTH_LONG[Number(match[2]) - 1]} de ${match[1]}`;
}

/**
 * Rango de días civiles, sin repetir lo que no cambia: "5 – 11 oct 2026", "28 sept – 4 oct 2026" y, si cruza de año,
 * "28 dic 2026 – 3 ene 2027". Extremos `YYYY-MM-DD`; si alguno es inválido o el fin es anterior al inicio → `fallback`.
 */
export function formatCivilDayRange(start: string | null | undefined, end: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const from = parseCivilDateKey(start);
  const to = parseCivilDateKey(end);
  if (!from || !to || to < from) return fallback;
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${a.day} ${MONTH_SHORT[a.month - 1]} ${a.year}`;
  if (a.year !== b.year) return `${a.day} ${MONTH_SHORT[a.month - 1]} ${a.year} – ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${MONTH_SHORT[a.month - 1]} – ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`;
  return `${a.day} – ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`;
}

/** Encabezado semanal del Calendario: la semana de siete días que empieza en `weekStartKey` (ver `formatCivilDayRange`). */
export function formatCivilWeek(weekStartKey: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const start = parseCivilDateKey(weekStartKey);
  if (!start) return fallback;
  return formatCivilDayRange(start, addDaysToDateKey(start, 6), fallback);
}

/**
 * Para campos que pueden traer una clave civil o un instante (p. ej. `paidAt`): una clave se reordena tal cual; un
 * instante se convierte a su día en Argentina.
 */
export function formatDateValue(value: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  if (!value) return fallback;
  if (DATE_KEY_SHAPE.test(value)) return formatCivilDate(value, fallback);
  return formatInstantDate(value, fallback);
}

/** "05/10/2026" — el día en Argentina de un instante. */
export function formatInstantDate(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = civilKeyOfInstant(value);
  return key ? formatCivilDate(key, fallback) : fallback;
}

/** "18:00" (24 h) — la hora en Argentina de un instante. */
export function formatInstantTime(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const date = toInstant(value);
  return date ? instantTimeLabel(date.toISOString()) : fallback;
}

/** "05/10/2026 18:00". */
export function formatInstantDateTime(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  if (civilKeyOfInstant(value) === null) return fallback;
  return `${formatInstantDate(value)} ${formatInstantTime(value)}`;
}

/** "lun, 5 oct" — para listas compactas (Inicio, Registro, Recordatorios). */
export function formatInstantDayShort(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = civilKeyOfInstant(value);
  if (!key) return fallback;
  const { month, day, weekday } = parts(key);
  return `${WEEKDAY_SHORT[weekday]}, ${day} ${MONTH_SHORT[month - 1]}`;
}

/** "lunes, 5 de octubre" (sin año). */
export function formatInstantDayLong(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = civilKeyOfInstant(value);
  if (!key) return fallback;
  const { month, day, weekday } = parts(key);
  return `${WEEKDAY_LONG[weekday]}, ${day} de ${MONTH_LONG[month - 1]}`;
}

/** "lunes, 5 de octubre, 18:00". */
export function formatInstantDayLongTime(value: string | Date | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const key = civilKeyOfInstant(value);
  if (!key) return fallback;
  return `${formatInstantDayLong(value)}, ${formatInstantTime(value)}`;
}

/** Día civil de "hoy" en Argentina — nunca el recorte de `toISOString()`, que es el día en UTC (un día de más desde las 21:00). */
export function todayInArgentina(now: Date = new Date()): string {
  return todayDateKey(now);
}
