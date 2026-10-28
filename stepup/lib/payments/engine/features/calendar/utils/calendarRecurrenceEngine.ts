// Puerto VERBATIM del original (`src/features/calendar/utils/calendarRecurrenceEngine.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../students/types/index.ts';
import { joinLevelsForDisplay } from '../../students/utils/studentLevelsCore.ts';
import type {
  CalendarLesson,
  GeneratedOccurrence,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';
import { addDaysToDateKey, daysBetweenDateKeys, getDateKeyJsDay, getLocalDateKey, localDateTimeToInstantIso } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';

export const DEFAULT_RECURRENCE_HORIZON_DAYS = 60;

function assertRecurrenceRule(rule: RecurrenceRule): void {
  if (!rule.recurrenceId.trim()) throw new Error('La regla necesita recurrenceId.');
  // Corrección 2026-07-20 (a pedido de Joaquín — agendar series sin
  // alumnos): `studentId` ya no es obligatorio. Una serie puede reservar
  // el horario ("Serie sin alumnos") y recibir su alumno después — mismo
  // criterio ya aprobado para una clase suelta. Vacío es un valor válido,
  // nunca se exige más que eso.
  if (rule.cycleLengthWeeks < 1 || rule.cycleLengthWeeks > 4) {
    throw new RangeError('El ciclo debe tener entre 1 y 4 semanas.');
  }
  if (jsDayToAppWeekday(getDateKeyJsDay(rule.startDate)) !== 0) {
    throw new RangeError('startDate debe ser el lunes local de la semana 0.');
  }
  if (rule.endDate && daysBetweenDateKeys(rule.startDate, rule.endDate) < 0) {
    throw new RangeError('endDate no puede ser anterior a startDate.');
  }

  const weekIndexes = new Set(rule.weeks.map((week) => week.weekIndex));
  if (weekIndexes.size !== rule.cycleLengthWeeks) {
    throw new Error('La regla debe definir exactamente cada semana del ciclo.');
  }

  for (let index = 0; index < rule.cycleLengthWeeks; index += 1) {
    if (!weekIndexes.has(index)) {
      throw new Error(`Falta la semana ${index} del ciclo.`);
    }
  }

  rule.weeks.forEach((week) => {
    if (week.weekIndex < 0 || week.weekIndex >= rule.cycleLengthWeeks) {
      throw new RangeError('weekIndex está fuera del ciclo.');
    }

    week.sessions.forEach((session) => {
      if (session.weekday < 0 || session.weekday > 6) {
        throw new RangeError('weekday debe estar entre 0 y 6.');
      }
      if (!Number.isInteger(session.hour) || session.hour < 0 || session.hour > 23) {
        throw new RangeError('La hora debe estar entre 0 y 23.');
      }
      if (
        !Number.isInteger(session.minute) ||
        session.minute < 0 ||
        session.minute > 59
      ) {
        throw new RangeError('Los minutos deben estar entre 0 y 59.');
      }
      if (!Number.isInteger(session.durationMinutes) || session.durationMinutes <= 0) {
        throw new RangeError('La duración debe ser un entero positivo.');
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
  const {
    recurrenceId,
    absoluteWeekNumber,
    weekIndexInCycle,
    weekday,
    hour,
    minute,
    sessionIndex,
  } = params;

  return [
    recurrenceId,
    `w${absoluteWeekNumber}`,
    `c${weekIndexInCycle}`,
    `d${weekday}`,
    `t${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`,
    `s${sessionIndex}`,
  ].join(':');
}

export function generateOccurrences(
  rule: RecurrenceRule,
  rangeStart: Date,
  rangeEnd: Date
): GeneratedOccurrence[] {
  assertRecurrenceRule(rule);

  const rangeStartTime = rangeStart.getTime();
  const rangeEndTime = rangeEnd.getTime();
  if (
    !Number.isFinite(rangeStartTime) ||
    !Number.isFinite(rangeEndTime) ||
    rangeEndTime < rangeStartTime
  ) {
    throw new RangeError('El rango de generación es inválido.');
  }
  if (rule.status !== 'active') return [];

  const rangeStartDate = getLocalDateKey(rangeStart.toISOString(), rule.timezone);
  const rangeEndDate = getLocalDateKey(rangeEnd.toISOString(), rule.timezone);
  const firstDate =
    daysBetweenDateKeys(rule.startDate, rangeStartDate) > 0
      ? rangeStartDate
      : rule.startDate;
  const finalDate =
    rule.endDate && daysBetweenDateKeys(rule.endDate, rangeEndDate) > 0
      ? rule.endDate
      : rangeEndDate;

  if (daysBetweenDateKeys(firstDate, finalDate) < 0) return [];

  const participantIds =
    rule.participantIds && rule.participantIds.length > 0
      ? rule.participantIds
      : rule.studentId
        ? [rule.studentId]
        : [];

  const occurrences: GeneratedOccurrence[] = [];
  const totalDays = daysBetweenDateKeys(firstDate, finalDate);

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset += 1) {
    const localDate = addDaysToDateKey(firstDate, dayOffset);
    const daysFromRuleStart = daysBetweenDateKeys(rule.startDate, localDate);
    if (daysFromRuleStart < 0) continue;

    const absoluteWeekNumber = Math.floor(daysFromRuleStart / 7);
    const weekIndexInCycle = absoluteWeekNumber % rule.cycleLengthWeeks;
    const recurrenceWeek = rule.weeks.find(
      (week) => week.weekIndex === weekIndexInCycle
    );
    if (!recurrenceWeek) continue;

    const weekday = jsDayToAppWeekday(getDateKeyJsDay(localDate));
    recurrenceWeek.sessions.forEach((session, sessionIndex) => {
      if (session.weekday !== weekday) return;

      const start = localDateTimeToInstantIso({
        date: localDate,
        hour: session.hour,
        minute: session.minute,
        timeZone: rule.timezone,
      });
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
        materializationStatus: 'virtual',
        materializedLessonId: null,
        classTitle: rule.classTitle,
        activityKind: rule.activityKind,
      });
    });
  }

  return occurrences.sort(
    (first, second) => new Date(first.start).getTime() - new Date(second.start).getTime()
  );
}

export function applyExceptionsToOccurrences(
  occurrences: GeneratedOccurrence[],
  exceptions: RecurrenceException[],
  existingLessons: CalendarLesson[]
): GeneratedOccurrence[] {
  const exceptionByKey = new Map(
    exceptions.map((exception) => [
      `${exception.recurrenceId}|${exception.occurrenceKey}`,
      exception,
    ])
  );
  const lessonByKey = new Map<string, CalendarLesson>();
  existingLessons.forEach((lesson) => {
    if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
      lessonByKey.set(
        `${lesson.recurrenceId}|${lesson.recurrenceOccurrenceKey}`,
        lesson
      );
    }
  });

  const unique = new Map<string, GeneratedOccurrence>();
  occurrences.forEach((occurrence) => {
    const compoundKey = `${occurrence.recurrenceId}|${occurrence.occurrenceKey}`;
    const exception = exceptionByKey.get(compoundKey);
    if (exception?.type === 'excluded') return;

    const materializedLesson = lessonByKey.get(compoundKey);
    let materializationStatus = occurrence.materializationStatus;
    let materializedLessonId = occurrence.materializedLessonId;

    if (exception?.type === 'cancelled' || materializedLesson?.status === 'cancelled') {
      materializationStatus = 'cancelled';
      materializedLessonId = materializedLesson?.id ?? null;
    } else if (exception?.type === 'rescheduled') {
      materializationStatus = 'rescheduled';
      materializedLessonId = exception.replacementLessonId ?? null;
    } else if (materializedLesson) {
      materializationStatus = 'materialized';
      materializedLessonId = materializedLesson.id;
    }

    unique.set(compoundKey, {
      ...occurrence,
      materializationStatus,
      materializedLessonId,
    });
  });

  return Array.from(unique.values());
}

/**
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — VERDE EXCLUSIVO
 * PARA CLASES DE REEMPLAZO): el valor que devuelve esta función
 * (`CalendarLesson.color`) nunca lo lee ninguna tarjeta real — el color
 * real de pantalla lo decide `resolveLessonColor` en
 * `calendarVisualLegend.ts`, la única fuente de verdad visual — pero para
 * que este campo, aunque sin uso real hoy, nunca pueda entregar el verde
 * reservado si algo llegara a leerlo, "presencial" pasa de `#E3F6E8`
 * (verde) a `#FFE4D2` (el mismo peach real que ya usa
 * `MODALITY_LEGEND.presencial`).
 */
export function lessonColorForModality(modality: CalendarLesson['modality']): string {
  if (modality === 'online') return '#DDEBFF';
  if (modality === 'mixta') return '#F2E8FF';
  return '#FFE4D2';
}

// Corrección 2026-07-20 (a pedido de Joaquín — agendar series sin
// alumnos): mismo texto canónico que ya usa una clase suelta vacía
// (`PENDING_ASSIGNMENT_LABEL` en NewCalendarLessonSheet.tsx), pero
// distinguible como serie — el pedido explícitamente pide "Serie sin
// alumnos" en vez de "Clase sin alumnos" para una ocurrencia recurrente.
export const PENDING_ASSIGNMENT_SERIES_LABEL = 'Serie sin alumnos';

/**
 * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor):
 * `additionalParticipants` es aditivo y opcional — con la lista vacía por
 * defecto, se comporta exactamente igual que antes (una serie con un solo
 * alumno). Cuando `occurrence.participantIds` trae más de un id (serie
 * grupal), el llamador resuelve los alumnos extra y los pasa acá para que
 * la ocurrencia VIRTUAL (todavía no materializada) muestre a todos los
 * participantes, no sólo al principal — nunca los pierde en silencio.
 */
export function buildLessonFromOccurrence(
  occurrence: GeneratedOccurrence,
  student: StudentListItem | null,
  additionalParticipants: StudentListItem[] = []
): CalendarLesson {
  if (student && occurrence.studentId !== student.id) {
    throw new Error('La ocurrencia y el alumno no coinciden.');
  }

  const allParticipants = student ? [student, ...additionalParticipants] : additionalParticipants;

  return {
    id: `calendar_${occurrence.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    studentId: student?.id ?? '',
    studentName: student?.name ?? PENDING_ASSIGNMENT_SERIES_LABEL,
    level: student ? joinLevelsForDisplay(student.levels) : '',
    participants: allParticipants.map((participant) => ({
      studentId: participant.id,
      studentName: participant.name,
      level: joinLevelsForDisplay(participant.levels),
    })),
    lessonType: allParticipants.length > 1 ? 'group' : 'individual',
    start: occurrence.start,
    end: occurrence.end,
    modality: occurrence.modality,
    status: 'scheduled',
    color: lessonColorForModality(occurrence.modality),
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: occurrence.recurrenceId,
    recurrenceOccurrenceKey: occurrence.occurrenceKey,
    recurrenceIndex: occurrence.absoluteWeekNumber * 100 + occurrence.sessionIndex,
    recurrenceOriginalStart: null,
    classTitle: occurrence.classTitle,
    activityKind: occurrence.activityKind,
  };
}

/**
 * Resuelve `occurrence.studentId` (principal) + el resto de
 * `occurrence.participantIds` contra el mapa de alumnos reales, en el
 * formato exacto que espera `buildLessonFromOccurrence`. Único punto que
 * hace esta resolución — todos los llamadores (calendario semanal, rango
 * de ocurrencias del dashboard, ajuste de horario) lo reusan en vez de
 * repetir el mismo filtro tres veces.
 */
export function resolveOccurrenceParticipants(
  occurrence: GeneratedOccurrence,
  studentById: Map<string, StudentListItem>
): { primary: StudentListItem | null; additional: StudentListItem[] } {
  const primary = studentById.get(occurrence.studentId) ?? null;
  const additional = occurrence.participantIds
    .filter((studentId) => studentId !== occurrence.studentId)
    .map((studentId) => studentById.get(studentId))
    .filter((student): student is StudentListItem => student !== undefined);
  return { primary, additional };
}
