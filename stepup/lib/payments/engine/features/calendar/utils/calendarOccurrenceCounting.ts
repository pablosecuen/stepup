// Puerto VERBATIM del original (`src/features/calendar/utils/calendarOccurrenceCounting.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../types/index.ts';
import type { AvailabilityException, TeacherAvailability } from '../types/teacherAvailability.ts';
import { applyExceptionsToOccurrences, generateOccurrences } from './calendarRecurrenceEngine.ts';
import { daysBetweenDateKeys, getLocalDateKey, localDateTimeToInstantIso } from './calendarTimezone.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): cuenta
 * ocurrencias REALES de una serie en un rango de fechas — reutiliza tal
 * cual el motor puro de recurrencias (`generateOccurrences` +
 * `applyExceptionsToOccurrences`), nunca reimplementa la lógica de
 * generación/excepciones. Excluye canceladas y reprogramadas (el slot
 * original de una reprogramación no "sucede" ahí — su destino, si cae en
 * otro día del patrón semanal de la MISMA regla, ya se cuenta aparte al
 * recorrer ese día; un destino en un día atípico fuera del patrón nunca lo
 * genera `generateOccurrences`, así que queda fuera de este conteo — límite
 * documentado, no un bug). También excluye fechas/horarios dentro de una
 * excepción de disponibilidad de la profesora (vacaciones/licencia/bloqueo
 * puntual) — `generateOccurrences` NO filtra esto por diseño (es una
 * responsabilidad separada, ver `teacherAvailabilityEngine.ts`), así que se
 * aplica acá explícitamente para que "clases habituales"/"clases restantes"
 * nunca cuenten una clase que en los hechos no va a darse.
 */
export interface OccurrenceCountRangeInput {
  rule: RecurrenceRule;
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
  /** YYYY-MM-DD, inclusive. */
  rangeStartDateKey: string;
  /** YYYY-MM-DD, inclusive. */
  rangeEndDateKey: string;
}

