// Puerto VERBATIM del original (`src/features/new-class/utils/studentSessionHistory.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson, StudentArrival } from '../types/index.ts';
import type { ActivityKind } from '../../calendar/types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): lista compacta de clases pasadas de un alumno para
 * "Corrección manual post-clase" — sólo clases que cuentan (nunca
 * canceladas) y que ya pasaron (nunca una clase futura, todavía sin
 * dictarse), más reciente primero.
 */
export interface StudentSessionHistoryEntry {
  lessonId: string;
  date: string; // YYYY-MM-DD
  effectiveStartAt: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  studentArrival: StudentArrival | null;
  /**
   * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): fotografía
   * real guardada en `SavedLesson.form.activityKind` — nunca el tipo ACTUAL
   * de la serie, que puede haber cambiado después de este registro. Ausente
   * = `'class'` (ver `normalizeActivityKind`).
   */
  activityKind?: ActivityKind;
}

export function buildStudentSessionHistory(
  lessons: SavedLesson[],
  studentId: string,
  todayDateKey: string
): StudentSessionHistoryEntry[] {
  return lessons
    .filter(
      (lesson) => lesson.countsAsClass && lesson.form.studentIds.includes(studentId) && lesson.form.date <= todayDateKey
    )
    .map((lesson) => ({
      lessonId: lesson.id,
      date: lesson.form.date,
      effectiveStartAt: lesson.effectiveStartAt ?? null,
      actualStartedAt: lesson.actualStartedAt ?? null,
      actualEndedAt: lesson.actualEndedAt ?? null,
      studentArrival: lesson.studentArrival ?? null,
      activityKind: lesson.form.activityKind,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
