// Puerto VERBATIM del original (`src/features/new-class/utils/punctualityScoreEntries.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PunctualityScoreEntry } from './punctualityScoring.ts';
import type { SavedLesson } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): adapta el historial real de `SavedLesson` del
 * alumno al formato que espera el motor de scoring — nunca inventa una
 * llegada para un registro que no la tiene (queda `arrival: null`, y el
 * motor de scoring ya sabe excluir eso).
 */
export function buildPunctualityScoreEntriesForStudent(
  lessons: SavedLesson[],
  studentId: string,
  todayDateKey: string
): PunctualityScoreEntry[] {
  return lessons
    .filter((lesson) => lesson.form.studentIds.includes(studentId))
    .map((lesson) => ({
      date: lesson.form.date,
      arrival: lesson.studentArrival ?? null,
      isCancelled: !lesson.countsAsClass,
      isFuture: lesson.form.date > todayDateKey,
    }));
}
