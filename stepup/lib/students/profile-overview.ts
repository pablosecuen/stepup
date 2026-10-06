import { buildStudentReportData, type RegistrationForStudentReport } from "../reports/student-report-data.ts";
import { selectCurrentOrNextOccurrence } from "../calendar/next-class.ts";
import { SKILLS, SKILL_LABEL, type Skill } from "../lessons/skills.ts";
import { calculateAverageGrade, normalizeSkillGradeValue } from "../lessons/grades.ts";
import type { StudentStatus } from "../db/database.types.ts";

/**
 * Datos del perfil del alumno (B6) derivados SÓLO de registros reales. Cada cifra tiene una definición única y explícita
 * (abajo); lo que no se puede calcular sin ambigüedad no se calcula: devuelve `null`/0 y la pantalla muestra un estado
 * vacío claro o directamente no muestra el campo.
 *
 * Definiciones:
 *  - Clase dictada: registro finalizado (`status = completed`) que cuenta como clase (`counts_as_class`) y tiene a este alumno
 *    en su lista. Las canceladas, ausencias de la profesora, feriados y reprogramadas NO cuentan.
 *  - Asistió: la asistencia de ESE alumno en esa clase es «presente» o «tarde». Ausente («ausente», «ausente con aviso»)
 *    no cuenta como clase tomada. «Sin registrar»/sin dato queda aparte (`unresolved`) y no se suma a nada.
 *  - Asistencia %: asistió / (asistió + ausente). Sólo existe si hay al menos una clase con asistencia resuelta.
 *  - Horas: suma de la duración (real si hay inicio y fin reales; si no, la programada) de las clases a las que asistió.
 *    Una clase sin horario no suma: se informa cuántas quedaron afuera (`attendedWithoutDuration`) en vez de inventar.
 *  - Promedio: el de las notas generales reales (`calculateAverageGrade`: un 0/vacío nunca cuenta).
 */
export type AttendanceKind = "presente" | "ausente" | "tarde" | "ausente_aviso" | "sin_registrar";

export interface HeldRegistration extends RegistrationForStudentReport {
  /** Instante real de la clase (programada → real → alta del registro). Sirve para mostrar el día en hora de Argentina. */
  anchorAt: string;
}

export interface ProfileClassStats {
  classesHeld: number;
  attended: number;
  absent: number;
  unresolved: number;
  /** Entero 0-100, o `null` si ninguna clase tiene asistencia resuelta. */
  attendanceRatePercent: number | null;
  /** Clases con asistencia resuelta (la base del porcentaje). */
  attendanceBasis: number;
  /** Horas (1 decimal) de las clases a las que asistió, o `null` si no asistió a ninguna con duración conocida. */
  hours: number | null;
  attendedWithoutDuration: number;
  averageGrade: number | null;
  lastAttended: { anchorAt: string; attendance: "presente" | "tarde" } | null;
}

const isAttended = (status: AttendanceKind | undefined | null) => status === "presente" || status === "tarde";
const isAbsent = (status: AttendanceKind | undefined | null) => status === "ausente" || status === "ausente_aviso";

export function buildProfileClassStats(held: readonly HeldRegistration[]): ProfileClassStats {
  const attendedRows = held.filter((r) => isAttended(r.attendance?.status));
  const absent = held.filter((r) => isAbsent(r.attendance?.status)).length;
  const attended = attendedRows.length;
  const unresolved = held.length - attended - absent;
  const basis = attended + absent;

  // Horas y promedio con los motores ya probados de Reportes, pero SÓLO sobre las clases a las que asistió.
  const attendedReport = buildStudentReportData(attendedRows);
  const attendedWithoutDuration = attendedReport.lessonDetails.filter((d) => d.durationMinutes === 0).length;
  const withDuration = attended - attendedWithoutDuration;

  const gradeReport = buildStudentReportData(held);

  const last = [...attendedRows].sort((a, b) => (a.anchorAt < b.anchorAt ? 1 : a.anchorAt > b.anchorAt ? -1 : 0))[0];

  return {
    classesHeld: held.length,
    attended,
    absent,
    unresolved,
    attendanceRatePercent: basis > 0 ? Math.round((attended / basis) * 100) : null,
    attendanceBasis: basis,
    hours: withDuration > 0 ? attendedReport.hoursTaught : null,
    attendedWithoutDuration,
    averageGrade: gradeReport.generalAverageGrade,
    lastAttended: last ? { anchorAt: last.anchorAt, attendance: last.attendance!.status as "presente" | "tarde" } : null,
  };
}

