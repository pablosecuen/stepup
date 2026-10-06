/**
 * Puerto exacto de `paymentDates.ts` (móvil) — utilidades de fecha del
 * dominio de Cobros, deliberadamente separadas de `lib/calendar/timezone.ts`
 * (mismo criterio que el móvil: el motor de cobros no depende de decisiones
 * internas del módulo de calendario). Todo acá opera sobre "date keys"
 * YYYY-MM-DD ya resueltos, en aritmética UTC pura — ninguna función vuelve a
 * tocar zona horaria una vez resuelto el date key.
 */

import { instantDateKey } from "../calendar/civil-calendar.ts";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function assertDateKey(value: string, label: string): void {
  if (!isValidDateKey(value)) {
    throw new RangeError(`${label} debe tener el formato YYYY-MM-DD (recibido: formato inválido).`);
  }
}

/** Días transcurridos de `from` a `to` (positivo si `to` es posterior). */
export function daysBetweenDateKeys(from: string, to: string): number {
  assertDateKey(from, "from");
  assertDateKey(to, "to");
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  assertDateKey(dateKey, "dateKey");
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

const BILLING_PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;

export function isValidBillingPeriod(value: string): boolean {
  const match = BILLING_PERIOD_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function assertBillingPeriod(value: string): void {
  if (!isValidBillingPeriod(value)) {
    throw new RangeError("billingPeriod debe tener el formato YYYY-MM con un mes entre 01 y 12.");
  }
}

/** Último día REAL de un período 'YYYY-MM' (28/29 en febrero, 30/31 según el mes) — nunca asumir 31. */
export function lastDayOfBillingPeriod(billingPeriod: string): number {
  assertBillingPeriod(billingPeriod);
  const [year, month] = billingPeriod.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Un día de mes (1-31) configurado se recorta al último día real de ese período específico — nunca error, nunca "mes siguiente". */
export function clampDayToBillingPeriod(day: number, billingPeriod: string): number {
  return Math.min(day, lastDayOfBillingPeriod(billingPeriod));
}

export function firstDayOfBillingPeriod(billingPeriod: string): string {
  assertBillingPeriod(billingPeriod);
  return `${billingPeriod}-01`;
}

export function lastDateKeyOfBillingPeriod(billingPeriod: string): string {
  const day = lastDayOfBillingPeriod(billingPeriod);
  return `${billingPeriod}-${String(day).padStart(2, "0")}`;
}

/** `true` si `dateKey` cae sábado o domingo. Sin calendario de feriados — no existe ese concepto en el proyecto. */
export function isWeekendDateKey(dateKey: string): boolean {
  assertDateKey(dateKey, "dateKey");
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=domingo, 6=sábado
  return weekday === 0 || weekday === 6;
}

/** El primer día hábil (lunes a viernes) a partir de `dateKey`, inclusive. */
export function nextBusinessDay(dateKey: string): string {
  let candidate = dateKey;
  while (isWeekendDateKey(candidate)) {
    candidate = addDaysToDateKey(candidate, 1);
  }
  return candidate;
}

/**
 * Única fuente que resuelve el vencimiento real de una mensualidad a partir
 * de `dueDay` (1-28) y el período — nunca `firstDayOfBillingPeriod`. `dueDay`
 * se recorta al último día real del período y, si cae fin de semana, se
 * corre al lunes siguiente (nunca a un feriado externo).
 */
export function resolveMonthlyDueDate(billingPeriod: string, dueDay: number): string {
  const clampedDay = clampDayToBillingPeriod(dueDay, billingPeriod);
  const rawDueDate = `${billingPeriod}-${String(clampedDay).padStart(2, "0")}`;
  return nextBusinessDay(rawDueDate);
}

export function billingPeriodOfDateKey(dateKey: string): string {
  assertDateKey(dateKey, "dateKey");
  return dateKey.slice(0, 7);
}

/** El período 'YYYY-MM' siguiente a `billingPeriod` — cruza diciembre→enero correctamente. */
export function nextBillingPeriod(billingPeriod: string): string {
  assertBillingPeriod(billingPeriod);
  const [year, month] = billingPeriod.split("-").map(Number);
  const totalMonths = year * 12 + (month - 1) + 1;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/**
 * Día civil (YYYY-MM-DD) de un date key o de un instante ISO. Un date key se devuelve tal cual; un instante se pasa al día
 * de Argentina con la función civil del calendario (`instantDateKey`). NUNCA se recorta el texto del instante: eso daba el
 * día UTC, y una clase de la noche argentina (21:00 en adelante) caía en el día —y, a fin de mes, en el mes— siguiente.
 */
export function toDateKey(isoOrDateKey: string): string {
  if (isValidDateKey(isoOrDateKey)) return isoOrDateKey;
  return instantDateKey(isoOrDateKey);
}

export function isDateKeyBeforeOrEqual(a: string, b: string): boolean {
  return daysBetweenDateKeys(a, b) >= 0;
}

/** Zona horaria de referencia del negocio: generar cargos y evaluar deuda "hoy" siempre usa la fecha de Buenos Aires. */
export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

export function localDateKeyInTimeZone(instant: Date, timeZone: string = ARGENTINA_TIME_ZONE): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError("Instante inválido.");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}
