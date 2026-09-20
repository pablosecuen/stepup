// Validación pura de solapamiento horario. `rangesOverlap`/
// `findSchedulingConflict` (abajo) datan de la Fase A (vista previa) y
// siguen sin cambios. `findCalendarConflicts`/`hasBlockingConflict` (Fase
// 3) son el puerto real de `calendarConflicts.ts` (móvil) — misma
// semántica exacta: back-to-back nunca es conflicto, la propia clase que
// se edita se excluye, una clase cancelada nunca conflictúa, y un
// solapamiento contra una clase con `overlapAllowed: true` no bloquea.

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ScheduledRange extends TimeRange {
  id: string;
}

/**
 * true si dos rangos horarios se solapan. Dos clases que terminan/empiezan
 * exactamente en el mismo instante (back-to-back) NO se consideran
 * solapadas — mismo criterio que un sweep de intervalos semiabiertos
 * [start, end).
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Primer conflicto real de horario entre `candidate` y las clases
 * existentes — devuelve el id de la clase con la que se solapa, o `null`
 * si no hay ninguno. Pensada para que un futuro formulario de
 * creación/edición la llame antes de guardar y bloquee el solapamiento.
 */
export function findSchedulingConflict(candidate: TimeRange, existing: ScheduledRange[]): string | null {
  const conflict = existing.find((range) => rangesOverlap(candidate, range));
  return conflict ? conflict.id : null;
}

// ---------------------------------------------------------------------------
// Fase 3 — puerto real de `calendarConflicts.ts` (móvil)
// ---------------------------------------------------------------------------

export interface ConflictCandidateLesson {
  id: string;
  start: string; // ISO
  end: string; // ISO
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  isRecurring: boolean;
  lessonType: "individual" | "group";
  overlapAllowed: boolean;
}

export interface CalendarConflict {
  conflictingLesson: ConflictCandidateLesson;
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
  exactSameSchedule: boolean;
  canConvertToGroup: boolean;
}

function intervalsOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return firstStart < secondEnd && firstEnd > secondStart;
}

/**
 * Conflictos reales de horario entre `candidateStart`/`candidateEnd` y
 * `lessons` — nunca contra la propia clase que se edita
 * (`ignoredLessonId`), nunca contra una clase cancelada. Back-to-back
 * (fin de una = inicio de otra) nunca es conflicto (mismo criterio que
 * `rangesOverlap`, con `<`/`>` estrictos).
 */
export function findCalendarConflicts(
  candidateStart: string,
  candidateEnd: string,
  lessons: ConflictCandidateLesson[],
  ignoredLessonId?: string
): CalendarConflict[] {
  const startTime = new Date(candidateStart).getTime();
  const endTime = new Date(candidateEnd).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return [];

  const conflicts: CalendarConflict[] = [];
  lessons.forEach((lesson) => {
    if (lesson.id === ignoredLessonId) return;
    if (lesson.status === "cancelled") return;
    const lessonStart = new Date(lesson.start).getTime();
    const lessonEnd = new Date(lesson.end).getTime();
    if (!intervalsOverlap(startTime, endTime, lessonStart, lessonEnd)) return;

    const overlapStartTime = Math.max(startTime, lessonStart);
    const overlapEndTime = Math.min(endTime, lessonEnd);
    const exactSameSchedule = startTime === lessonStart && endTime === lessonEnd;
    conflicts.push({
      conflictingLesson: lesson,
      overlapStart: new Date(overlapStartTime).toISOString(),
      overlapEnd: new Date(overlapEndTime).toISOString(),
      overlapMinutes: Math.round((overlapEndTime - overlapStartTime) / 60_000),
      exactSameSchedule,
      canConvertToGroup: exactSameSchedule && !lesson.isRecurring && lesson.lessonType !== "group",
    });
  });
  return conflicts;
}

/** true si algún conflicto real bloquea — una clase con `overlapAllowed: true` (doble agenda intencional) nunca bloquea. */
export function hasBlockingConflict(conflicts: CalendarConflict[]): boolean {
  return conflicts.some((conflict) => !conflict.conflictingLesson.overlapAllowed);
}
