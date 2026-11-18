import { exceptionCoversDate, type AvailabilityException, type AvailabilityExceptionReason, type TeacherAvailability } from "./availability.ts";
import { CALENDAR_TIMEZONE, instantMinutesOfDay } from "./civil-calendar.ts";
import { addDaysToDateKey, getLocalDateKey, localDateTimeToInstantIso } from "./timezone.ts";

/**
 * Señal visual de «Vacaciones / feriados» en el Calendario. Sale de LAS MISMAS excepciones guardadas y de la MISMA regla de cobertura (`exceptionCoversDate`, fechas inclusivas) que usa
 * `evaluateAvailability` al crear o reprogramar una clase: lo que se pinta es exactamente lo que después se rechaza, nunca dos fuentes de verdad.
 *
 * Fechas: una excepción es una fecha civil (`YYYY-MM-DD`) en la zona de la cuenta (`availability.timezone`) y cada día del Calendario es una clave civil en la zona del calendario. Nunca se
 * interpreta una fecha como UTC: los límites del día y de cada tramo se convierten a instantes con la zona explícita y se vuelven a leer como minutos del día del calendario.
 * PURO: no abre ni cancela ni mueve ninguna clase; sólo describe tramos para dibujar.
 */
export interface DayBlockSegment {
  /** Id de la excepción guardada que bloquea este tramo. */
  id: string;
  reason: AvailabilityExceptionReason;
  /** Rótulo corto para la grilla: «Vacaciones», «Feriado», «Licencia» o «Bloqueado». */
  label: string;
  /** Minutos desde las 00:00 del día del calendario (0–1440). */
  startMinutes: number;
  endMinutes: number;
  /** El tramo ocupa el día entero. */
  fullDay: boolean;
}

const BLOCK_LABELS: Record<AvailabilityExceptionReason, string> = {
  vacation: "Vacaciones",
  holiday: "Feriado",
  leave: "Licencia",
  other: "Bloqueado",
};

export function blockLabel(reason: AvailabilityExceptionReason): string {
  return BLOCK_LABELS[reason] ?? BLOCK_LABELS.other;
}

interface InstantRange {
  startMs: number;
  endMs: number;
}

/** Tramo de instantes de una excepción en una fecha local de la zona de la cuenta: el día entero o su franja horaria (misma regla que `evaluateAvailability`). `null` si el dato no es utilizable. */
function exceptionRangeOnDate(exception: AvailabilityException, localDate: string, timeZone: string): InstantRange | null {
  try {
    const partial = exception.type !== "unavailable_full_day" && Boolean(exception.startTime) && Boolean(exception.endTime);
    if (!partial) {
      const startMs = Date.parse(localDateTimeToInstantIso({ date: localDate, hour: 0, minute: 0, timeZone }));
      const endMs = Date.parse(localDateTimeToInstantIso({ date: addDaysToDateKey(localDate, 1), hour: 0, minute: 0, timeZone }));
      return { startMs, endMs };
    }
    const [startHour, startMinute] = (exception.startTime as string).split(":").map(Number);
    const [endHour, endMinute] = (exception.endTime as string).split(":").map(Number);
    const startMs = Date.parse(localDateTimeToInstantIso({ date: localDate, hour: startHour, minute: startMinute, timeZone }));
    const endMs = Date.parse(localDateTimeToInstantIso({ date: localDate, hour: endHour, minute: endMinute, timeZone }));
    return endMs > startMs ? { startMs, endMs } : null;
  } catch {
    return null;
  }
}

/** Quita de `segments` los tramos de `holes` (disponibilidad extra). */
function subtract(segments: InstantRange[], holes: InstantRange[]): InstantRange[] {
  let current = segments;
  for (const hole of holes) {
    current = current.flatMap((segment) => {
      if (hole.endMs <= segment.startMs || hole.startMs >= segment.endMs) return [segment];
      const parts: InstantRange[] = [];
      if (hole.startMs > segment.startMs) parts.push({ startMs: segment.startMs, endMs: hole.startMs });
      if (hole.endMs < segment.endMs) parts.push({ startMs: hole.endMs, endMs: segment.endMs });
      return parts;
    });
  }
  return current;
}

