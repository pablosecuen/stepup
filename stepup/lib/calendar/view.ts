import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { listStudents } from "@/lib/repositories/students";
import { buildCalendarViewForRange, type CalendarViewItem } from "./occurrences";
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
  readonly rules: Awaited<ReturnType<typeof listRecurrenceRules>>;
  readonly exceptions: Awaited<ReturnType<typeof listRecurrenceExceptionsForRules>>;
  readonly students: Awaited<ReturnType<typeof listStudents>>;
}

export async function loadCalendarViewBase(ctx: AuthenticatedDbContext): Promise<CalendarViewBase> {
  const [rules, students] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx)]);
  const exceptions = await listRecurrenceExceptionsForRules(
    ctx,
    rules.map((rule) => rule.id)
  );
  return { rules, exceptions, students };
}

export async function loadCalendarViewForRange(ctx: AuthenticatedDbContext, rangeStart: Date, rangeEnd: Date, base?: CalendarViewBase): Promise<CalendarViewItem[]> {
  if (base) {
    // Con la base ya cargada sólo se lee lo propio del rango: las clases materializadas.
    const lessons = await listCalendarLessonsInRange(ctx, rangeStart.toISOString(), rangeEnd.toISOString());
    return composeCalendarView(base, lessons, rangeStart, rangeEnd);
  }
  const rules = await listRecurrenceRules(ctx);
  const [lessons, exceptions, students] = await Promise.all([
    listCalendarLessonsInRange(ctx, rangeStart.toISOString(), rangeEnd.toISOString()),
    listRecurrenceExceptionsForRules(
      ctx,
      rules.map((rule) => rule.id)
    ),
    listStudents(ctx),
  ]);
  return composeCalendarView({ rules, exceptions, students }, lessons, rangeStart, rangeEnd);
}

function composeCalendarView(
  { rules, exceptions, students }: CalendarViewBase,
  lessons: Awaited<ReturnType<typeof listCalendarLessonsInRange>>,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarViewItem[] {
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
      isRecurring: lesson.isRecurring,
      classTitle: lesson.classTitle,
      activityKind: lesson.activityKind,
      freedByLessonId: lesson.freedByLessonId,
      notes: lesson.notes,
      participantIds: lesson.participantIds,
    })),
  });
}
