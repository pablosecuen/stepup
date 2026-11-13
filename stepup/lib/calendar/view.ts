import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange, listRecurringLessonMarkers } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { NO_EXCLUDED_STUDENTS } from "@/lib/data-exclusion/exclusion";
import type { CalendarViewItem } from "./occurrences";
import { listCalendarReplacementLinks } from "@/lib/repositories/calendar-replacement-links";
import { composeCalendarView, type CalendarViewBase } from "./compose.ts";
export { composeCalendarView, type CalendarViewBase };

/**
 * Punto único que combina los 3 repositorios (series, clases
 * materializadas, excepciones) en la vista real del calendario para un
 * rango — Server Component/Action llama esto, nunca arma la consulta
 * dispersa por su cuenta.
 */
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