/**
 * Promedio por habilidad sobre las evaluaciones reales (mismo criterio que el promedio general: una nota ausente o 0 no
 * cuenta). Sólo salen las habilidades con al menos una nota real; sin ninguna, la lista queda vacía (no se muestra nada).
 */
export function skillAveragesFromEvaluations(
  evaluations: ReadonlyArray<{ skillGrades: Record<string, number> }>,
): Array<{ skill: Skill; label: string; averageGrade: number; gradedClasses: number }> {
  const out: Array<{ skill: Skill; label: string; averageGrade: number; gradedClasses: number }> = [];
  for (const skill of SKILLS) {
    const grades = evaluations.map((e) => normalizeSkillGradeValue(e.skillGrades[skill] ?? null));
    const average = calculateAverageGrade(grades);
    if (average !== null) out.push({ skill, label: SKILL_LABEL[skill], averageGrade: average, gradedClasses: grades.filter((g) => g !== null).length });
  }
  return out;
}

/** Texto de horas: «12 h», «1,5 h». */
export function formatHours(hours: number): string {
  return `${String(hours).replace(".", ",")} h`;
}

export interface MoneyAllocation {
  chargeId: string;
  paymentId: string;
  amount: number;
}

/**
 * Total efectivamente cobrado al alumno: asignaciones de pagos NO anulados sobre obligaciones NO anuladas — el mismo
 * criterio de «cobrado» que el Resumen financiero. Nunca incluye lo generado ni lo pendiente.
 */
export function totalCollectedForStudent(input: {
  charges: ReadonlyArray<{ id: string; voidedAt: string | null }>;
  payments: ReadonlyArray<{ id: string; voidedAt: string | null }>;
  allocations: readonly MoneyAllocation[];
}): number {
  const activeCharges = new Set(input.charges.filter((c) => c.voidedAt === null).map((c) => c.id));
  const activePayments = new Set(input.payments.filter((p) => p.voidedAt === null).map((p) => p.id));
  return input.allocations
    .filter((a) => activeCharges.has(a.chargeId) && activePayments.has(a.paymentId))
    .reduce((sum, a) => sum + a.amount, 0);
}

export interface NextClassCandidate {
  id: string;
  participantIds: string[];
  start: string;
  end: string;
  status: string;
  title: string | null;
  modality: string;
}

export type StudentNextClass =
  | { kind: "not-applicable" }
  | { kind: "none" }
  | { kind: "found"; timing: "in_progress" | "upcoming"; start: string; end: string; title: string | null; modality: string };

/**
 * Próxima clase (o en curso) agendada de UN alumno entre las ocurrencias reales del calendario ya cargadas. Sólo aplica a
 * alumnos activos: pausado/inactivo/archivado → «no aplica» (la agenda del alumno no se proyecta). Las canceladas no cuentan.
 */
export function pickStudentNextClass(input: { items: readonly NextClassCandidate[]; studentId: string; status: StudentStatus; now: Date }): StudentNextClass {
  if (input.status !== "activo") return { kind: "not-applicable" };
  const mine = input.items.filter((item) => item.participantIds.includes(input.studentId));
  const selected = selectCurrentOrNextOccurrence(mine, input.now);
  if (!selected) return { kind: "none" };
  const { occurrence, timing } = selected;
  return { kind: "found", timing, start: occurrence.start, end: occurrence.end, title: occurrence.title, modality: occurrence.modality };
}

/**
 * Qué «tipo» de perfil se está viendo, para que la pantalla diga lo correcto en cada caso:
 *  - `archived`: alumno archivado (conserva historial; sin agenda).
 *  - `inactive`: pausado o inactivo.
 *  - `no-activity`: activo sin ninguna clase dictada todavía.
 *  - `with-activity`: tiene clases dictadas.
 */
export type ProfileAudience = "archived" | "inactive" | "no-activity" | "with-activity";

export function resolveProfileAudience(input: { status: StudentStatus; classesHeld: number }): ProfileAudience {
  if (input.classesHeld > 0 && input.status === "activo") return "with-activity";
  if (input.status === "archivado") return "archived";
  if (input.status !== "activo") return "inactive";
  return "no-activity";
}

/** Día de vencimiento mensual del plan de cobro, sólo si el plan es mensual y el día es un entero válido (1-31). */
export function monthlyDueDayOf(billingPlan: Record<string, unknown> | null): number | null {
  if (!billingPlan || billingPlan.type !== "monthly") return null;
  const day = billingPlan.dueDay;
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}
