import { addDaysToDateKey, startOfIsoWeek } from "../payments/dates.ts";
import { calculateAverageGrade } from "../lessons/grades.ts";
import { heldMinutesInRange, isClassHeld, toRegisteredLessonFacts, type RegistrationRowForFacts } from "../reports/registered-lessons.ts";
import { withoutExcludedRegistrations } from "../data-exclusion/exclusion.ts";

export interface HomeStats {
  activeStudents: number;
  lessonsThisWeek: number;
  /** Horas (1 decimal) de las clases dictadas este mes que tienen duración real registrada; `null` si no se pudieron leer. */
  hoursTaughtThisMonth: number | null;
  /** Promedio de TODAS las notas generales reales (1 decimal); `null` si no hay ninguna. */
  averageGrade: number | null;
}

/** Lo que Inicio lee de la base para sus indicadores de clases dictadas: los registros FINALIZADOS de la cuenta, sus alumnos y la nota general de cada uno. */
export interface HomeStatsRawInputs {
  registrations: ReadonlyArray<RegistrationRowForFacts>;
  roster: ReadonlyArray<{ lesson_registration_id: string; student_id: string }>;
  /** Cada nota general real (una por evaluación; una clase grupal puede tener varias). */
  grades: ReadonlyArray<{ registrationId: string; grade: number }>;
}

/** Último día (AAAA-MM-DD) de un mes `AAAA-MM`. */
function lastDayOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Los minutos de las clases dictadas de UN mes civil de Argentina (`monthKey` AAAA-MM) y las notas de las clases dictadas, con EXACTAMENTE las mismas reglas que «Horas dictadas» del Resumen
 * financiero (`buildAnnualActivitySummary`): clase dictada = resultado «clase dictada» (o feriado con excepción), una entrada por registro (una grupal NO se multiplica por alumno), la clase
 * reprogramada, cancelada o con ausencia no cuenta, el día es el de la clase (programado, o real, o de alta) en la zona de Argentina, y la duración es la real, el inicio y fin reales o la
 * programada (`lessonMinutesOrNull`). Los alumnos de prueba confirmados quedan fuera, igual que en el Resumen. `null` en una entrada = clase dictada sin ninguna duración conocida. PURO.
 */
export function homeStatsInputsFrom(raw: HomeStatsRawInputs, monthKey: string, excludedStudentIds: ReadonlySet<string> = new Set()): { monthMinutes: Array<number | null>; grades: number[] } {
  const studentsByRegistration = new Map<string, string[]>();
  raw.roster.forEach((entry) => studentsByRegistration.set(entry.lesson_registration_id, [...(studentsByRegistration.get(entry.lesson_registration_id) ?? []), entry.student_id]));
  const visible = withoutExcludedRegistrations(raw.registrations, studentsByRegistration, excludedStudentIds);
  const facts = visible.map((row) => toRegisteredLessonFacts(row, { studentIds: studentsByRegistration.get(row.id) ?? [], billedAmountByStudent: null, occurrenceKey: null }));
  const monthMinutes = heldMinutesInRange(facts, { rangeStart: `${monthKey}-01`, rangeEnd: lastDayOfMonth(monthKey) });
  const heldIds = new Set(facts.filter((fact) => isClassHeld(fact)).map((fact) => fact.id));
  return { monthMinutes, grades: raw.grades.filter((entry) => heldIds.has(entry.registrationId) && Number.isFinite(entry.grade)).map((entry) => entry.grade) };
}

/** Semana de Inicio: de lunes a domingo, con los días civiles de Argentina (mismo criterio de semana que el original). Devuelve el lunes y el lunes siguiente (fin exclusivo). */
export function weekBounds(todayDateKey: string): { startKey: string; endExclusiveKey: string } {
  const startKey = startOfIsoWeek(todayDateKey);
  return { startKey, endExclusiveKey: addDaysToDateKey(startKey, 7) };
}

/**
 * Indicadores de Inicio — puerto de `buildDashboardData` (original): alumnos activos; clases de la semana sin contar las canceladas; horas enseñadas este mes (clases dictadas que cuentan como
 * clase, una vez cada una, suma de su duración resuelta con `lessonMinutesOrNull`, redondeada a 1 decimal); promedio de evaluaciones (todas las notas generales reales, un 0 o la ausencia de nota nunca cuenta).
 */
export function buildHomeStats(input: {
  activeStudents: number;
  weekItems: ReadonlyArray<{ status: string }>;
  monthMinutes: ReadonlyArray<number | null>;
  grades: ReadonlyArray<number | null>;
}): HomeStats {
  const taughtMinutes = input.monthMinutes.reduce<number>((total, minutes) => total + (minutes ?? 0), 0);
  // Hay clases dictadas este mes pero ninguna con duración conocida: «Sin datos», nunca un 0 que parezca real. Sin clases dictadas, 0 h es la verdad.
  const unmeasuredOnly = input.monthMinutes.length > 0 && input.monthMinutes.every((minutes) => minutes === null);
  return {
    activeStudents: input.activeStudents,
    // Recibe la agenda ya resuelta (`resolveAgendaItems`); el filtro de canceladas se conserva por si algún llamador pasa la lista completa.
    lessonsThisWeek: input.weekItems.filter((item) => item.status !== "cancelled").length,
    hoursTaughtThisMonth: unmeasuredOnly ? null : Math.round((taughtMinutes / 60) * 10) / 10,
    averageGrade: calculateAverageGrade([...input.grades]),
  };
}
