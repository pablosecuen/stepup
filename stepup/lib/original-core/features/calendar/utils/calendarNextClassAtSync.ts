// Puerto VERBATIM del original (`src/features/calendar/utils/calendarNextClassAtSync.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { syncNextClassAt as syncProfileNextClassAt } from '../../student-profile/hooks/useStudentProfile.ts';
import { getStudentsStore, updateStudent } from '../../students/hooks/studentStore.ts';
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';
import { calculateCurrentOrNextClass, planNextClassAtRepairs } from './calendarNextClassAt.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../hooks/calendarStore.ts';

export function syncNextClassAtFromLessons(
  studentId: string,
  lessons: CalendarLesson[],
  recurrenceRules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  now: Date = new Date()
): void {
  const student = getStudentsStore().find((item) => item.id === studentId);
  if (!student) return;

  const current = calculateCurrentOrNextClass(
    student,
    lessons,
    recurrenceRules,
    exceptions,
    now
  );
  const nextClassAt = current?.start ?? null;
  const nextClassEndAt = current?.end ?? null;
  updateStudent({ ...student, nextClassAt, nextClassEndAt });
  syncProfileNextClassAt(studentId, nextClassAt, nextClassEndAt);
}

/**
 * Corrección P0 (a pedido de Joaquín — "próxima clase" pasada y
 * recurrencias futuras ausentes, requisito 8): repara EXCLUSIVAMENTE el
 * campo derivado `nextClassAt` de cada alumno activo, recalculándolo desde
 * cero con la misma función canónica (`calculateNextClassAt`) — nunca toca
 * reglas, clases, excepciones, pagos ni ningún otro campo del alumno. Sólo
 * escribe cuando el valor recalculado difiere del persistido, así que una
 * corrida repetida sobre datos ya consistentes no genera ninguna escritura.
 * Se usa tanto al hidratar la app (`repairStaleNextClassAtOnAppStart`, que
 * carga clases/reglas/excepciones desde AsyncStorage) como al restaurar un
 * respaldo (donde el llamador ya tiene esos tres arrays en mano, recién
 * restaurados).
 */
export function repairStaleNextClassAtForAllStudents(
  lessons: CalendarLesson[],
  recurrenceRules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  now: Date = new Date()
): string[] {
  const repairs = planNextClassAtRepairs(
    getStudentsStore(),
    lessons,
    recurrenceRules,
    exceptions,
    now
  );
  repairs.forEach(({ id, canonicalNextClassAt, canonicalNextClassEndAt }) => {
    const student = getStudentsStore().find((item) => item.id === id);
    if (!student) return;
    updateStudent({ ...student, nextClassAt: canonicalNextClassAt, nextClassEndAt: canonicalNextClassEndAt });
    syncProfileNextClassAt(id, canonicalNextClassAt, canonicalNextClassEndAt);
  });
  return repairs.map((repair) => repair.id);
}

/** Variante de arranque de la app: carga clases/reglas/excepciones directo de AsyncStorage (todavía no hay ninguna pantalla de Calendario montada en ese momento). */
export async function repairStaleNextClassAtOnAppStart(
  now: Date = new Date()
): Promise<string[]> {
  const [lessons, recurrenceRules, exceptions] = await Promise.all([
    loadCalendarLessons(),
    loadRecurrenceRules(),
    loadRecurrenceExceptions(),
  ]);
  return repairStaleNextClassAtForAllStudents(
    lessons ?? [],
    recurrenceRules ?? [],
    exceptions ?? [],
    now
  );
}
