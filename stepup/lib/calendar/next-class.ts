/**
 * Puerto VERBATIM de `calendarNextClassAt.ts` (móvil) — sólo las dos
 * funciones genéricas de clasificación/prioridad temporal que necesita
 * Inicio (`classifyLessonTiming`/`selectCurrentOrNextOccurrence`); las
 * variantes "por alumno" del móvil (`calculateCurrentOrNextClass`,
 * persistencia de `nextClassAt`) no aplican acá — Fase 3 ya resuelve el
 * calendario en memoria por rango, nunca persiste un campo `nextClassAt`
 * por alumno.
 *
 * Regla exacta de límites (mitad abierta, sin ambigüedad en los bordes):
 * - `ahora < start`        -> 'upcoming'
 * - `start <= ahora < end` -> 'in_progress' (incluye el instante EXACTO del inicio)
 * - `ahora >= end`         -> 'finished' (incluye el instante EXACTO del final)
 * - estado inválido (cancelada o cualquier otro distinto de
 *   `scheduled`/`rescheduled`) -> 'excluded', sin importar el horario.
 */
export type LessonTimingStatus = "upcoming" | "in_progress" | "finished" | "excluded";

const ACTIVE_LESSON_STATUSES = ["scheduled", "rescheduled"] as const;

export interface LessonTimingCandidate {
  start: string;
  end: string;
  status?: string;
}

export function classifyLessonTiming(candidate: LessonTimingCandidate, now: Date): LessonTimingStatus {
  if (candidate.status !== undefined && !(ACTIVE_LESSON_STATUSES as readonly string[]).includes(candidate.status)) {
    return "excluded";
  }
  const nowTime = now.getTime();
  const startTime = new Date(candidate.start).getTime();
  const endTime = new Date(candidate.end).getTime();
  if (nowTime < startTime) return "upcoming";
  if (nowTime < endTime) return "in_progress";
  return "finished";
}

export interface CurrentOrNextSelection<T> {
  occurrence: T;
  timing: "in_progress" | "upcoming";
}

/**
 * Prioridad de selección: 1) una clase válida actualmente EN CURSO; 2) si
 * no hay ninguna, la próxima futura válida más cercana; 3) si no hay
 * ninguna, `null`. Nunca depende del orden de entrada de `candidates`.
 */
export function selectCurrentOrNextOccurrence<T extends LessonTimingCandidate>(candidates: T[], now: Date): CurrentOrNextSelection<T> | null {
  let best: CurrentOrNextSelection<T> | null = null;
  for (const candidate of candidates) {
    const timing = classifyLessonTiming(candidate, now);
    if (timing !== "in_progress" && timing !== "upcoming") continue;
    if (!best) {
      best = { occurrence: candidate, timing };
      continue;
    }
    if (timing === "in_progress" && best.timing === "upcoming") {
      best = { occurrence: candidate, timing };
      continue;
    }
    if (timing === "upcoming" && best.timing === "in_progress") continue;
    if (new Date(candidate.start).getTime() < new Date(best.occurrence.start).getTime()) {
      best = { occurrence: candidate, timing };
    }
  }
  return best;
}
