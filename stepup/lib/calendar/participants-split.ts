import { generateOccurrences } from "./recurrence-engine.ts";
import type { CalendarLessonForEngine, RecurrenceRuleForEngine } from "./types";

/**
 * Puerto de `planParticipantsFromDate` (móvil,
 * `src/features/calendar/utils/calendarParticipantsFromDate.ts`). A
 * diferencia de "esta y las siguientes" (que cambia el PATRÓN y sí crea una
 * serie sucesora, `split.ts`), un cambio de PARTICIPANTES nunca crea una
 * serie nueva — muta el roster de la MISMA regla. El problema real: las
 * ocurrencias virtuales (no materializadas) de una regla derivan sus
 * participantes de un único array a nivel de regla (`participantIds`), así
 * que cambiar ese array afectaría en el acto cualquier ocurrencia virtual
 * ANTERIOR a la fecha efectiva que todavía no se haya materializado. Por
 * eso esas ocurrencias deben "congelarse" (materializarse) con el roster
 * VIEJO antes de que la regla cambie — nunca reinterpretan el pasado.
 */
export interface OccurrenceToFreeze {
  occurrenceKey: string;
  recurrenceIndex: number;
  start: string;
  end: string;
}

export function planParticipantFreeze(params: {
  rule: RecurrenceRuleForEngine;
  now: Date;
  effectiveDateIso: string;
  existingLessons: CalendarLessonForEngine[];
}): OccurrenceToFreeze[] {
  const { rule, now, effectiveDateIso, existingLessons } = params;
  const effectiveTime = new Date(effectiveDateIso).getTime();
  if (!Number.isFinite(effectiveTime) || effectiveTime <= now.getTime()) return [];

  const occurrences = generateOccurrences(rule, now, new Date(effectiveDateIso));
  const materializedKeys = new Set(
    existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId && lesson.recurrenceOccurrenceKey).map((lesson) => lesson.recurrenceOccurrenceKey as string)
  );

  return occurrences
    .filter((occurrence) => new Date(occurrence.start).getTime() < effectiveTime && !materializedKeys.has(occurrence.occurrenceKey))
    .map((occurrence) => ({
      occurrenceKey: occurrence.occurrenceKey,
      recurrenceIndex: occurrence.absoluteWeekNumber,
      start: occurrence.start,
      end: occurrence.end,
    }));
}
