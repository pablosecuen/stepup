import { addDaysToDateKey, getLocalDateKey, localDateTimeToInstantIso } from "./timezone.ts";
import { generateOccurrences } from "./recurrence-engine.ts";
import type { RecurrenceRuleForEngine, RecurrenceRuleStatus, RecurrenceWeek } from "./types.ts";

/**
 * Fecha de finalización de una SERIE (todos los tramos de su linaje).
 *
 * La fecha vive en `recurrence_rules.series_end_date` (una sucesora la hereda por trigger) y NUNCA reescribe el `end_date` ni el `status` de un tramo: el fin EFECTIVO de un tramo es el menor
 * entre su `end_date` (corte de «esta y las siguientes» o fin propio) y la fecha de la serie. Quitarla o extenderla es, por eso, reversible sin reconstruir nada.
 * Todo es PURO (fechas civiles `YYYY-MM-DD` en la zona horaria de la cuenta, nunca UTC) para que el servidor, la pantalla y las pruebas usen la misma regla.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha civil real (no «2026-02-31»)? */
export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** El menor de dos fechas civiles; `null` es «sin fecha» (no limita). */
export function minDateKey(first: string | null, second: string | null): string | null {
  if (first === null) return second;
  if (second === null) return first;
  return first <= second ? first : second;
}

/**
 * Fin efectivo y estado de un tramo. Un tramo cuyo fin efectivo cae ANTES de que empiece a regir (típico: un cambio programado para después de la fecha de finalización) no genera ninguna clase:
 * se muestra como finalizado sin tocar su fila (el motor tampoco admite un fin anterior al inicio).
 */
export function deriveRuleEnd(input: { startDate: string; effectiveFromDate: string | null; endDate: string | null; seriesEndDate: string | null; status: RecurrenceRuleStatus }): { endDate: string | null; status: RecurrenceRuleStatus } {
  const endDate = minDateKey(input.endDate, input.seriesEndDate);
  const firstDay = input.effectiveFromDate && input.effectiveFromDate > input.startDate ? input.effectiveFromDate : input.startDate;
  if (endDate !== null && endDate < firstDay && input.status !== "ended") return { endDate, status: "ended" };
  return { endDate, status: input.status };
}

/** Mensaje para la profesora si la fecha elegida no sirve; `null` si es válida. Vacía es válida («sin fecha de finalización»). */
export function validateSeriesEndInput(endDate: string, minDate: string): string | null {
  if (endDate.trim() === "") return null;
  if (!isValidDateKey(endDate)) return "La fecha de finalización no es válida.";
  if (isValidDateKey(minDate) && endDate < minDate) return "La fecha de finalización no puede ser anterior al inicio del tramo que se edita.";
  return null;
}

/** Clave canónica de un patrón semanal (ignora el orden de claves y de sesiones): sirve para saber si «Editar futuras» cambia el patrón o sólo la fecha de finalización. */
export function weeksKey(weeks: RecurrenceWeek[]): string {
  return JSON.stringify(
    [...weeks]
      .sort((first, second) => first.weekIndex - second.weekIndex)
      .map((week) => [week.weekIndex, week.sessions.map((session) => [session.weekday, session.hour, session.minute, session.durationMinutes]).sort((first, second) => first[0] - second[0] || first[1] - second[1] || first[2] - second[2] || first[3] - second[3])])
  );
}

export interface SeriesEndPatternInput {
  weeks: RecurrenceWeek[];
  /** Lunes de la semana 0 del tramo (como `recurrence_rules.start_date`). */
  startDate: string;
  timezone: string;
}

/**
 * Última clase PREVISTA del patrón entre `fromDate` y `endDate` (ambas inclusivas), o `null` si el patrón no tiene ninguna en ese tramo. Usa el mismo motor que genera las clases de la agenda,
 * así lo que se muestra antes de guardar es exactamente lo que va a regir.
 */
export function lastPlannedClass(input: SeriesEndPatternInput & { fromDate: string; endDate: string }): { start: string; end: string } | null {
  if (!isValidDateKey(input.fromDate) || !isValidDateKey(input.endDate) || input.endDate < input.fromDate) return null;
  const rule: RecurrenceRuleForEngine = {
    recurrenceId: "vista-previa",
    studentId: null,
    participantIds: [],
    cycleLengthWeeks: input.weeks.length,
    weeks: input.weeks,
    modality: "online",
    timezone: input.timezone,
    startDate: input.startDate,
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
  };
  // Se mira como mucho la última ventana de un ciclo completo (4 semanas) hacia atrás desde el fin: allí está la última clase, sea cual sea el ciclo.
  const windowStart = addDaysToDateKey(input.endDate, -34) > input.fromDate ? addDaysToDateKey(input.endDate, -34) : input.fromDate;
  const rangeStart = new Date(localDateTimeToInstantIso({ date: windowStart, hour: 0, minute: 0, timeZone: input.timezone }));
  const rangeEnd = new Date(new Date(localDateTimeToInstantIso({ date: addDaysToDateKey(input.endDate, 1), hour: 0, minute: 0, timeZone: input.timezone })).getTime() - 1);
  const occurrences = generateOccurrences(rule, rangeStart, rangeEnd);
  const last = occurrences[occurrences.length - 1];
  return last ? { start: last.start, end: last.end } : null;
}

