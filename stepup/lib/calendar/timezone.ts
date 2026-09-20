/**
 * Puerto VERBATIM de `calendarTimezone.ts` (móvil,
 * `src/features/calendar/utils/calendarTimezone.ts`) — sin cambios de
 * lógica, sólo el traslado a este proyecto. Es la única fuente real de
 * conversión fecha-local↔instante en toda la Fase 3: nunca interpretar un
 * `YYYY-MM-DD` como UTC (regla explícita de la tarea) — siempre pasa por
 * `Intl.DateTimeFormat` con el timezone real (`America/Argentina/Buenos_Aires`).
 */

interface ZonedDateTimeInput {
  date: string;
  hour: number;
  minute: number;
  timeZone: string;
}

interface DateKeyParts {
  year: number;
  month: number;
  day: number;
}

interface ZonedParts extends DateKeyParts {
  hour: number;
  minute: number;
  second: number;
}

function parseDateKey(dateKey: string): DateKeyParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Fecha local inválida: ${dateKey}`);

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };

  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    throw new RangeError(`Fecha local inválida: ${dateKey}`);
  }

  return parts;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.get("year") ?? NaN,
    month: values.get("month") ?? NaN,
    day: values.get("day") ?? NaN,
    hour: values.get("hour") ?? NaN,
    minute: values.get("minute") ?? NaN,
    second: values.get("second") ?? NaN,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function getLocalDateKey(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError(`Instante inválido: ${instantIso}`);
  }

  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getLocalTimeKey(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError(`Instante inválido: ${instantIso}`);
  }

  const parts = zonedParts(instant, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localDateTimeToInstantIso({ date, hour, minute, timeZone }: ZonedDateTimeInput): string {
  const dateParts = parseDateKey(date);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("La hora debe estar entre 0 y 23.");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError("Los minutos deben estar entre 0 y 59.");
  }

  const targetAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, 0);

  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const current = zonedParts(new Date(candidate), timeZone);
    const currentAsUtc = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second);
    const adjustment = targetAsUtc - currentAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }

  const result = new Date(candidate);
  const finalParts = zonedParts(result, timeZone);
  if (
    finalParts.year !== dateParts.year ||
    finalParts.month !== dateParts.month ||
    finalParts.day !== dateParts.day ||
    finalParts.hour !== hour ||
    finalParts.minute !== minute
  ) {
    throw new RangeError(`El horario ${date} ${pad(hour)}:${pad(minute)} no existe en ${timeZone}.`);
  }

  return result.toISOString();
}

export function addDaysToDateKey(dateKey: string, amount: number): string {
  const parts = parseDateKey(dateKey);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function daysBetweenDateKeys(start: string, end: string): number {
  const first = parseDateKey(start);
  const second = parseDateKey(end);
  return Math.round((Date.UTC(second.year, second.month - 1, second.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000);
}

export function getDateKeyJsDay(dateKey: string): number {
  const parts = parseDateKey(dateKey);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}