/**
 * Tramos bloqueados por día para `dayKeys` (claves civiles del Calendario). Sólo aparecen los días con algún bloqueo. Respeta fechas inclusivas, bloqueos de un solo horario y la
 * disponibilidad extra que ya anula un bloqueo en `evaluateAvailability`.
 */
export function availabilityBlocksForDays(dayKeys: string[], availability: TeacherAvailability, calendarTimeZone: string = CALENDAR_TIMEZONE): Record<string, DayBlockSegment[]> {
  const result: Record<string, DayBlockSegment[]> = {};
  const timeZone = availability.timezone || calendarTimeZone;
  const exceptions = availability.exceptions ?? [];
  if (exceptions.length === 0) return result;

  for (const dayKey of dayKeys) {
    let dayStartMs: number;
    let dayEndMs: number;
    let firstLocal: string;
    let lastLocal: string;
    try {
      const startIso = localDateTimeToInstantIso({ date: dayKey, hour: 0, minute: 0, timeZone: calendarTimeZone });
      const endIso = localDateTimeToInstantIso({ date: addDaysToDateKey(dayKey, 1), hour: 0, minute: 0, timeZone: calendarTimeZone });
      dayStartMs = Date.parse(startIso);
      dayEndMs = Date.parse(endIso);
      firstLocal = getLocalDateKey(startIso, timeZone);
      lastLocal = getLocalDateKey(new Date(dayEndMs - 1).toISOString(), timeZone);
    } catch {
      continue;
    }
    // Fechas locales de la cuenta que toca este día del calendario (una sola cuando las dos zonas coinciden).
    const localDates: string[] = [];
    for (let cursor = firstLocal, guard = 0; guard < 3; guard += 1) {
      localDates.push(cursor);
      if (cursor === lastLocal) break;
      cursor = addDaysToDateKey(cursor, 1);
    }

    const extras: InstantRange[] = [];
    const blocked: { exception: AvailabilityException; range: InstantRange }[] = [];
    for (const exception of exceptions) {
      for (const localDate of localDates) {
        let covers = false;
        try {
          covers = exceptionCoversDate(exception, localDate);
        } catch {
          covers = false;
        }
        if (!covers) continue;
        const range = exceptionRangeOnDate(exception, localDate, timeZone);
        if (!range) continue;
        if (exception.type === "available_extra") extras.push(range);
        else blocked.push({ exception, range });
      }
    }

    const segments: DayBlockSegment[] = [];
    for (const { exception, range } of blocked) {
      for (const piece of subtract([range], extras)) {
        const startMs = Math.max(piece.startMs, dayStartMs);
        const endMs = Math.min(piece.endMs, dayEndMs);
        if (endMs <= startMs) continue;
        const startMinutes = startMs === dayStartMs ? 0 : instantMinutesOfDay(new Date(startMs).toISOString(), calendarTimeZone);
        const endMinutes = endMs === dayEndMs ? 1440 : instantMinutesOfDay(new Date(endMs).toISOString(), calendarTimeZone);
        segments.push({ id: exception.id, reason: exception.reason, label: blockLabel(exception.reason), startMinutes, endMinutes, fullDay: startMinutes === 0 && endMinutes === 1440 });
      }
    }
    if (segments.length > 0) result[dayKey] = segments.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  }
  return result;
}

/** Rótulo del encabezado de un día: el del primer bloqueo de día completo; `null` si el día no está bloqueado entero. */
export function fullDayBlockLabel(segments: DayBlockSegment[] | undefined): string | null {
  return segments?.find((segment) => segment.fullDay)?.label ?? null;
}

/** «14:00–16:00» para el tramo de un bloqueo parcial. */
export function segmentTimeRange(segment: Pick<DayBlockSegment, "startMinutes" | "endMinutes">): string {
  const at = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${at(segment.startMinutes)}–${segment.endMinutes >= 1440 ? "24:00" : at(segment.endMinutes)}`;
}
