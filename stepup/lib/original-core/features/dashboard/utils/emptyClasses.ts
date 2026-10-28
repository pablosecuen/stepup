// Puerto VERBATIM del original (`src/features/dashboard/utils/emptyClasses.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import { applyExceptionsToOccurrences, DEFAULT_RECURRENCE_HORIZON_DAYS, generateOccurrences } from '../../calendar/utils/calendarRecurrenceEngine.ts';

/**
 * Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
 * §16): "Clases sin alumnos" agrupado — Home nunca debe mostrar un
 * recordatorio por cada ocurrencia futura de una serie vacía, sólo UNO
 * por serie. Distingue series recurrentes vacías de clases sueltas
 * vacías porque tienen ciclos de vida distintos (una serie se resuelve
 * agregando el alumno a la regla una sola vez; una clase suelta se
 * resuelve una por una).
 *
 * Corrección 2026-07-22 (a pedido de Joaquín — flujo clases→alumnos,
 * §A/§I): cada recordatorio ahora es un ítem NAVEGABLE con identidad
 * estable — nunca sólo un conteo. Para una serie vacía, se resuelve la
 * ocurrencia futura más próxima dentro del horizonte estándar
 * (`DEFAULT_RECURRENCE_HORIZON_DAYS`, el mismo que usa el resto del
 * calendario) para poder navegar a ella exactamente. Pura — no muta
 * `recurrenceRules`, `lessons` ni `recurrenceExceptions`.
 */
export interface EmptyClassItem {
  kind: 'series' | 'standalone';
  /** Clave estable para listas de React — nunca se reutiliza entre un ítem de serie y uno suelto. */
  key: string;
  title: string;
  startIso: string;
  /** Sólo en clases sueltas: id real de la reserva materializada. */
  lessonId?: string;
  /** Sólo en series: identidad de la ocurrencia objetivo (todavía virtual la mayoría de las veces). */
  recurrenceId?: string;
  occurrenceKey?: string;
}

export interface EmptyClassesSummary {
  emptySeriesCount: number;
  standaloneEmptyLessonCount: number;
  /** Ordenados por fecha ascendente — series y clases sueltas mezcladas. */
  items: EmptyClassItem[];
}

function hasNoParticipants(studentId: string, participantIds?: string[]): boolean {
  return studentId === '' && (!participantIds || participantIds.length === 0);
}

/** Ocurrencia futura más próxima de una serie vacía, para poder navegar a una fecha exacta — null si no hay ninguna dentro del horizonte. */
function findNextOccurrenceForEmptySeries(
  rule: RecurrenceRule,
  lessons: readonly CalendarLesson[],
  recurrenceExceptions: readonly RecurrenceException[],
  now: Date
): { startIso: string; occurrenceKey: string } | null {
  const rangeEnd = new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 86_400_000);
  const occurrences = applyExceptionsToOccurrences(
    generateOccurrences(rule, now, rangeEnd),
    [...recurrenceExceptions],
    [...lessons]
  ).filter((occurrence) => occurrence.materializationStatus !== 'cancelled');

  if (occurrences.length === 0) return null;

  const next = occurrences.reduce((earliest, candidate) =>
    new Date(candidate.start).getTime() < new Date(earliest.start).getTime() ? candidate : earliest
  );
  return { startIso: next.start, occurrenceKey: next.occurrenceKey };
}

export function buildEmptyClassesSummary(input: {
  recurrenceRules: readonly RecurrenceRule[];
  lessons: readonly CalendarLesson[];
  recurrenceExceptions?: readonly RecurrenceException[];
  now: Date;
}): EmptyClassesSummary {
  const { recurrenceRules, lessons, now } = input;
  const recurrenceExceptions = input.recurrenceExceptions ?? [];

  const emptySeries = recurrenceRules.filter(
    (rule) => rule.status === 'active' && hasNoParticipants(rule.studentId, rule.participantIds)
  );

  // Sólo clases sueltas (isRecurring: false) — una ocurrencia materializada
  // de una serie ya está contada arriba, a nivel de serie, para no
  // duplicar el mismo vacío dos veces.
  const standaloneEmptyLessons = lessons.filter((lesson) => {
    if (lesson.isRecurring) return false;
    if (lesson.status !== 'scheduled') return false;
    if (new Date(lesson.start).getTime() <= now.getTime()) return false;
    return lesson.studentId === '' && lesson.participants.length === 0;
  });

  const seriesItems: EmptyClassItem[] = emptySeries.flatMap((rule) => {
    const target = findNextOccurrenceForEmptySeries(rule, lessons, recurrenceExceptions, now);
    // Si no hay ninguna ocurrencia futura real dentro del horizonte, no se
    // muestra el recordatorio: no habría a dónde navegar, y mostrarlo
    // igual sería un ítem inútil (imposible de "revisar").
    if (!target) return [];
    // Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
    // clase): un título propio (ej. "Grupo de conversación") reemplaza el
    // texto genérico incluso sin alumnos todavía — ayuda a identificar la
    // serie mientras se le asigna el primer alumno. Sin título, el texto
    // genérico distingue "serie" de "clase suelta" (información real, no
    // se pierde reusando el texto genérico de `lessonDisplayTitle`).
    const customTitle = rule.classTitle?.trim();
    return [
      {
        kind: 'series' as const,
        key: `series_${rule.recurrenceId}`,
        title: customTitle || 'Serie recurrente sin alumnos',
        startIso: target.startIso,
        recurrenceId: rule.recurrenceId,
        occurrenceKey: target.occurrenceKey,
      },
    ];
  });

  const standaloneItems: EmptyClassItem[] = standaloneEmptyLessons.map((lesson) => {
    const customTitle = lesson.classTitle?.trim();
    return {
      kind: 'standalone' as const,
      key: `standalone_${lesson.id}`,
      title: customTitle || 'Clase suelta sin alumnos',
      startIso: lesson.start,
      lessonId: lesson.id,
    };
  });

  const items = [...seriesItems, ...standaloneItems].sort(
    (first, second) => new Date(first.startIso).getTime() - new Date(second.startIso).getTime()
  );

  return {
    emptySeriesCount: emptySeries.length,
    standaloneEmptyLessonCount: standaloneEmptyLessons.length,
    items,
  };
}
