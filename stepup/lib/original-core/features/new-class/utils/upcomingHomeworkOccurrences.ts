// Puerto VERBATIM del original (`src/features/new-class/utils/upcomingHomeworkOccurrences.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import { applyExceptionsToOccurrences, DEFAULT_RECURRENCE_HORIZON_DAYS, generateOccurrences } from '../../calendar/utils/calendarRecurrenceEngine.ts';

/**
 * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E INTUITIVO
 * DEL REGISTRO DE CLASES, §11: "entrega basada en próximas clases"): dominio
 * PURO — reutiliza el mismo motor de recurrencias que ya usa
 * `calendarNextClassAt.ts` para calcular la "próxima clase" de un alumno
 * (`generateOccurrences`/`applyExceptionsToOccurrences`), nunca un motor
 * nuevo. Nunca toca AsyncStorage/React/UI: devuelve fechas ISO reales, la
 * pantalla decide cómo formatearlas.
 */

export interface UpcomingOccurrenceOption {
  iso: string;
  /** Identificador real de la ocurrencia (materializada o virtual) — para deduplicar y para trazabilidad, nunca para mostrar. */
  occurrenceKey: string;
}

function lessonBelongsToStudent(lesson: CalendarLesson, studentId: string): boolean {
  return lesson.studentId === studentId || lesson.participants.some((p) => p.studentId === studentId);
}

export type UpcomingOccurrenceScope =
  | { kind: 'student'; studentId: string }
  | { kind: 'series'; recurrenceId: string };

export interface ListUpcomingOccurrencesParams {
  /** Fecha/hora de la clase que se está registrando — se excluye a sí misma y todo lo anterior. */
  afterIso: string;
  now: Date;
  lessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
  scope: UpcomingOccurrenceScope;
  horizonDays?: number;
  maxResults?: number;
}

/**
 * Lista ordenada cronológicamente de próximas ocurrencias REALES (nunca un
 * calendario libre): fechas posteriores a `afterIso`, sin canceladas, con
 * reprogramaciones ya reflejadas (una ocurrencia reprogramada aparece en su
 * nuevo horario, nunca en el viejo — `applyExceptionsToOccurrences` ya
 * resuelve esto), sin duplicados, acotada a `maxResults`.
 */
export function listUpcomingOccurrencesForDueDate(
  params: ListUpcomingOccurrencesParams
): UpcomingOccurrenceOption[] {
  const horizonDays = params.horizonDays ?? DEFAULT_RECURRENCE_HORIZON_DAYS;
  const maxResults = params.maxResults ?? 8;
  const afterTime = new Date(params.afterIso).getTime();
  const rangeStart = params.now;
  const rangeEnd = new Date(params.now.getTime() + horizonDays * 86_400_000);

  const matchesScope = (lesson: CalendarLesson): boolean =>
    params.scope.kind === 'student'
      ? lessonBelongsToStudent(lesson, params.scope.studentId)
      : lesson.recurrenceId === params.scope.recurrenceId;

  const materialized = params.lessons
    .filter((lesson) => lesson.status === 'scheduled' || lesson.status === 'rescheduled')
    .filter(matchesScope)
    .map((lesson) => ({ iso: lesson.start, occurrenceKey: lesson.recurrenceOccurrenceKey ?? lesson.id }));

  const virtual = params.recurrenceRules
    .filter((rule) => rule.status === 'active')
    .filter((rule) =>
      params.scope.kind === 'student'
        ? rule.studentId === params.scope.studentId || (rule.participantIds ?? []).includes(params.scope.studentId)
        : rule.recurrenceId === params.scope.recurrenceId
    )
    .flatMap((rule) =>
      applyExceptionsToOccurrences(
        generateOccurrences(rule, rangeStart, rangeEnd),
        params.recurrenceExceptions,
        params.lessons
      )
        .filter((occurrence) => occurrence.materializationStatus === 'virtual')
        .map((occurrence) => ({ iso: occurrence.start, occurrenceKey: occurrence.occurrenceKey }))
    );

  const seen = new Set<string>();
  const combined = [...materialized, ...virtual]
    .filter((option) => new Date(option.iso).getTime() > afterTime)
    .filter((option) => {
      if (seen.has(option.occurrenceKey)) return false;
      seen.add(option.occurrenceKey);
      return true;
    })
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());

  return combined.slice(0, maxResults);
}
