import { calculateAverageGrade } from "../lessons/grades.ts";

export interface ListRegistrationRow {
  studentId: string;
  /** Día civil de la clase (hora de Argentina). */
  dateKey: string;
  attendanceStatus: string | null;
  generalGrade: number | null;
}

export interface StudentListAggregates {
  /** Clases dictadas este mes a las que el alumno asistió (presente o tarde). */
  classesThisMonth: number;
  /** Promedio de las notas generales reales (un 0 o la ausencia de nota nunca cuenta); `null` si no hay ninguna. */
  averageGrade: number | null;
  hasPendingHomework: boolean;
}

export function buildStudentListAggregates(rows: readonly ListRegistrationRow[], studentIds: readonly string[], todayDateKey: string): Map<string, StudentListAggregates> {
  const month = todayDateKey.slice(0, 7);
  const result = new Map<string, StudentListAggregates>();
  for (const studentId of studentIds) {
    const mine = rows.filter((row) => row.studentId === studentId);
    const attendedThisMonth = mine.filter((row) => row.dateKey.slice(0, 7) === month && (row.attendanceStatus === "presente" || row.attendanceStatus === "tarde"));
    result.set(studentId, { classesThisMonth: attendedThisMonth.length, averageGrade: calculateAverageGrade(mine.map((row) => row.generalGrade)), hasPendingHomework: false });
  }
  return result;
}