function isDateWithinException(dateKey: string, exception: AvailabilityException): boolean {
  const end = exception.endDate ?? exception.date;
  return daysBetweenDateKeys(exception.date, dateKey) >= 0 && daysBetweenDateKeys(dateKey, end) >= 0;
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function timeRangesOverlap(
  aStartMinutes: number,
  aEndMinutes: number,
  bStartTime: string | undefined,
  bEndTime: string | undefined
): boolean {
  if (!bStartTime || !bEndTime) return true; // bloqueo sin horario explícito: se interpreta como el día completo.
  const [bStartHour, bStartMinute] = bStartTime.split(':').map(Number);
  const [bEndHour, bEndMinute] = bEndTime.split(':').map(Number);
  const bStartMinutes = minutesOfDay(bStartHour, bStartMinute);
  const bEndMinutes = minutesOfDay(bEndHour, bEndMinute);
  return aStartMinutes < bEndMinutes && bStartMinutes < aEndMinutes;
}

/** true si esta ocurrencia (fecha + horario) cae dentro de una excepción de disponibilidad "no disponible" real. */
function isBlockedByAvailability(
  occurrenceDateKey: string,
  occurrenceStartMinutes: number,
  occurrenceEndMinutes: number,
  availability: TeacherAvailability | null
): boolean {
  if (!availability) return false;
  return availability.exceptions.some((exception) => {
    if (exception.type === 'available_extra') return false;
    if (!isDateWithinException(occurrenceDateKey, exception)) return false;
    if (exception.type === 'unavailable_full_day') return true;
    // 'unavailable_block': sólo bloquea si el horario de la ocurrencia se superpone con el bloqueo.
    return timeRangesOverlap(occurrenceStartMinutes, occurrenceEndMinutes, exception.startTime, exception.endTime);
  });
}

/**
 * Cantidad de ocurrencias reales (nunca virtuales-canceladas, nunca dentro
 * de una vacación/bloqueo de la profesora) que esta regla produce en el
 * rango de fechas dado, ambos extremos inclusive. Pura.
 */
export function countRuleOccurrencesInRange(input: OccurrenceCountRangeInput): number {
  const { rule, exceptions, existingLessons, availability, rangeStartDateKey, rangeEndDateKey } = input;
  if (daysBetweenDateKeys(rangeStartDateKey, rangeEndDateKey) < 0) return 0;

  const rangeStart = new Date(
    localDateTimeToInstantIso({ date: rangeStartDateKey, hour: 0, minute: 0, timeZone: rule.timezone })
  );
  const rangeEnd = new Date(
    localDateTimeToInstantIso({ date: rangeEndDateKey, hour: 23, minute: 59, timeZone: rule.timezone })
  );

  const rawOccurrences = generateOccurrences(rule, rangeStart, rangeEnd);
  const withStatus = applyExceptionsToOccurrences(rawOccurrences, exceptions, existingLessons);

  return withStatus.filter((occurrence) => {
    if (occurrence.materializationStatus === 'cancelled' || occurrence.materializationStatus === 'rescheduled') {
      return false;
    }
    const occurrenceDateKey = getLocalDateKey(occurrence.start, rule.timezone);
    const startMinutes = minutesOfDay(occurrence.hour, occurrence.minute);
    const endMinutes = startMinutes + occurrence.durationMinutes;
    return !isBlockedByAvailability(occurrenceDateKey, startMinutes, endMinutes, availability);
  }).length;
}

/**
 * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
 * ENTRENAMIENTOS que finalizan a mitad de mes): variante de
 * `countRuleOccurrencesInRange` que TAMBIÉN cuenta ocurrencias ya
 * MATERIALIZADAS (`CalendarLesson`s reales) aunque la regla ya no esté
 * activa. `countRuleOccurrencesInRange` sólo cuenta lo que `generateOccurrences`
 * produce, y esa función no genera nada para una regla no activa — por eso
 * una serie ya finalizada, con una clase real ya dictada ese mes, quedaba
 * contada como 0 ocurrencias con la función original. Misma doble fuente
 * que `hasRuleOccurrenceForParticipantInPeriod`/
 * `resolveEarliestParticipantOccurrenceDateInRange` (clases materializadas,
 * siempre válidas + ocurrencias virtuales, sólo si `rule.status === 'active'`),
 * generalizada de "alguna vez"/"la más temprana" a "cuántas" — nunca cuenta
 * dos veces la misma ocurrencia real. Pura.
 */
export function countRuleRealOccurrencesInRange(input: OccurrenceCountRangeInput): number {
  const { rule, exceptions, existingLessons, availability, rangeStartDateKey, rangeEndDateKey } = input;
  if (daysBetweenDateKeys(rangeStartDateKey, rangeEndDateKey) < 0) return 0;

  const relevantLessons = existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId);
  const materializedInRange = relevantLessons.filter((lesson) => {
    if (lesson.status === 'cancelled') return false;
    const logicalDateKey = getLocalDateKey(lesson.recurrenceOriginalStart ?? lesson.start, rule.timezone);
    return logicalDateKey >= rangeStartDateKey && logicalDateKey <= rangeEndDateKey;
  });

  let count = materializedInRange.length;

  if (rule.status === 'active') {
    const rangeStart = new Date(
      localDateTimeToInstantIso({ date: rangeStartDateKey, hour: 0, minute: 0, timeZone: rule.timezone })
    );
    const rangeEnd = new Date(
      localDateTimeToInstantIso({ date: rangeEndDateKey, hour: 23, minute: 59, timeZone: rule.timezone })
    );
    const rawOccurrences = generateOccurrences(rule, rangeStart, rangeEnd);
    const withStatus = applyExceptionsToOccurrences(rawOccurrences, exceptions, relevantLessons);
    const materializedKeys = new Set(
      relevantLessons.map((lesson) => lesson.recurrenceOccurrenceKey).filter((key): key is string => Boolean(key))
    );

    count += withStatus.filter((occurrence) => {
      if (materializedKeys.has(occurrence.occurrenceKey)) return false; // ya contada arriba como materializada.
      if (occurrence.materializationStatus === 'cancelled' || occurrence.materializationStatus === 'rescheduled') return false;
      const occurrenceDateKey = getLocalDateKey(occurrence.start, rule.timezone);
      const startMinutes = minutesOfDay(occurrence.hour, occurrence.minute);
      const endMinutes = startMinutes + occurrence.durationMinutes;
      return !isBlockedByAvailability(occurrenceDateKey, startMinutes, endMinutes, availability);
    }).length;
  }

  return count;
}

