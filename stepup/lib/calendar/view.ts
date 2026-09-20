import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { buildCalendarViewForRange, type CalendarViewItem } from "./occurrences";
import type { RecurrenceRuleForEngine } from "./types";

/**
 * Punto único que combina los 3 repositorios (series, clases
 * materializadas, excepciones) en la vista real del calendario para un
 * rango — Server Component/Action llama esto, nunca arma la consulta
 * dispersa por su cuenta.
 */
export async function loadCalendarViewForRange(ctx: AuthenticatedDbContext, rangeStart: Date, rangeEnd: Date): Promise<CalendarViewItem[]> {
  const rules = await listRecurrenceRules(ctx);
  const [lessons, exceptions] = await Promise.all([
    listCalendarLessonsInRange(ctx, rangeStart.toISOString(), rangeEnd.toISOString()),
    listRecurrenceExceptionsForRules(
      ctx,
      rules.map((rule) => rule.id)
    ),
  ]);

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

  return buildCalendarViewForRange({
    rangeStart,
    rangeEnd,
    rules: engineRules,
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
      isRecurring: lesson.isRecurring,
      classTitle: lesson.classTitle,
      activityKind: lesson.activityKind,
      freedByLessonId: lesson.freedByLessonId,
      notes: lesson.notes,
      participantIds: lesson.participantIds,
    })),
  });
}
