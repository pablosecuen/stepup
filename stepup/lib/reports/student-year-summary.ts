/**
 * Puerto de `buildStudentYearActivitySummary`/`buildNewStudentsPerMonthSummary`
 * (móvil, `studentYearSummary.ts`). Pura.
 */
export interface StudentForYearSummary {
  id: string;
  status: "activo" | "pausado" | "inactivo" | "archivado";
  dateJoined: string; // YYYY-MM-DD
}

export interface RegistrationForYearSummary {
  studentId: string;
  countsAsClass: boolean;
  dateKey: string; // fecha real de la clase, YYYY-MM-DD
}

export interface StudentYearActivitySummary {
  year: number;
  uniqueStudentsAttended: number;
  activeStudentsNow: number;
  newStudentsThisYear: number;
}

export function buildStudentYearActivitySummary(input: {
  year: number;
  students: readonly StudentForYearSummary[];
  registrations: readonly RegistrationForYearSummary[];
}): StudentYearActivitySummary {
  const yearPrefix = String(input.year);
  const attendedThisYear = new Set(
    input.registrations.filter((r) => r.countsAsClass && r.dateKey.slice(0, 4) === yearPrefix).map((r) => r.studentId)
  );

  return {
    year: input.year,
    uniqueStudentsAttended: attendedThisYear.size,
    activeStudentsNow: input.students.filter((s) => s.status === "activo").length,
    newStudentsThisYear: input.students.filter((s) => s.dateJoined.slice(0, 4) === yearPrefix).length,
  };
}

export interface NewStudentsPerMonthEntry {
  month: string; // YYYY-MM
  count: number;
}

export interface NewStudentsPerMonthSummary {
  year: number;
  entries: NewStudentsPerMonthEntry[]; // 12 entradas, meses sin alta en 0
  peakMonths: string[]; // empates soportados
  total: number;
  previousYearTotal: number | null; // null si no hay datos del año anterior
}

export function buildNewStudentsPerMonthSummary(input: { year: number; students: readonly StudentForYearSummary[] }): NewStudentsPerMonthSummary {
  const yearPrefix = String(input.year);
  const previousYearPrefix = String(input.year - 1);

  const countsByMonth = new Map<string, number>();
  for (let month = 1; month <= 12; month += 1) {
    countsByMonth.set(`${yearPrefix}-${String(month).padStart(2, "0")}`, 0);
  }
  let previousYearTotal = 0;
  let hasPreviousYearData = false;
  input.students.forEach((student) => {
    const yearPart = student.dateJoined.slice(0, 4);
    if (yearPart === yearPrefix) {
      const monthKey = student.dateJoined.slice(0, 7);
      countsByMonth.set(monthKey, (countsByMonth.get(monthKey) ?? 0) + 1);
    } else if (yearPart === previousYearPrefix) {
      previousYearTotal += 1;
      hasPreviousYearData = true;
    }
  });

  const entries = [...countsByMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, count]) => ({ month, count }));
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const maxCount = Math.max(0, ...entries.map((e) => e.count));
  const peakMonths = maxCount > 0 ? entries.filter((e) => e.count === maxCount).map((e) => e.month) : [];

  return { year: input.year, entries, peakMonths, total, previousYearTotal: hasPreviousYearData ? previousYearTotal : null };
}