function studentInLessonRoster(lesson: CalendarLesson, studentId: string): boolean {
  return lesson.studentId === studentId || lesson.participants.some((participant) => participant.studentId === studentId);
}

export interface RuleParticipantOccurrenceInPeriodInput {
  rule: RecurrenceRule;
  studentId: string;
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
  /** YYYY-MM-DD, inclusive. */
  rangeStartDateKey: string;
  /** YYYY-MM-DD, inclusive. */
  rangeEndDateKey: string;
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS, regla "se cobra si tuvo al menos una ocurrencia mientras
 * era participante"): a diferencia de `countRuleOccurrencesInRange` (cuenta
 * TODAS las ocurrencias de la regla, sin mirar de quién), esta función
 * responde "¿participó `studentId` en AL MENOS UNA ocurrencia real de esta
 * regla dentro del rango?" — necesario porque el roster de una serie puede
 * cambiar a mitad de camino (`calendarParticipantsFromDate.ts`: agregar/
 * quitar alumnos "desde una fecha" congela el roster VIEJO en cada
 * `CalendarLesson` ya materializada antes del corte, y deja el roster NUEVO
 * en `rule.participantIds` para las ocurrencias futuras/no materializadas).
 *
 * Dos fuentes, nunca una sola:
 *   1. `CalendarLesson`s YA MATERIALIZADAS de esta regla dentro del rango
 *      (hecho persistido — se evalúan SIEMPRE, sin importar el
 *      `rule.status` ACTUAL; una clase que de verdad ya ocurrió o quedó
 *      agendada no deja de haber pasado sólo porque la serie se finalizó
 *      después). Se usa `recurrenceOriginalStart ?? start` como fecha
 *      lógica, mismo criterio que el resto de este módulo, y se excluyen las
 *      canceladas.
 *   2. Ocurrencias todavía VIRTUALES (no materializadas) de la regla en ese
 *      rango — sólo pueden existir si `rule.status === 'active'`
 *      (`generateOccurrences` devuelve `[]` si no), y su roster es siempre
 *      el ACTUAL de la regla (`GeneratedOccurrence.participantIds`), que es
 *      correcto para una ocurrencia que todavía no se congeló.
 *
 * Nunca cuenta dos veces la misma ocurrencia real (una ya materializada se
 * excluye de la fuente 2 por `occurrenceKey`). Pura.
 */
export function hasRuleOccurrenceForParticipantInPeriod(input: RuleParticipantOccurrenceInPeriodInput): boolean {
  const { rule, studentId, exceptions, existingLessons, availability, rangeStartDateKey, rangeEndDateKey } = input;
  if (daysBetweenDateKeys(rangeStartDateKey, rangeEndDateKey) < 0) return false;

  const relevantLessons = existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId);

  const materializedInRange = relevantLessons.filter((lesson) => {
    if (lesson.status === 'cancelled') return false;
    const logicalDateKey = getLocalDateKey(lesson.recurrenceOriginalStart ?? lesson.start, rule.timezone);
    return logicalDateKey >= rangeStartDateKey && logicalDateKey <= rangeEndDateKey;
  });
  if (materializedInRange.some((lesson) => studentInLessonRoster(lesson, studentId))) return true;

  if (rule.status !== 'active') return false;

  const rangeStart = new Date(
    localDateTimeToInstantIso({ date: rangeStartDateKey, hour: 0, minute: 0, timeZone: rule.timezone })
  );
  const rangeEnd = new Date(
    localDateTimeToInstantIso({ date: rangeEndDateKey, hour: 23, minute: 59, timeZone: rule.timezone })
  );
  const rawOccurrences = generateOccurrences(rule, rangeStart, rangeEnd);
  const withStatus = applyExceptionsToOccurrences(rawOccurrences, exceptions, relevantLessons);
  const materializedKeys = new Set(
    relevantLessons.map((lesson) => lesson.recurrenceOccurrenceKey).filter((key): key is string => Boolean(key))
  );

  return withStatus.some((occurrence) => {
    if (materializedKeys.has(occurrence.occurrenceKey)) return false; // ya evaluado como hecho persistido arriba.
    if (occurrence.materializationStatus === 'cancelled' || occurrence.materializationStatus === 'rescheduled') return false;
    if (!occurrence.participantIds.includes(studentId)) return false;
    const occurrenceDateKey = getLocalDateKey(occurrence.start, rule.timezone);
    const startMinutes = minutesOfDay(occurrence.hour, occurrence.minute);
    const endMinutes = startMinutes + occurrence.durationMinutes;
    return !isBlockedByAvailability(occurrenceDateKey, startMinutes, endMinutes, availability);
  });
}

