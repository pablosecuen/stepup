// Puerto VERBATIM del original (`src/features/students/utils/studentDeletionImpact.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../calendar/types/index.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import type { PaymentsRepositoryState } from '../../payments/types/index.ts';
import type { ReportRecord } from '../../reportes/types/index.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';

export interface StudentDeletionImpactSource {
  profiles: Record<string, StudentProfile>;
  calendarLessons: CalendarLesson[];
  savedLessons: SavedLesson[];
  reportHistory: ReportRecord[];
  payments: PaymentsRepositoryState;
}

export interface StudentDeletionImpact {
  hasProfile: boolean;
  /** Clases del calendario ya agendadas, futuras, no canceladas. */
  futureLessonsCount: number;
  /** Registros pedagógicos (asistencia/contenido/tareas) ya guardados con este alumno. */
  registeredLessonsCount: number;
  /** Total de referencias del calendario (pasadas y futuras) donde participa. */
  calendarReferencesCount: number;
  reportRecordsCount: number;
  hasAnyFinancialRecord: boolean;
  financialChargesCount: number;
  financialPaymentsCount: number;
}

/**
 * Corrección 2026-07-24 (a pedido de Joaquín — "TUTORIAL RÁPIDO SALTEABLE +
 * ACCIONES POR DESLIZAMIENTO EN ALUMNOS", ítem K): calcula el resumen REAL
 * de lo que una eliminación definitiva afectaría — nunca cantidades
 * inventadas. Deliberadamente de sólo lectura: no reimplementa la cascada
 * de borrado (`buildStudentDeletionCascade`), sólo cuenta sobre las mismas
 * colecciones que esa función recorre, para mostrarle a la profesora antes
 * de confirmar. Pura — nunca muta `source` ni ningún store real.
 */
export function analyzeStudentDeletionImpact(
  studentId: string,
  source: StudentDeletionImpactSource
): StudentDeletionImpact {
  const now = Date.now();

  const referencingCalendarLessons = source.calendarLessons.filter(
    (lesson) =>
      lesson.studentId === studentId || lesson.participants.some((participant) => participant.studentId === studentId)
  );
  const futureLessonsCount = referencingCalendarLessons.filter(
    (lesson) => lesson.status !== 'cancelled' && lesson.status !== 'completed' && new Date(lesson.start).getTime() > now
  ).length;

  const registeredLessonsCount = source.savedLessons.filter((lesson) =>
    lesson.form.studentIds.includes(studentId)
  ).length;

  const reportRecordsCount = source.reportHistory.filter((record) => record.studentId === studentId).length;

  const financialChargesCount = source.payments.charges.filter((charge) => charge.studentId === studentId).length;
  const financialPaymentsCount = source.payments.payments.filter((payment) => payment.studentId === studentId).length;

  return {
    hasProfile: Boolean(source.profiles[studentId]),
    futureLessonsCount,
    registeredLessonsCount,
    calendarReferencesCount: referencingCalendarLessons.length,
    reportRecordsCount,
    hasAnyFinancialRecord: financialChargesCount > 0 || financialPaymentsCount > 0,
    financialChargesCount,
    financialPaymentsCount,
  };
}
