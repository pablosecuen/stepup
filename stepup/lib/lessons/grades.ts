/**
 * Puerto exacto de `gradeAverage.ts`/`skillGradeDomain.ts` (móvil). `0`
 * NUNCA es una nota real — es el valor inicial de un slider/selector nunca
 * tocado. La ausencia de nota se guarda como `NULL` (nunca 0), y el
 * promedio sólo se calcula sobre valores reales.
 */

/** Entero 1-10; cualquier valor fuera de rango, no numérico, o 0 se normaliza a `null` ("sin calificar") — nunca se persiste 0. */
export function normalizeSkillGradeValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 1 || value > 10) return null;
  return value;
}

/**
 * Promedio real: nunca cuenta `null`/`undefined` (sin calificar) ni `0`
 * (valor inicial nunca tocado). Sin ninguna nota válida devuelve `null`,
 * nunca `0`. Redondeo a 1 decimal, igual que el móvil.
 */
export function calculateAverageGrade(grades: Array<number | null | undefined>): number | null {
  const validGrades = grades.filter((grade): grade is number => grade != null && grade > 0);
  if (validGrades.length === 0) return null;
  const sum = validGrades.reduce((total, grade) => total + grade, 0);
  return Math.round((sum / validGrades.length) * 10) / 10;
}

/** General grade 1-10 con un decimal; fuera de rango o no numérico se normaliza a `null`, nunca a 0. */
export function normalizeGeneralGrade(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 1 || value > 10) return null;
  return Math.round(value * 10) / 10;
}