/**
 * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
 * ENTRENAMIENTOS que comienzan/incorporan un participante a mitad de mes):
 * misma doble fuente EXACTA que `hasRuleOccurrenceForParticipantInPeriod`
 * (clases ya materializadas + ocurrencias virtuales todavía no
 * materializadas) — pero en vez de responder sólo "¿participó alguna vez?",
 * busca la fecha real MÁS TEMPRANA dentro del rango en la que `studentId`
 * participa de una ocurrencia real. Es la fuente de verdad de "desde cuándo"
 * un participante está realmente en una serie, para el primer período
 * proporcional — nunca infiere esa fecha de otro campo (fecha de alta del
 * alumno, `createdAt` del acuerdo, "ahora"). `null` si no participa de
 * ninguna ocurrencia real del rango. Pura.
 */
export function resolveEarliestParticipantOccurrenceDateInRange(input: RuleParticipantOccurrenceInPeriodInput): string | null {
  const { rule, studentId, exceptions, existingLessons, availability, rangeStartDateKey, rangeEndDateKey } = input;
  if (daysBetweenDateKeys(rangeStartDateKey, rangeEndDateKey) < 0) return null;

  const relevantLessons = existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId);

  const materializedInRange = relevantLessons.filter((lesson) => {
    if (lesson.status === 'cancelled') return false;
    const logicalDateKey = getLocalDateKey(lesson.recurrenceOriginalStart ?? lesson.start, rule.timezone);
    return logicalDateKey >= rangeStartDateKey && logicalDateKey <= rangeEndDateKey;
  });

  let earliest: string | null = null;
  const considerDate = (dateKey: string): void => {
    if (earliest === null || dateKey < earliest) earliest = dateKey;
  };

  materializedInRange.forEach((lesson) => {
    if (!studentInLessonRoster(lesson, studentId)) return;
    considerDate(getLocalDateKey(lesson.recurrenceOriginalStart ?? lesson.start, rule.timezone));
  });

  if (rule.status === 'active') {
    const rangeStart = new Date(
      localDateTimeToInstantIso({ date: rangeStartDateKey, hour: 0, minute: 0, timeZone: rule.timezone })
    );
    const rangeEnd = new Date(
      localDateTimeToInstantIso({ date: rangeEndDateKey, hour: 23, minute: 59, timeZone: rule.timezone })
    );
    const rawOccurrences = generateOccurrences(rule, rangeStart, rangeEnd);
    const withStatus = applyExceptionsToOccurrences(rawOccurrences, exceptions, relevantLessons);
    const materializedKeys = new Set(
      relevantLessons.map((lesson) => lesson.recurrenceOccurrenceKey).filter((key): key is string => Boolean(key))
    );

    withStatus.forEach((occurrence) => {
      if (materializedKeys.has(occurrence.occurrenceKey)) return; // ya evaluado como hecho persistido arriba.
      if (occurrence.materializationStatus === 'cancelled' || occurrence.materializationStatus === 'rescheduled') return;
      if (!occurrence.participantIds.includes(studentId)) return;
      const occurrenceDateKey = getLocalDateKey(occurrence.start, rule.timezone);
      const startMinutes = minutesOfDay(occurrence.hour, occurrence.minute);
      const endMinutes = startMinutes + occurrence.durationMinutes;
      if (isBlockedByAvailability(occurrenceDateKey, startMinutes, endMinutes, availability)) return;
      considerDate(occurrenceDateKey);
    });
  }

  return earliest;
}
