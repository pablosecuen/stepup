import { addDaysToDateKey, daysBetweenDateKeys, getDateKeyJsDay, getLocalDateKey, localDateTimeToInstantIso } from "./timezone.ts";
import { jsDayToAppWeekday } from "./weekday.ts";
import type {
  CalendarLessonForEngine,
  GeneratedOccurrence,
  RecurrenceExceptionForEngine,
  RecurrenceRuleForEngine,
} from "./types";

/**
 * Puerto del motor puro de recurrencias (móvil,
 * `src/features/calendar/utils/calendarRecurrenceEngine.ts`) —
 * `generateOccurrences`/`applyExceptionsToOccurrences`/`buildOccurrenceKey`
 * SIN cambios de algoritmo. Es la única fuente de "qué ocurrencias
 * produce una serie" en toda la Fase 3 — nunca se materializan clases
 * futuras infinitas: una serie es sólo `recurrence_rules` + `weeks`
 * (jsonb); las ocurrencias se GENERAN en memoria para el rango pedido
 * (semana/día visible), y sólo se combinan con `calendar_lessons`
 * (materializadas) + `recurrence_exceptions` (canceladas/reprogramadas)
 * cuando existen.
 */
export const DEFAULT_RECURRENCE_HORIZON_DAYS = 60;

export function assertRecurrenceRule(rule: RecurrenceRuleForEngine): void {
  if (!rule.recurrenceId.trim()) throw new Error("La regla necesita un id.");
  if (rule.cycleLengthWeeks < 1 || rule.cycleLengthWeeks > 4) {
    throw new RangeError("El ciclo debe tener entre 1 y 4 semanas.");
  }
  if (jsDayToAppWeekday(getDateKeyJsDay(rule.startDate)) !== 0) {
    throw new RangeError("startDate debe ser el lunes local de la semana 0.");
  }
  if (rule.endDate && daysBetweenDateKeys(rule.startDate, rule.endDate) < 0) {
    throw new RangeError("endDate no puede ser anterior a startDate.");
  }

  const weekIndexes = new Set(rule.weeks.map((week) => week.weekIndex));
  if (weekIndexes.size !== rule.cycleLengthWeeks) {
    throw new Error("La regla debe definir exactamente cada semana del ciclo.");
  }
  for (let index = 0; index < rule.cycleLengthWeeks; index += 1) {
    if (!weekIndexes.has(index)) throw new Error(`Falta la semana ${index} del ciclo.`);
  }

  rule.weeks.forEach((week) => {
    if (week.weekIndex < 0 || week.weekIndex >= rule.cycleLengthWeeks) {
      throw new RangeError("weekIndex está fuera del ciclo.");
    }
    week.sessions.forEach((session) => {
      if (session.weekday < 0 || session.weekday > 6) throw new RangeError("weekday debe estar entre 0 y 6.");
      if (!Number.isInteger(session.hour) || session.hour < 0 || session.hour > 23) {
        throw new RangeError("La hora debe estar entre 0 y 23.");
      }
      if (!Number.isInteger(session.minute) || session.minute < 0 || session.minute > 59) {
        throw new RangeError("Los minutos deben estar entre 0 y 59.");
      }
      if (!Number.isInteger(session.durationMinutes) || session.durationMinutes <= 0) {
        throw new RangeError("La duración debe ser un entero positivo.");
      }
    });
  });
}

