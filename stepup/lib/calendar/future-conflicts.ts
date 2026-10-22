import { findCalendarConflicts, hasBlockingConflict, type ConflictCandidateLesson } from "../calendar-conflicts.ts";
import { evaluateAvailability, type TeacherAvailability } from "./availability.ts";
import { generateOccurrences } from "./recurrence-engine.ts";
import { addDaysToDateKey, getLocalDateKey, localDateTimeToInstantIso } from "./timezone.ts";
import { formatCivilDayLabelShort } from "./civil-calendar.ts";
import type { RecurrenceRuleForEngine } from "./types.ts";

/**
 * Validación del nuevo patrón de «Editar futuras» ANTES de guardarlo — puerto de `validateFutureRecurrence` (app original,
 * `calendarRecurrenceSplit.ts`): las ocurrencias de la sucesora desde la fecha efectiva hasta 60 días después (de la fecha
 * efectiva o de hoy, la que caiga más tarde) no pueden superponerse con otra clase ya agendada ni caer en un horario bloqueado de
 * la disponibilidad. Con la web se omitía por completo: dos series quedaban a la misma hora sin aviso.
 *
 * Pura: el llamador pasa los candidatos YA sin la serie que se está reemplazando (sus ocurrencias desde la fecha efectiva dejan
 * de existir) y la disponibilidad.
 */
export const FUTURE_VALIDATION_HORIZON_DAYS = 60;

export interface FutureRecurrenceConflict {
  start: string;
  end: string;
  kind: "occupied" | "unavailable";
  /** «ocupado» o el motivo del bloqueo de disponibilidad. */
  detail: string;
  /** Nombre de la clase con la que se superpone (sólo en «ocupado», si se conoce). */
  with: string | null;
}

export function findFutureRecurrenceConflicts(input: {
  successor: RecurrenceRuleForEngine;
  effectiveDate: string;
  todayDate: string;
  candidates: readonly ConflictCandidateLesson[];
  availability: TeacherAvailability;
}): FutureRecurrenceConflict[] {
  const { successor, effectiveDate, todayDate } = input;
  const timeZone = successor.timezone;
  const rangeStart = new Date(localDateTimeToInstantIso({ date: effectiveDate, hour: 0, minute: 0, timeZone }));
  const horizonBase = effectiveDate > todayDate ? effectiveDate : todayDate;
  const rangeEnd = new Date(localDateTimeToInstantIso({ date: addDaysToDateKey(horizonBase, FUTURE_VALIDATION_HORIZON_DAYS), hour: 23, minute: 59, timeZone }));
  const occurrences = generateOccurrences({ ...successor, status: "active" }, rangeStart, rangeEnd);

  const result: FutureRecurrenceConflict[] = [];
  for (const occurrence of occurrences) {
    const overlaps = findCalendarConflicts(occurrence.start, occurrence.end, [...input.candidates]);
    if (hasBlockingConflict(overlaps)) {
      const blocking = overlaps.find((conflict) => !conflict.conflictingLesson.overlapAllowed);
      result.push({ start: occurrence.start, end: occurrence.end, kind: "occupied", detail: "horario ocupado", with: blocking?.conflictingLesson.label ?? null });
      continue;
    }
    const evaluation = evaluateAvailability(occurrence.start, occurrence.end, input.availability);
    if (!evaluation.isAvailable) {
      result.push({ start: occurrence.start, end: occurrence.end, kind: "unavailable", detail: evaluation.label ?? "no disponible", with: null });
    }
  }
  return result;
}

/** «viernes, 23 de octubre 19:00»: el día y la hora civiles de la cuenta de un instante. */
function describeOccurrence(startIso: string, timeZone: string): string {
  const dateKey = getLocalDateKey(startIso, timeZone);
  const time = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startIso));
  return `${formatCivilDayLabelShort(dateKey)} ${time}`;
}

/** Texto para la profesora: cuántas clases chocan y las primeras (nunca más de 5), con la clase con la que chocan. */
export function describeFutureConflicts(conflicts: readonly FutureRecurrenceConflict[], timeZone: string): string {
  const shown = conflicts.slice(0, 5).map((conflict) => {
    const when = describeOccurrence(conflict.start, timeZone);
    if (conflict.kind === "occupied") return conflict.with ? `${when}: se superpone con ${conflict.with}` : `${when}: horario ocupado`;
    return `${when}: bloqueado en tu disponibilidad (${conflict.detail})`;
  });
  const more = conflicts.length > shown.length ? ` (y ${conflicts.length - shown.length} más)` : "";
  return `El nuevo horario choca en ${conflicts.length} clase${conflicts.length === 1 ? "" : "s"}${more}: ${shown.join("; ")}. Todavía no se guardó nada.`;
}
