// Puerto VERBATIM del original (`src/features/dashboard/utils/calendarOccurrenceRange.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, generateOccurrences, resolveOccurrenceParticipants } from '../../calendar/utils/calendarRecurrenceEngine.ts';
import type { StudentListItem } from '../../students/types/index.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — Home/navegación/búsqueda):
 * módulo neutral, sin lógica propia de Home ni de "clases pendientes" —
 * sólo el cruce de clases reales + ocurrencias virtuales generadas dentro
 * de un rango de fechas. `buildDashboardData.ts` (semana actual) y
 * `pendingClasses.ts` (últimos N días) lo importan a los dos; vive acá
 * aparte para que ninguno de los dos dependa del otro (evita un ciclo de
 * imports).
 */
export interface CalendarOccurrenceSources {
  students: StudentListItem[];
  lessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
}

export function buildLessonsInRange(
  sources: CalendarOccurrenceSources,
  rangeStart: Date,
  rangeEnd: Date
): CalendarLesson[] {
  const studentById = new Map(sources.students.map((student) => [student.id, student]));
  const virtualLessons = sources.recurrenceRules.flatMap((rule) =>
    applyExceptionsToOccurrences(
      generateOccurrences(rule, rangeStart, rangeEnd),
      sources.recurrenceExceptions,
      sources.lessons
    )
      .filter((occurrence) => occurrence.materializationStatus === 'virtual')
      .map((occurrence) => {
        const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
        return primary || additional.length > 0 ? buildLessonFromOccurrence(occurrence, primary, additional) : null;
      })
      .filter((lesson): lesson is CalendarLesson => lesson !== null)
  );

  return [...sources.lessons, ...virtualLessons]
    .filter((lesson) => {
      const start = new Date(lesson.start).getTime();
      return start >= rangeStart.getTime() && start < rangeEnd.getTime();
    })
    .sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime());
}
