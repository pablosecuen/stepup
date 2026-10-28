// Puerto VERBATIM del original (`src/features/calendar/utils/calendarClassTitleFromDate.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../types/index.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, generateOccurrences, resolveOccurrenceParticipants } from './calendarRecurrenceEngine.ts';
import { getLocalDateKey } from './calendarTimezone.ts';

export interface ClassTitleFromDatePlan {
  nextRule: RecurrenceRule;
  lessonsToUpsert: CalendarLesson[];
}

/**
 * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la clase,
 * alcance "Esta y las siguientes"): mismo mecanismo que ya usa
 * `planParticipantsFromDate` para el mismo alcance — actualiza
 * `rule.classTitle` en la MISMA regla (nunca crea una serie sucesora con
 * `splitRecurrenceFromDate`, decisión explícita de Joaquín) y "congela" con
 * el título VIEJO cualquier ocurrencia virtual anterior a la fecha elegida
 * que todavía no esté materializada, para que cambiar la regla no le
 * cambie en el acto el título a una clase que quedó antes del corte.
 *
 * Recibe `targetLesson` (la clase puntual elegida, con su `.start` real) en
 * vez de buscarla dentro de `generateOccurrences(rule, now, ...)` — esa
 * búsqueda falla en silencio cuando la fecha elegida ya pasó respecto de
 * "ahora" (el motor sólo genera ocurrencias desde `now` en adelante), y
 * antes de esto tapaba el mensaje real ("ya pasó") con un genérico "no se
 * encontró la clase". Mismo criterio que `planParticipantsFromDate`, que
 * ya usa `updatedLesson.start` por la misma razón.
 */
export function planClassTitleFromDate(input: {
  rule: RecurrenceRule;
  targetLesson: CalendarLesson;
  newClassTitle: string | undefined;
  existingLessons: CalendarLesson[];
  exceptions: RecurrenceException[];
  students: StudentListItem[];
  now: Date;
  horizonEnd: Date;
}): ClassTitleFromDatePlan {
  const { rule, targetLesson, newClassTitle, existingLessons, exceptions, students, now, horizonEnd } = input;

  if (!targetLesson.recurrenceOccurrenceKey) {
    throw new Error('La clase no pertenece a una repetición identificable.');
  }

  const todayDate = getLocalDateKey(now.toISOString(), rule.timezone);
  const effectiveDate = getLocalDateKey(targetLesson.start, rule.timezone);
  if (effectiveDate < todayDate) {
    throw new Error('No se puede aplicar este cambio a una clase que ya pasó.');
  }

  const oldClassTitle = rule.classTitle;
  const nextRule: RecurrenceRule = { ...rule, classTitle: newClassTitle };

  const relevantLessons = existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId);
  const studentById = new Map(students.map((student) => [student.id, student]));
  const materializedByKey = new Map(
    relevantLessons
      .filter((lesson): lesson is CalendarLesson & { recurrenceOccurrenceKey: string } =>
        Boolean(lesson.recurrenceOccurrenceKey)
      )
      .map((lesson) => [lesson.recurrenceOccurrenceKey, lesson])
  );

  const occurrences = applyExceptionsToOccurrences(
    generateOccurrences(rule, now, horizonEnd),
    exceptions,
    relevantLessons
  );

  const lessonsToUpsert: CalendarLesson[] = [];

  occurrences.forEach((occurrence) => {
    if (occurrence.occurrenceKey === targetLesson.recurrenceOccurrenceKey) {
      lessonsToUpsert.push({ ...targetLesson, classTitle: newClassTitle });
      return;
    }
    if (
      occurrence.materializationStatus === 'cancelled' ||
      occurrence.materializationStatus === 'rescheduled'
    ) {
      // Excepciones persistentes: nunca se reviven ni se tocan acá.
      return;
    }

    const occurrenceDate = getLocalDateKey(occurrence.start, rule.timezone);
    const already = materializedByKey.get(occurrence.occurrenceKey);

    if (occurrenceDate < effectiveDate) {
      if (already) return; // ya tiene su propio título persistido (o ausente = automático) — nunca se toca.
      const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
      lessonsToUpsert.push({ ...buildLessonFromOccurrence(occurrence, primary, additional), classTitle: oldClassTitle });
      return;
    }

    if (already) {
      lessonsToUpsert.push({ ...already, classTitle: newClassTitle });
    } else {
      const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
      lessonsToUpsert.push({ ...buildLessonFromOccurrence(occurrence, primary, additional), classTitle: newClassTitle });
    }
  });

  return { nextRule, lessonsToUpsert };
}
