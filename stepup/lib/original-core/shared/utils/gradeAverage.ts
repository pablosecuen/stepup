// Puerto VERBATIM del original (`src/shared/utils/gradeAverage.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección P0 (a pedido de Joaquín — PROMEDIOS REALES): única función
 * pura de cálculo de promedio de calificaciones — la usan tanto el perfil
 * del alumno (`recomputeStudentLessonDerivedFields`) como cualquier otra
 * pantalla que necesite un promedio a partir de un conjunto de notas.
 * Nunca cuenta `null`/`undefined` (sin calificar) ni `0` (valor inicial de
 * un slider/selector nunca tocado — ver `SkillGradeChips.tsx`/
 * `SkillGradeInput.tsx`, donde 0 nunca es una nota real). Sin ninguna nota
 * válida, devuelve `null` — nunca inventa 0.0 ni ningún valor por defecto.
 */
export function calculateAverageGrade(
  grades: Array<number | null | undefined>
): number | null {
  const validGrades = grades.filter(
    (grade): grade is number => grade != null && grade > 0
  );
  if (validGrades.length === 0) return null;
  const sum = validGrades.reduce((total, grade) => total + grade, 0);
  return Math.round((sum / validGrades.length) * 10) / 10;
}

/**
 * Formato de presentación único para el promedio — nunca "0.0" para un
 * alumno sin ninguna calificación real; siempre el texto exacto de estado
 * vacío pedido, igual en listado, perfil e historial.
 */
export function formatAverageGrade(averageGrade: number | null): string {
  return averageGrade === null ? 'Sin calificaciones' : averageGrade.toFixed(1);
}
