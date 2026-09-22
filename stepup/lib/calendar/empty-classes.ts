import { applyExceptionsToOccurrences, DEFAULT_RECURRENCE_HORIZON_DAYS, generateOccurrences } from "./recurrence-engine.ts";
import type { CalendarLessonForEngine, RecurrenceExceptionForEngine, RecurrenceRuleForEngine } from "./types.ts";

/**
 * Puerto de `emptyClasses.ts` (móvil) — "Clases sin alumnos" agrupado: Inicio
 * nunca muestra un recordatorio por cada ocurrencia futura de una serie
 * vacía, sólo UNO por serie (la ocurrencia futura más próxima dentro del
 * horizonte estándar, para poder navegar a ella). Distingue series
 * recurrentes vacías de clases sueltas vacías porque tienen ciclos de vida
 * distintos. Pura — no muta ninguno de los arrays de entrada.
 */
export interface EmptyClassLessonForEngine extends CalendarLessonForEngine {
  startAt: string;
  isRecurring: boolean;
  participantIds: string[];
  classTitle: string | null;
}

export interface EmptyClassItem {
  kind: "series" | "standalone";
  key: string;
  title: string;
  startIso: string;
  lessonId?: string;
  recurrenceId?: string;
  occurrenceKey?: string;
}

export interface EmptyClassesSummary {
  emptySeriesCount: number;
  standaloneEmptyLessonCount: number;
  items: EmptyClassItem[];
}

function hasNoParticipants(studentId: string | null, participantIds: string[]): boolean {
  return (studentId === null || studentId === "") && participantIds.length === 0;
}

function findNextOccurrenceForEmptySeries(
  rule: RecurrenceRuleForEngine,
  lessons: readonly EmptyClassLessonForEngine[],
  exceptions: readonly RecurrenceExceptionForEngine[],
  now: Date
): { startIso: string; occurrenceKey: string } | null {
  const rangeEnd = new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 86_400_000);
  const occurrences = applyExceptionsToOccurrences(generateOccurrences(rule, now, rangeEnd), [...exceptions], [...lessons]).filter(
    (occurrence) => occurrence.materializationStatus !== "cancelled"
  );
  if (occurrences.length === 0) return null;

  const next = occurrences.reduce((earliest, candidate) => (new Date(candidate.start).getTime() < new Date(earliest.start).getTime() ? candidate : earliest));
  return { startIso: next.start, occurrenceKey: next.occurrenceKey };
}

export function buildEmptyClassesSummary(input: {
  recurrenceRules: readonly RecurrenceRuleForEngine[];
  lessons: readonly EmptyClassLessonForEngine[];
  exceptions: readonly RecurrenceExceptionForEngine[];
  now: Date;
}): EmptyClassesSummary {
  const emptySeries = input.recurrenceRules.filter((rule) => rule.status === "active" && hasNoParticipants(rule.studentId, rule.participantIds));

  // Sólo clases sueltas (no recurrentes) — una ocurrencia materializada de
  // una serie ya está contada arriba, a nivel de serie, para no duplicar
  // el mismo vacío dos veces.
  const standaloneEmptyLessons = input.lessons.filter((lesson) => {
    if (lesson.isRecurring) return false;
    if (lesson.status !== "scheduled") return false;
    if (new Date(lesson.startAt).getTime() <= input.now.getTime()) return false;
    return lesson.participantIds.length === 0;
  });

  const seriesItems: EmptyClassItem[] = emptySeries.flatMap((rule) => {
    const target = findNextOccurrenceForEmptySeries(rule, input.lessons, input.exceptions, input.now);
    // Sin ninguna ocurrencia futura real dentro del horizonte, no hay a
    // dónde navegar — el recordatorio no se muestra.
    if (!target) return [];
    const customTitle = rule.classTitle?.trim();
    return [
      {
        kind: "series" as const,
        key: `series_${rule.recurrenceId}`,
        title: customTitle || "Serie recurrente sin alumnos",
        startIso: target.startIso,
        recurrenceId: rule.recurrenceId,
        occurrenceKey: target.occurrenceKey,
      },
    ];
  });

  const standaloneItems: EmptyClassItem[] = standaloneEmptyLessons.map((lesson) => {
    const customTitle = lesson.classTitle?.trim();
    return {
      kind: "standalone" as const,
      key: `standalone_${lesson.id}`,
      title: customTitle || "Clase suelta sin alumnos",
      startIso: lesson.startAt,
      lessonId: lesson.id,
    };
  });

  const items = [...seriesItems, ...standaloneItems].sort((first, second) => new Date(first.startIso).getTime() - new Date(second.startIso).getTime());

  return {
    emptySeriesCount: emptySeries.length,
    standaloneEmptyLessonCount: standaloneEmptyLessons.length,
    items,
  };
}
