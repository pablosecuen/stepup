import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange, listRecurringLessonMarkers } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { NO_EXCLUDED_STUDENTS, withoutExcludedLessons, withoutExcludedRules } from "@/lib/data-exclusion/exclusion";
import { buildCalendarViewForRange, type CalendarViewItem } from "./occurrences";
import { listCalendarReplacementLinks } from "@/lib/repositories/calendar-replacement-links";
import { applyReplacementVisibility, type CalendarReplacementLinks } from "./replacement-visibility";
import type { RecurrenceRuleForEngine } from "./types";

/**
 * Punto único que combina los 3 repositorios (series, clases
 * materializadas, excepciones) en la vista real del calendario para un
 * rango — Server Component/Action llama esto, nunca arma la consulta
 * dispersa por su cuenta.
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

/** `includeTestData`: las acciones que escriben (y la ficha de un alumno) ven TODO, incluidos los datos de prueba; las pantallas de agenda, pendientes y estadísticas no. */
export interface CalendarViewOptions {
  readonly includeTestData?: boolean;
}

export async function loadCalendarViewBase(ctx: AuthenticatedDbContext, options: CalendarViewOptions = {}): Promise<CalendarViewBase> {
  const [rules, students, occurrenceMarkers, excludedStudentIds, replacementLinks] = await Promise.all([
    listRecurrenceRules(ctx),
    listStudents(ctx),
    listRecurringLessonMarkers(ctx),
    options.includeTestData ? Promise.resolve(NO_EXCLUDED_STUDENTS) : loadExcludedStudentIds(ctx),
    listCalendarReplacementLinks(ctx),
  ]);
  const exceptions = await listRecurrenceExceptionsForRules(
    ctx,
    rules.map((rule) => rule.id)
  );
  return { rules, exceptions, students, occurrenceMarkers, excludedStudentIds, replacementLinks };
}

export async function loadCalendarViewForRange(ctx: AuthenticatedDbContext, rangeStart: Date, rangeEnd: Date, base?: CalendarViewBase, options: CalendarViewOptions = {}): Promise<CalendarViewItem[]> {
  if (base) {
    // Con la base ya cargada sólo se lee lo propio del rango: las clases materializadas.
    const lessons = await listCalendarLessonsInRange(ctx, rangeStart.toISOString(), rangeEnd.toISOString());
    return composeCalendarView(base, lessons, rangeStart, rangeEnd);
  }
  const rules = await listRecurrenceRules(ctx);
  const [lessons, exceptions, students, occurrenceMarkers, excludedStudentIds, replacementLinks] = await Promise.all([
    listCalendarLessonsInRange(ctx, rangeStart.toISOString(), rangeEnd.toISOString()),
    listRecurrenceExceptionsForRules(
      ctx,
      rules.map((rule) => rule.id)
    ),
    listStudents(ctx),
    listRecurringLessonMarkers(ctx),
    options.includeTestData ? Promise.resolve(NO_EXCLUDED_STUDENTS) : loadExcludedStudentIds(ctx),
    listCalendarReplacementLinks(ctx),
  ]);
  return composeCalendarView({ rules, exceptions, students, occurrenceMarkers, excludedStudentIds, replacementLinks }, lessons, rangeStart, rangeEnd);
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
