import type { listRecurrenceRules } from "../repositories/recurrence-rules.ts";
import type { listCalendarLessonsInRange, listRecurringLessonMarkers } from "../repositories/calendar-lessons.ts";
import type { listRecurrenceExceptionsForRules } from "../repositories/recurrence-exceptions.ts";
import type { listStudents } from "../repositories/students.ts";
import { withoutExcludedLessons, withoutExcludedRules } from "../data-exclusion/exclusion.ts";
import { buildCalendarViewForRange, type CalendarViewItem } from "./occurrences.ts";
import { applyReplacementVisibility, type CalendarReplacementLinks } from "./replacement-visibility.ts";
import type { RecurrenceRuleForEngine } from "./types.ts";

/**
 * Composición PURA de la vista del calendario (sin consultas): series + excepciones + clases reales + vínculos explícitos de reemplazo. Vive aparte de `view.ts` (que lee la base y es
 * sólo de servidor) para poder probarse con las MISMAS filas que devuelven los repositorios. El resultado es la lista COMPLETA del rango (historia incluida); lo que se dibuja, cuenta o
 * valida sale de aplicarle la agenda operativa (`agenda.ts`).
 */
/**
 * Lo que NO depende del rango: series, excepciones y alumnos. Una pantalla que arma varias vistas del calendario (Inicio, Resumen
 * financiero) lo pide UNA vez y se lo pasa a cada `loadCalendarViewForRange` en vez de repetir las tres lecturas por rango.
 */
export interface CalendarViewBase {
  readonly replacementLinks?: CalendarReplacementLinks;
  readonly rules: Awaited<ReturnType<typeof listRecurrenceRules>>;
  readonly exceptions: Awaited<ReturnType<typeof listRecurrenceExceptionsForRules>>;
  readonly students: Awaited<ReturnType<typeof listStudents>>;
  /** Todas las clases de serie (cualquier fecha): para reconocer qué ocurrencias ya tienen su clase aunque esté fuera del rango. */
  readonly occurrenceMarkers: Awaited<ReturnType<typeof listRecurringLessonMarkers>>;
  /** Alumnos de PRUEBA confirmados (R16): sus series y clases —cuando son los únicos participantes— no se muestran. Vacío = todo se muestra. */
  readonly excludedStudentIds: ReadonlySet<string>;
}

/**
 * Arma la vista del calendario de un rango a partir de la base y de las clases de ESE rango. Es pura: quien necesite varios rangos
 * lee las clases de todos a la vez (en paralelo con la base) y compone cada vista cuando llegan.
 */
export function composeCalendarView(
  { rules: allRules, exceptions, students, occurrenceMarkers, excludedStudentIds, replacementLinks }: CalendarViewBase,
  allLessons: Awaited<ReturnType<typeof listCalendarLessonsInRange>>,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarViewItem[] {
  // Datos de prueba confirmados (R16): se ocultan sólo series y clases cuyos participantes son TODOS de prueba; con la lista vacía no cambia nada.
  const rules = withoutExcludedRules(allRules, excludedStudentIds);
  const lessons = withoutExcludedLessons(allLessons, excludedStudentIds);
  const engineRules: RecurrenceRuleForEngine[] = rules.map((rule) => ({
    recurrenceId: rule.id,
    studentId: rule.primaryStudentId,
    participantIds: rule.participantIds,
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks,
    modality: rule.modality,
    timezone: rule.timezone,
    startDate: rule.startDate,
    endDate: rule.endDate,
    status: rule.status,
    classTitle: rule.classTitle,
    activityKind: rule.activityKind,
  }));

  return applyReplacementVisibility(buildCalendarViewForRange({
    rangeStart,
    rangeEnd,
    rules: engineRules,
    occurrenceMarkers,
    students: new Map(students.map((student) => [student.id, { name: student.name, levels: student.levels }])),
    exceptions: exceptions.map((exception) => ({
      recurrenceId: exception.recurrenceId,
      occurrenceKey: exception.occurrenceKey,
      type: exception.type,
      replacementLessonId: exception.replacementLessonId,
    })),
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      recurrenceId: lesson.recurrenceId,
      recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
      primaryStudentId: lesson.primaryStudentId,
      studentName: lesson.studentName,
      level: lesson.level,
      lessonType: lesson.lessonType,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      modality: lesson.modality,
      status: lesson.status,
      recurrenceOriginalStart: lesson.recurrenceOriginalStart,
      closedOutcome: lesson.closedOutcome ?? null,
      isRecurring: lesson.isRecurring,
      classTitle: lesson.classTitle,
      activityKind: lesson.activityKind,
      freedByLessonId: lesson.freedByLessonId,
      notes: lesson.notes,
      participantIds: lesson.participantIds,
    })),
  }), replacementLinks);
}