export interface LessonForSeriesEnd {
  id: string;
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  /** Fecha y hora reales de la clase (donde ocurre, no donde la generó la serie). */
  startAt: string;
  /** La clase REAL ocupa su horario en la agenda operativa (no es el origen liberado de una reprogramación). */
  occupiesSlot: boolean;
  /** Es una clase movida de otra fecha (reprogramada): se informa aparte porque cruza el límite. */
  rescheduled: boolean;
  cancelledBySeriesLimit: boolean;
  hasRegistration: boolean;
  hasCharge: boolean;
}

export interface SeriesEndImpact {
  /** Clases ya creadas que dejan de regir por quedar DESPUÉS del límite (programadas, sin registro ni cobro). */
  toCancel: { id: string; date: string; startAt: string; rescheduled: boolean }[];
  /** Clases posteriores al límite con registro o cobro: la operación completa se rechaza, no se resuelve con las reglas existentes. */
  blocked: { id: string; date: string; startAt: string }[];
  /** Clases que había cancelado un límite anterior y que quedan dentro del nuevo (o sin límite): vuelven. */
  toRestore: { id: string; date: string; startAt: string; rescheduled: boolean }[];
}

/**
 * Qué clases YA CREADAS de la serie cambian con la nueva fecha de finalización — misma regla que `set_recurrence_series_end` (la base la repite dentro de la transacción):
 *  - se compara la fecha REAL de la clase (en la zona horaria de la cuenta), incluida la reprogramada que cruza el límite;
 *  - sólo se cancelan las programadas que ocupan horario y no tienen registro ni cobro; una con registro o cobro posterior al límite BLOQUEA;
 *  - sólo se restauran las que canceló un límite (nunca una cancelación manual).
 * Las ocurrencias VIRTUALES no se guardan: el motor deja de generarlas después del límite y vuelve a generarlas al quitarlo.
 */
export function planSeriesEndImpact(lessons: LessonForSeriesEnd[], endDate: string | null, timezone: string): SeriesEndImpact {
  const impact: SeriesEndImpact = { toCancel: [], blocked: [], toRestore: [] };
  const byDate = (a: { date: string; startAt: string }, b: { date: string; startAt: string }) => a.startAt.localeCompare(b.startAt);
  for (const lesson of lessons) {
    const date = getLocalDateKey(lesson.startAt, timezone);
    const after = endDate !== null && date > endDate;
    if (after && ["scheduled", "completed", "rescheduled"].includes(lesson.status) && (lesson.hasRegistration || lesson.hasCharge)) {
      impact.blocked.push({ id: lesson.id, date, startAt: lesson.startAt });
    } else if (after && ["scheduled", "rescheduled"].includes(lesson.status) && lesson.occupiesSlot) {
      impact.toCancel.push({ id: lesson.id, date, startAt: lesson.startAt, rescheduled: lesson.rescheduled });
    } else if (!after && lesson.status === "cancelled" && lesson.cancelledBySeriesLimit) {
      impact.toRestore.push({ id: lesson.id, date, startAt: lesson.startAt, rescheduled: lesson.rescheduled });
    }
  }
  impact.toCancel.sort(byDate);
  impact.blocked.sort(byDate);
  impact.toRestore.sort(byDate);
  return impact;
}

/** Lo mínimo de una clase REAL y de las excepciones de su serie para decidir si ocupa horario (misma regla que `agenda.ts` y que `calendar_lesson_occupies_slot` de la base). */
export function lessonOccupiesSlot(
  lesson: { id: string; status: "scheduled" | "completed" | "cancelled" | "rescheduled"; recurrenceId: string | null; recurrenceOccurrenceKey: string | null; recurrenceOriginalStart: string | null },
  exceptions: { recurrenceId: string; occurrenceKey: string; type: "cancelled" | "rescheduled" | "excluded"; replacementLessonId: string | null }[]
): boolean {
  if (lesson.status === "cancelled") return false;
  // Clase suelta reprogramada: su origen queda liberado (la nueva guarda la fecha original; el origen no).
  if (lesson.status === "rescheduled" && lesson.recurrenceOriginalStart === null) return false;
  // Ocurrencia de una serie que se movió a otra clase: ocupa el destino, no el origen.
  if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
    const moved = exceptions.some((exception) => exception.type === "rescheduled" && exception.recurrenceId === lesson.recurrenceId && exception.occurrenceKey === lesson.recurrenceOccurrenceKey && exception.replacementLessonId !== null && exception.replacementLessonId !== lesson.id);
    if (moved) return false;
  }
  return true;
}
