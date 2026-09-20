import { daysBetweenDateKeys, getLocalDateKey, addDaysToDateKey } from "./timezone.ts";
import type { AppWeekday } from "./weekday.ts";

/**
 * Puerto de `teacherAvailabilityEngine.ts` (móvil) — misma forma exacta y
 * mismo algoritmo de `evaluateAvailability`. `weekly_blocks`/`exceptions`
 * de `teacher_availability` (jsonb) tienen esta forma tal cual.
 */
export type AvailabilityBlockReason = "work" | "study" | "personal" | "other";
export type AvailabilityExceptionReason = "vacation" | "holiday" | "leave" | "other";

export interface WeeklyAvailabilityBlock {
  id: string;
  weekday: AppWeekday;
  startTime: string; // "HH:MM"
  endTime: string;
  reason: AvailabilityBlockReason;
  note?: string;
}

export type AvailabilityExceptionType = "unavailable_full_day" | "unavailable_block" | "available_extra";

export interface AvailabilityException {
  id: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // inclusive
  type: AvailabilityExceptionType;
  startTime?: string;
  endTime?: string;
  reason: AvailabilityExceptionReason;
  note?: string;
}

export interface TeacherAvailability {
  schemaVersion: 1;
  timezone: string;
  weeklyBlocks: WeeklyAvailabilityBlock[];
  exceptions: AvailabilityException[];
}

export type AvailabilityConflictKind = "weekly_block" | "exception";
export interface AvailabilityConflict {
  kind: AvailabilityConflictKind;
  sourceId: string;
  label: string;
  overlapStart: string;
  overlapEnd: string;
}
export interface AvailabilityEvaluation {
  isAvailable: boolean;
  conflict: AvailabilityConflict | null;
  label: string | null;
}

const WEEKLY_REASON_LABELS: Record<AvailabilityBlockReason, string> = {
  work: "Trabajo",
  study: "Estudio",
  personal: "Personal",
  other: "Otro",
};
const EXCEPTION_REASON_LABELS: Record<AvailabilityExceptionReason, string> = {
  vacation: "Vacaciones",
  holiday: "Feriado",
  leave: "Licencia",
  other: "Otro",
};

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

interface LocalRange {
  startMinutes: number; // minutos desde las 00:00 del día 0 del rango (puede superar 1440 si cruza días)
  endMinutes: number;
}

function dayBounds(dayIndex: number): LocalRange {
  return { startMinutes: dayIndex * 1440, endMinutes: (dayIndex + 1) * 1440 };
}

function exceptionCoversDate(exception: AvailabilityException, dateKey: string): boolean {
  const end = exception.endDate ?? exception.date;
  return daysBetweenDateKeys(exception.date, dateKey) >= 0 && daysBetweenDateKeys(dateKey, end) >= 0;
}

function rangesOverlapMinutes(a: LocalRange, b: LocalRange): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/**
 * Evalúa si `[startIso, endIso)` está disponible contra `availability`.
 * Prioridad EXACTA: 1) `available_extra` que cubre el pedido COMPLETO gana
 * siempre; 2) si no, una excepción (`unavailable_full_day`/`unavailable_block`)
 * que se superpone bloquea; 3) si no, un bloqueo semanal que se superpone
 * bloquea; 4) si no, disponible.
 */
export function evaluateAvailability(startIso: string, endIso: string, availability: TeacherAvailability): AvailabilityEvaluation {
  const startTime = new Date(startIso).getTime();
  const endTime = new Date(endIso).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new RangeError("El rango a evaluar es inválido.");
  }

  const timeZone = availability.timezone;
  const startDateKey = getLocalDateKey(startIso, timeZone);
  // Resta 1ms para que una clase que termina exactamente a medianoche local
  // nunca sume de más el día siguiente.
  const endDateKeyInclusive = getLocalDateKey(new Date(endTime - 1).toISOString(), timeZone);

  const localDates: string[] = [];
  let cursor = startDateKey;
  while (daysBetweenDateKeys(cursor, endDateKeyInclusive) >= 0) {
    localDates.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }

  // Rango del pedido expresado en "minutos desde las 00:00 de localDates[0]".
  function minutesSinceRangeStart(instantIso: string): number {
    const dateKey = getLocalDateKey(instantIso, timeZone);
    const dayOffset = daysBetweenDateKeys(localDates[0], dateKey);
    const [hourStr, minuteStr] = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(instantIso))
      .split(":");
    return dayOffset * 1440 + Number(hourStr) * 60 + Number(minuteStr);
  }

  const request: LocalRange = { startMinutes: minutesSinceRangeStart(startIso), endMinutes: minutesSinceRangeStart(endIso) };

  const extraRanges: LocalRange[] = [];
  const exceptionConflicts: { range: LocalRange; exception: AvailabilityException }[] = [];
  const weeklyConflicts: { range: LocalRange; block: WeeklyAvailabilityBlock }[] = [];

  localDates.forEach((dateKey, dayIndex) => {
    availability.exceptions.forEach((exception) => {
      if (!exceptionCoversDate(exception, dateKey)) return;
      const bounds = dayBounds(dayIndex);
      const range: LocalRange =
        exception.type === "unavailable_full_day" || !exception.startTime || !exception.endTime
          ? bounds
          : { startMinutes: dayIndex * 1440 + timeToMinutes(exception.startTime), endMinutes: dayIndex * 1440 + timeToMinutes(exception.endTime) };
      if (exception.type === "available_extra") {
        extraRanges.push(range);
      } else {
        exceptionConflicts.push({ range, exception });
      }
    });

    const jsDay = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    const appWeekday = (jsDay === 0 ? 6 : jsDay - 1) as AppWeekday;
    availability.weeklyBlocks.forEach((block) => {
      if (block.weekday !== appWeekday) return;
      weeklyConflicts.push({
        range: { startMinutes: dayIndex * 1440 + timeToMinutes(block.startTime), endMinutes: dayIndex * 1440 + timeToMinutes(block.endTime) },
        block,
      });
    });
  });

  const fullyCoveredByExtra = extraRanges.some((range) => range.startMinutes <= request.startMinutes && range.endMinutes >= request.endMinutes);
  if (fullyCoveredByExtra) {
    return { isAvailable: true, conflict: null, label: "Disponibilidad extra" };
  }

  const exceptionHit = exceptionConflicts.find((item) => rangesOverlapMinutes(request, item.range));
  if (exceptionHit) {
    const label = exceptionHit.exception.note?.trim() || EXCEPTION_REASON_LABELS[exceptionHit.exception.reason];
    return {
      isAvailable: false,
      conflict: {
        kind: "exception",
        sourceId: exceptionHit.exception.id,
        label,
        overlapStart: new Date(startTime).toISOString(),
        overlapEnd: new Date(endTime).toISOString(),
      },
      label,
    };
  }

  const weeklyHit = weeklyConflicts.find((item) => rangesOverlapMinutes(request, item.range));
  if (weeklyHit) {
    const label = weeklyHit.block.note?.trim() || WEEKLY_REASON_LABELS[weeklyHit.block.reason];
    return {
      isAvailable: false,
      conflict: {
        kind: "weekly_block",
        sourceId: weeklyHit.block.id,
        label,
        overlapStart: new Date(startTime).toISOString(),
        overlapEnd: new Date(endTime).toISOString(),
      },
      label,
    };
  }

  return { isAvailable: true, conflict: null, label: null };
}
