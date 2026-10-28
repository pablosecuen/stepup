import { addDaysToDateKey, startOfIsoWeek } from "../payments/dates.ts";
import { calculateAverageGrade } from "../lessons/grades.ts";

export interface HomeStats {
  activeStudents: number;
  lessonsThisWeek: number;
  /** Horas (1 decimal) de las clases dictadas este mes que tienen duración real registrada; `null` si no se pudieron leer. */
  hoursTaughtThisMonth: number | null;
  /** Promedio de TODAS las notas generales reales (1 decimal); `null` si no hay ninguna. */
  averageGrade: number | null;
}

/** Semana de Inicio: de lunes a domingo, con los días civiles de Argentina (mismo criterio de semana que el original). Devuelve el lunes y el lunes siguiente (fin exclusivo). */
export function weekBounds(todayDateKey: string): { startKey: string; endExclusiveKey: string } {
  const startKey = startOfIsoWeek(todayDateKey);
  return { startKey, endExclusiveKey: addDaysToDateKey(startKey, 7) };
}

/**
 * Indicadores de Inicio — puerto de `buildDashboardData` (original): alumnos activos; clases de la semana sin contar las canceladas; horas enseñadas este mes (clases dictadas que cuentan como
 * clase, suma de la duración real, redondeada a 1 decimal); promedio de evaluaciones (todas las notas generales reales, un 0 o la ausencia de nota nunca cuenta).
 */
export function buildHomeStats(input: {
  activeStudents: number;
  weekItems: ReadonlyArray<{ status: string }>;
  monthMinutes: ReadonlyArray<number | null>;
  grades: ReadonlyArray<number | null>;
}): HomeStats {
  const taughtMinutes = input.monthMinutes.reduce<number>((total, minutes) => total + (minutes ?? 0), 0);
  return {
    activeStudents: input.activeStudents,
    lessonsThisWeek: input.weekItems.filter((item) => item.status !== "cancelled").length,
    hoursTaughtThisMonth: Math.round((taughtMinutes / 60) * 10) / 10,
    averageGrade: calculateAverageGrade([...input.grades]),
  };
}
