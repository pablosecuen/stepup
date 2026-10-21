import { instantDateKey } from "../calendar/civil-calendar.ts";

/**
 * Hechos de una clase registrada que necesitan las estadísticas del Resumen financiero. Es la forma de `SavedLesson` de la app anterior (`form.eventType`, `holidayException`, `isBillable`,
 * duraciones, modalidad, alumnos, importes) leída desde `lesson_registrations`. Las estadísticas (valor de la hora, resumen anual, modalidad, alumnos del año) usan las MISMAS reglas que la app:
 * «clase dictada» es el RESULTADO de la clase (`clase_dictada`, o `feriado` con excepción), no el campo `counts_as_class`. PURO.
 */
export interface RegisteredLessonFacts {
  id: string;
  calendarLessonId: string | null;
  /** `<id de la serie>|<clave de la ocurrencia>` con los ids de la web, para registros importados que no quedaron enlazados a una clase del calendario. */
  occurrenceKey: string | null;
  /** Resultado real de la clase: `clase_dictada`, `feriado`, `cancelada_con_aviso`, `cancelada_tarde`, `profesora_ausente`, `alumno_ausente`, `reprogramada`. */
  eventType: string;
  holidayException: boolean;
  isBillable: boolean;
  /** Fecha civil (Argentina) de la clase — el `form.date` de la app. */
  dateKey: string;
  scheduledDurationMinutes: number;
  actualDurationMinutes: number | null;
  modality: string | null;
  studentIds: string[];
  billedAmount: number | null;
  billedAmountByStudent: Record<string, number> | null;
}

/** Igual que `isClassHeld` de la app: dictada, o feriado con excepción manual. */
export function isClassHeld(facts: Pick<RegisteredLessonFacts, "eventType" | "holidayException">): boolean {
  if (facts.eventType === "clase_dictada") return true;
  if (facts.eventType === "feriado") return facts.holidayException;
  return false;
}

/** Duración real si existe; si no, la programada (igual que la app). */
export function lessonMinutes(facts: Pick<RegisteredLessonFacts, "actualDurationMinutes" | "scheduledDurationMinutes">): number {
  return facts.actualDurationMinutes ?? facts.scheduledDurationMinutes;
}

export interface RegistrationRowForFacts {
  id: string;
  calendar_lesson_id: string | null;
  source_event_type: string | null;
  outcome: string;
  holiday_exception: boolean;
  is_billable: boolean | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  scheduled_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  modality: string | null;
  billed_amount: number | string | null;
  created_at: string;
}

function diffMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Hechos de una fila de registro. Un registro importado trae el resultado original (`source_event_type`, p. ej. «alumno ausente», que la web guarda como clase dictada con asistencia «ausente»)
 * y las duraciones tal como estaban; uno creado en la web no los trae y se deducen del resultado y de los horarios.
 */
export function toRegisteredLessonFacts(
  row: RegistrationRowForFacts,
  extras: { studentIds: string[]; billedAmountByStudent: Record<string, number> | null; occurrenceKey: string | null }
): RegisteredLessonFacts {
  const scheduledMinutes = row.scheduled_duration_minutes ?? diffMinutes(row.scheduled_start_at, row.scheduled_end_at) ?? 0;
  const actualMinutes = row.actual_duration_minutes ?? diffMinutes(row.actual_started_at, row.actual_ended_at);
  return {
    id: row.id,
    calendarLessonId: row.calendar_lesson_id,
    occurrenceKey: extras.occurrenceKey,
    eventType: row.source_event_type ?? row.outcome,
    holidayException: row.holiday_exception,
    isBillable: row.is_billable !== false,
    dateKey: instantDateKey(row.scheduled_start_at ?? row.actual_started_at ?? row.created_at),
    scheduledDurationMinutes: scheduledMinutes,
    actualDurationMinutes: actualMinutes,
    modality: row.modality,
    studentIds: extras.studentIds,
    billedAmount: numberOrNull(row.billed_amount),
    billedAmountByStudent: extras.billedAmountByStudent,
  };
}

/**
 * Clave de ocurrencia con ids de la web a partir de la clave de reserva de la app anterior (`recurrence:<serie>:<serie>:w…`). Las claves de clases sueltas (`lesson:<id>`) no se traducen acá: esas
 * clases ya quedan enlazadas por `calendar_lesson_id`. Devuelve `null` si la serie no existe en la web.
 */
export function webOccurrenceKeyFromReservationKey(reservationKey: string | null | undefined, ruleIdByLegacyId: ReadonlyMap<string, string>): string | null {
  if (typeof reservationKey !== "string" || !reservationKey.startsWith("recurrence:")) return null;
  const rest = reservationKey.slice("recurrence:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const ruleId = ruleIdByLegacyId.get(rest.slice(0, separator));
  if (!ruleId) return null;
  // La clave de la ocurrencia empieza con el id de la serie (`<serie>:w0:c0:…`): en la web ese prefijo es el id nuevo.
  const occurrence = rest.slice(separator + 1);
  const occurrenceSeparator = occurrence.indexOf(":");
  if (occurrenceSeparator <= 0) return null;
  return `${ruleId}|${ruleId}${occurrence.slice(occurrenceSeparator)}`;
}
