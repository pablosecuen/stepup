// Puerto VERBATIM del original (`src/features/student-profile/utils/profileLessonOutcome.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentProfile } from '../types/index.ts';

export interface LessonOutcomeForProfile {
  countsAsClass: boolean;
  dateTimeIso: string;
  hoursDelta: number;
  present: boolean | null;
  generalGrade: number | null;
  skillGrades: Record<string, number>;
  strengths: string[];
  areasToImprove: string[];
  homeworkDescription: string | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function applyLessonOutcomeToProfileSnapshot(
  current: StudentProfile,
  outcome: LessonOutcomeForProfile
): StudentProfile {
  const newAttendanceRate = outcome.present !== null
    ? round1((current.attendanceRate * current.totalClasses + (outcome.present ? 100 : 0)) / (current.totalClasses + 1))
    : current.attendanceRate;

  return {
    ...current,
    totalClasses: outcome.countsAsClass ? current.totalClasses + 1 : current.totalClasses,
    totalHoursTaken: outcome.countsAsClass ? round1(current.totalHoursTaken + outcome.hoursDelta) : current.totalHoursTaken,
    classesThisMonth: outcome.countsAsClass ? current.classesThisMonth + 1 : current.classesThisMonth,
    // Corrección P0 2026-08-21 (a pedido de Joaquín — PROMEDIOS REALES): esta
    // función es incremental (una clase a la vez, sin ver el historial
    // completo) — nunca puede calcular un promedio correcto por sí sola
    // (mezclaba "clases dictadas" con "clases calificadas" como si fueran lo
    // mismo). El promedio real se recalcula aparte, desde cero, en
    // `recomputeStudentLessonDerivedFields` (`editRegisteredLessonDomain.ts`,
    // única función pura para esto — `calculateAverageGrade`) — acá se deja
    // pasar tal cual, nunca se inventa un valor intermedio.
    averageGrade: current.averageGrade,
    attendanceRate: outcome.countsAsClass ? newAttendanceRate : current.attendanceRate,
    lastClassAt: outcome.countsAsClass ? outcome.dateTimeIso : current.lastClassAt,
    // Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: "pendingHomework
    // no puede seguir siendo una cadena que se sobrescribe ciegamente"):
    // ANTES, cualquier tarea nueva pisaba silenciosamente la anterior, sin
    // noción de "resuelta" — una tarea ya cumplida hace semanas podía
    // seguir mostrándose para siempre, y una tarea vieja sin resolver
    // desaparecía apenas se escribía cualquier tarea nueva. Esta función
    // NUNCA decide `pendingHomework` por sí sola — sólo lo deja pasar tal
    // cual venía, porque acá (aplicación incremental de UNA clase) no hay
    // visibilidad de las revisiones de OTRAS clases. El valor real se
    // proyecta aparte, con el historial completo, vía
    // `projectPendingHomeworkSummary` (`homeworkPendingDomain.ts`) —
    // llamado explícitamente después de esta función en
    // `useSaveClass.ts`/`recomputeStudentLessonDerivedFields`.
    pendingHomework: current.pendingHomework,
    strengths: outcome.strengths.length > 0 ? [...current.strengths, ...outcome.strengths] : current.strengths,
    areasToImprove: outcome.areasToImprove.length > 0 ? [...current.areasToImprove, ...outcome.areasToImprove] : current.areasToImprove,
    skillGradesHistory: Object.keys(outcome.skillGrades).length > 0
      ? [...current.skillGradesHistory, { date: outcome.dateTimeIso, grades: outcome.skillGrades }]
      : current.skillGradesHistory,
  };
}