export function buildOccurrenceKey(params: {
  recurrenceId: string;
  absoluteWeekNumber: number;
  weekIndexInCycle: number;
  weekday: number;
  hour: number;
  minute: number;
  sessionIndex: number;
}): string {
  const { recurrenceId, absoluteWeekNumber, weekIndexInCycle, weekday, hour, minute, sessionIndex } = params;
  return [
    recurrenceId,
    `w${absoluteWeekNumber}`,
    `c${weekIndexInCycle}`,
    `d${weekday}`,
    `t${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
    `s${sessionIndex}`,
  ].join(":");
}

export function generateOccurrences(rule: RecurrenceRuleForEngine, rangeStart: Date, rangeEnd: Date): GeneratedOccurrence[] {
  assertRecurrenceRule(rule);

  const rangeStartTime = rangeStart.getTime();
  const rangeEndTime = rangeEnd.getTime();
  if (!Number.isFinite(rangeStartTime) || !Number.isFinite(rangeEndTime) || rangeEndTime < rangeStartTime) {
    throw new RangeError("El rango de generación es inválido.");
  }
  if (rule.status !== "active") return [];

  const rangeStartDate = getLocalDateKey(rangeStart.toISOString(), rule.timezone);
  const rangeEndDate = getLocalDateKey(rangeEnd.toISOString(), rule.timezone);
  const firstDate = daysBetweenDateKeys(rule.startDate, rangeStartDate) > 0 ? rangeStartDate : rule.startDate;
  const finalDate = rule.endDate && daysBetweenDateKeys(rule.endDate, rangeEndDate) > 0 ? rule.endDate : rangeEndDate;

  if (daysBetweenDateKeys(firstDate, finalDate) < 0) return [];

  const participantIds = rule.participantIds.length > 0 ? rule.participantIds : rule.studentId ? [rule.studentId] : [];

  const occurrences: GeneratedOccurrence[] = [];
  const totalDays = daysBetweenDateKeys(firstDate, finalDate);

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset += 1) {
    const localDate = addDaysToDateKey(firstDate, dayOffset);
    const daysFromRuleStart = daysBetweenDateKeys(rule.startDate, localDate);
    if (daysFromRuleStart < 0) continue;

    const absoluteWeekNumber = Math.floor(daysFromRuleStart / 7);
    const weekIndexInCycle = absoluteWeekNumber % rule.cycleLengthWeeks;
    const recurrenceWeek = rule.weeks.find((week) => week.weekIndex === weekIndexInCycle);
    if (!recurrenceWeek) continue;

    const weekday = jsDayToAppWeekday(getDateKeyJsDay(localDate));
    recurrenceWeek.sessions.forEach((session, sessionIndex) => {
      if (session.weekday !== weekday) return;

      const start = localDateTimeToInstantIso({ date: localDate, hour: session.hour, minute: session.minute, timeZone: rule.timezone });
      const startTime = new Date(start).getTime();
      if (startTime < rangeStartTime || startTime > rangeEndTime) return;

      const end = new Date(startTime + session.durationMinutes * 60_000).toISOString();
      occurrences.push({
        occurrenceKey: buildOccurrenceKey({
          recurrenceId: rule.recurrenceId,
          absoluteWeekNumber,
          weekIndexInCycle,
          weekday,
          hour: session.hour,
          minute: session.minute,
          sessionIndex,
        }),
        recurrenceId: rule.recurrenceId,
        studentId: rule.studentId,
        participantIds,
        absoluteWeekNumber,
        weekIndexInCycle,
        weekday,
        sessionIndex,
        hour: session.hour,
        minute: session.minute,
        durationMinutes: session.durationMinutes,
        modality: rule.modality,
        start,
        end,
        materializationStatus: "virtual",
        materializedLessonId: null,
        classTitle: rule.classTitle,
        activityKind: rule.activityKind,
      });
    });
  }

  return occurrences.sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime());
}

export function applyExceptionsToOccurrences(
  occurrences: GeneratedOccurrence[],
  exceptions: RecurrenceExceptionForEngine[],
  existingLessons: CalendarLessonForEngine[]
): GeneratedOccurrence[] {
  const exceptionByKey = new Map(exceptions.map((exception) => [`${exception.recurrenceId}|${exception.occurrenceKey}`, exception]));
  const lessonByKey = new Map<string, CalendarLessonForEngine>();
  existingLessons.forEach((lesson) => {
    if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
      lessonByKey.set(`${lesson.recurrenceId}|${lesson.recurrenceOccurrenceKey}`, lesson);
    }
  });

  const unique = new Map<string, GeneratedOccurrence>();
  occurrences.forEach((occurrence) => {
    const compoundKey = `${occurrence.recurrenceId}|${occurrence.occurrenceKey}`;
    const exception = exceptionByKey.get(compoundKey);
    if (exception?.type === "excluded") return;

    const materializedLesson = lessonByKey.get(compoundKey);
    let materializationStatus = occurrence.materializationStatus;
    let materializedLessonId = occurrence.materializedLessonId;

    if (exception?.type === "cancelled" || materializedLesson?.status === "cancelled") {
      materializationStatus = "cancelled";
      materializedLessonId = materializedLesson?.id ?? null;
    } else if (exception?.type === "rescheduled") {
      materializationStatus = "rescheduled";
      materializedLessonId = exception.replacementLessonId ?? null;
    } else if (materializedLesson) {
      materializationStatus = "materialized";
      materializedLessonId = materializedLesson.id;
    }

    unique.set(compoundKey, { ...occurrence, materializationStatus, materializedLessonId });
  });

  return Array.from(unique.values());
}
