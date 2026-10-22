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

/**
 * Cuántos días hacia atrás se conservan las clases YA PASADAS todavía sin registrar: es la misma ventana con la que Inicio y Registro
 * listan las clases por registrar. Una clase pasada sin registrar sigue siendo virtual (no tiene fila): si no se congela con el grupo
 * de ese momento, al sacar a un alumno del grupo esa clase perdería su asistencia y ya no se podría registrar con él.
 */
export const FREEZE_LOOKBACK_DAYS = 90;

export function planParticipantFreeze(params: {
  rule: RecurrenceRuleForEngine;
  now: Date;
  effectiveDateIso: string;
  existingLessons: CalendarLessonForEngine[];
  /** Claves de ocurrencia con una excepción (cancelada, reprogramada o excluida): nunca se congelan, ya tienen su tratamiento propio. */
  exceptionKeys?: ReadonlySet<string>;
}): OccurrenceToFreeze[] {
  const { rule, now, effectiveDateIso, existingLessons } = params;
  const effectiveTime = new Date(effectiveDateIso).getTime();
  if (!Number.isFinite(effectiveTime)) return [];
  const windowStart = new Date(now.getTime() - FREEZE_LOOKBACK_DAYS * 86_400_000);
  if (effectiveTime <= windowStart.getTime()) return [];

  const occurrences = generateOccurrences(rule, windowStart, new Date(effectiveDateIso));
  const materializedKeys = new Set(
    existingLessons.filter((lesson) => lesson.recurrenceId === rule.recurrenceId && lesson.recurrenceOccurrenceKey).map((lesson) => lesson.recurrenceOccurrenceKey as string)
  );
  const exceptionKeys = params.exceptionKeys ?? new Set<string>();

  return occurrences
    .filter((occurrence) => new Date(occurrence.start).getTime() < effectiveTime && !materializedKeys.has(occurrence.occurrenceKey) && !exceptionKeys.has(occurrence.occurrenceKey))
    .map((occurrence) => ({
      occurrenceKey: occurrence.occurrenceKey,
      recurrenceIndex: occurrence.absoluteWeekNumber,
      start: occurrence.start,
      end: occurrence.end,
    }));
}
