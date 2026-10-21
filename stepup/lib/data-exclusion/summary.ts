/**
 * Resumen de los datos marcados como prueba (R16), para que la usuaria los consulte y los revierta. PURO: arma el resumen a partir de filas ya leídas. Sin nombres de alumnos reales: sólo los alumnos marcados.
 */
export interface TestDataExclusionRow {
  id: string;
  student_id: string;
  reason: string;
  evidence: unknown;
  created_at: string;
  revoked_at: string | null;
}

export interface TestDataStudentSummary {
  studentId: string;
  name: string;
  status: string;
  createdAt: string;
  /** `true` si hoy sus datos están ocultos (exclusión vigente). */
  hidden: boolean;
  seriesCount: number;
  lessonCount: number;
  registrationCount: number;
  chargeCount: number;
}

export interface TestDataSummary {
  /** Cuántos alumnos tienen sus datos ocultos hoy. */
  hiddenCount: number;
  /** Cuántos alumnos marcados tienen sus datos visibles (exclusión revocada). */
  visibleCount: number;
  students: TestDataStudentSummary[];
}

export function buildTestDataSummary(input: {
  exclusions: readonly TestDataExclusionRow[];
  students: readonly { id: string; name: string; status: string; created_at: string }[];
  ruleLinks: readonly { student_id: string; recurrence_rule_id: string }[];
  lessonLinks: readonly { student_id: string; calendar_lesson_id: string }[];
  registrationLinks: readonly { student_id: string; lesson_registration_id: string }[];
  charges: readonly { student_id: string; voided_at: string | null }[];
}): TestDataSummary {
  const hiddenIds = new Set(input.exclusions.filter((row) => row.revoked_at === null).map((row) => row.student_id));
  const markedIds = new Set(input.exclusions.map((row) => row.student_id));
  const distinct = <T extends { student_id: string }>(rows: readonly T[], key: (row: T) => string, studentId: string) => new Set(rows.filter((row) => row.student_id === studentId).map(key)).size;

  const students = input.students
    .filter((student) => markedIds.has(student.id))
    .map((student) => ({
      studentId: student.id,
      name: student.name,
      status: student.status,
      createdAt: student.created_at,
      hidden: hiddenIds.has(student.id),
      seriesCount: distinct(input.ruleLinks, (row) => row.recurrence_rule_id, student.id),
      lessonCount: distinct(input.lessonLinks, (row) => row.calendar_lesson_id, student.id),
      registrationCount: distinct(input.registrationLinks, (row) => row.lesson_registration_id, student.id),
      chargeCount: input.charges.filter((row) => row.student_id === student.id).length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.name < b.name ? -1 : 1));

  return { hiddenCount: students.filter((student) => student.hidden).length, visibleCount: students.filter((student) => !student.hidden).length, students };
}
