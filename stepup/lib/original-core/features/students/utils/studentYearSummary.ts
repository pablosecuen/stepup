// Puerto VERBATIM del original (`src/features/students/utils/studentYearSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Alumnos del año y alumnos nuevos por mes (Fase "Analíticas financieras,
 * demanda y resumen anual", a pedido de Joaquín) — secciones 7 y 8 del
 * pedido. Pura — no muta `lessons` ni `students`.
 *
 * Alumnos únicos atendidos: `studentId` únicos con al menos una clase
 * dictada (`eventType: 'clase_dictada'`, o `'feriado'` con
 * `holidayException`) cuya fecha cae dentro del año. Una clase compartida
 * cuenta cada participante una sola vez en el total (vía `Set`), nunca una
 * vez por clase.
 *
 * Exclusión de perfiles huérfanos/datos de prueba: el modelo real no tiene
 * ningún campo `isTestData`/`isOrphan` — la única señal reutilizable ya
 * existente en el código (`dataIntegrity.ts`) es "¿el id está en la
 * colección real de alumnos?". Por eso este módulo acepta opcionalmente
 * `validStudentIds` (la misma lista de `StudentListItem`/`StudentProfile`
 * reales) y, si se provee, descarta cualquier `studentId` que no esté ahí
 * — huérfanos y datos de prueba quedan afuera sin inventar un campo nuevo.
 * Sin ese parámetro, cuenta todos los `studentId` que aparezcan en clases
 * reales (incluye alumnos eliminados pero con historial pedagógico
 * conservado, tal como pide el punto 7 — nunca expone nombres, sólo IDs).
 *
 * Activos actualmente: usa el `status` canónico del perfil
 * (`StudentStatus === 'activo'`), nunca se infiere por tener una próxima
 * clase.
 *
 * Alumnos nuevos: usa `StudentProfile.dateJoined` (la fecha real de alta,
 * nunca se reemplaza) — nunca la fecha de la primera clase, del primer
 * pago ni de una edición posterior.
 */
import type { SavedLesson } from '../../new-class/types/index.ts';
import { isClassHeld } from '../../new-class/utils/validation.ts';

export interface StudentYearActivitySummary {
  year: number;
  uniqueStudentsAttended: number;
  activeStudentsNow: number;
  newStudentsThisYear: number;
}

export function buildStudentYearActivitySummary(input: {
  lessons: readonly SavedLesson[];
  students: ReadonlyArray<{ id: string; status: string; dateJoined: string }>;
  year: number;
  validStudentIds?: ReadonlySet<string>;
}): StudentYearActivitySummary {
  const { lessons, students, year, validStudentIds } = input;
  const rangeStart = `${year}-01-01`;
  const rangeEnd = `${year}-12-31`;

  const uniqueStudents = new Set<string>();
  lessons
    .filter((lesson) => lesson.form.date >= rangeStart && lesson.form.date <= rangeEnd)
    .filter((lesson) => isClassHeld(lesson.form))
    .forEach((lesson) => {
      lesson.form.studentIds.forEach((studentId) => {
        if (validStudentIds && !validStudentIds.has(studentId)) return;
        uniqueStudents.add(studentId);
      });
    });

  const activeStudentsNow = students.filter((student) => student.status === 'activo').length;
  const newStudentsThisYear = students.filter(
    (student) => student.dateJoined.slice(0, 4) === String(year)
  ).length;

  return {
    year,
    uniqueStudentsAttended: uniqueStudents.size,
    activeStudentsNow,
    newStudentsThisYear,
  };
}

// ---------------------------------------------------------------------------
// Alumnos nuevos por mes (sección 8).
// ---------------------------------------------------------------------------

export interface MonthlyNewStudents {
  month: number; // 1-12
  count: number;
}

export interface NewStudentsPerMonthSummary {
  year: number;
  months: MonthlyNewStudents[]; // siempre 12 entradas, meses sin alta en 0
  total: number;
  /** Mes(es) con más incorporaciones — más de uno si empatan. */
  peakMonths: number[];
  /** `null` si no hay datos del año anterior para comparar. */
  previousYearTotal: number | null;
}

export function buildNewStudentsPerMonthSummary(input: {
  students: ReadonlyArray<{ dateJoined: string }>;
  year: number;
}): NewStudentsPerMonthSummary {
  const { students, year } = input;

  const counts = new Array(12).fill(0) as number[];
  let previousYearTotal = 0;
  let hasPreviousYearData = false;

  students.forEach((student) => {
    const [studentYear, studentMonth] = student.dateJoined.split('-').map(Number);
    if (studentYear === year) {
      counts[studentMonth - 1] += 1;
    } else if (studentYear === year - 1) {
      previousYearTotal += 1;
      hasPreviousYearData = true;
    }
  });

  const months: MonthlyNewStudents[] = counts.map((count, index) => ({ month: index + 1, count }));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const maxCount = Math.max(0, ...counts);
  const peakMonths = maxCount > 0 ? months.filter((entry) => entry.count === maxCount).map((entry) => entry.month) : [];

  return {
    year,
    months,
    total,
    peakMonths,
    previousYearTotal: hasPreviousYearData ? previousYearTotal : null,
  };
}
