import { isClassHeld, type RegisteredLessonFacts } from "./registered-lessons.ts";

/**
 * Puerto exacto de `buildStudentYearActivitySummary`/`buildNewStudentsPerMonthSummary` (móvil, `studentYearSummary.ts`). Pura.
 *
 * - Alumnos únicos atendidos: alumnos con al menos una clase DICTADA en el año (mismo `isClassHeld` que la app); una clase compartida cuenta a cada participante una sola vez. Sólo alumnos que existen.
 * - Activos actualmente: estado real del perfil, nunca inferido por tener clases a futuro.
 * - Nuevos: fecha real de alta (`dateJoined`), nunca la de la primera clase ni la del primer pago.
 */
export interface StudentForYearSummary {
  id: string;
  status: string;
  dateJoined: string; // YYYY-MM-DD ("" si no hay)
}

export interface StudentYearActivitySummary {
  year: number;
  uniqueStudentsAttended: number;
  activeStudentsNow: number;
  newStudentsThisYear: number;
}

export function buildStudentYearActivitySummary(input: { year: number; students: readonly StudentForYearSummary[]; lessons: readonly RegisteredLessonFacts[] }): StudentYearActivitySummary {
  const { year, students, lessons } = input;
  const rangeStart = `${year}-01-01`;
  const rangeEnd = `${year}-12-31`;
  const validStudentIds = new Set(students.map((student) => student.id));

  const attended = new Set<string>();
  lessons
    .filter((lesson) => lesson.dateKey >= rangeStart && lesson.dateKey <= rangeEnd && isClassHeld(lesson))
    .forEach((lesson) => {
      lesson.studentIds.forEach((studentId) => {
        if (validStudentIds.has(studentId)) attended.add(studentId);
      });
    });

  return {
    year,
    uniqueStudentsAttended: attended.size,
    activeStudentsNow: students.filter((student) => student.status === "activo").length,
    newStudentsThisYear: students.filter((student) => student.dateJoined.slice(0, 4) === String(year)).length,
  };
}

export interface MonthlyNewStudents {
  month: number; // 1-12
  count: number;
}

export interface NewStudentsPerMonthSummary {
  year: number;
  /** Siempre 12 entradas; los meses sin altas valen 0. */
  months: MonthlyNewStudents[];
  total: number;
  /** Mes(es) con más incorporaciones — más de uno si empatan. */
  peakMonths: number[];
  /** `null` si no hay datos del año anterior para comparar. */
  previousYearTotal: number | null;
}

export function buildNewStudentsPerMonthSummary(input: { year: number; students: readonly { dateJoined: string }[] }): NewStudentsPerMonthSummary {
  const { year, students } = input;
  const counts = new Array(12).fill(0) as number[];
  let previousYearTotal = 0;
  let hasPreviousYearData = false;

  students.forEach((student) => {
    if (student.dateJoined === "") return;
    const [studentYear, studentMonth] = student.dateJoined.split("-").map(Number);
    if (studentYear === year) counts[studentMonth - 1] += 1;
    else if (studentYear === year - 1) {
      previousYearTotal += 1;
      hasPreviousYearData = true;
    }
  });

  const months: MonthlyNewStudents[] = counts.map((count, index) => ({ month: index + 1, count }));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const maxCount = Math.max(0, ...counts);
  const peakMonths = maxCount > 0 ? months.filter((entry) => entry.count === maxCount).map((entry) => entry.month) : [];

  return { year, months, total, peakMonths, previousYearTotal: hasPreviousYearData ? previousYearTotal : null };
}
