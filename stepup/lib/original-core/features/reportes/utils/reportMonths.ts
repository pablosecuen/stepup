// Puerto VERBATIM del original (`src/features/reportes/utils/reportMonths.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson } from '../../new-class/types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, segunda ronda): reemplaza el
 * selector de rango de fechas por selección de MESES reales con clases.
 * Funciones puras — reciben `todayDateKey` como parámetro (nunca `new
 * Date()` interno), mismo criterio que `reportPeriods.ts`, para quedar
 * 100% testeables.
 *
 * Un mes "cuenta" para reportes con el mismo criterio exacto que ya usa
 * `buildStudentReportData.ts` para armar el detalle (`countsAsClass`) — así
 * nunca se duplica una clase reprogramada (la clase original queda con
 * `countsAsClass: false`) y nunca se cuenta una reserva de calendario
 * futura (se excluye explícitamente cualquier fecha posterior a hoy).
 */
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface StudentMonthOption {
  monthKey: string; // YYYY-MM
  label: string; // ej. "Julio 2026"
  classCount: number;
}

export interface SelectedMonthsRange {
  periodStart: string; // YYYY-MM-DD, primera clase incluida
  periodEnd: string; // YYYY-MM-DD, última clase incluida
  classCount: number;
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

function monthKeyToName(monthKey: string): string {
  const { month } = parseMonthKey(monthKey);
  return MONTH_NAMES[month - 1] ?? monthKey;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function nextMonthKey(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/** Mismo criterio que `heldLessons` en buildStudentReportData.ts, sin depender de un período previo. */
export function isLessonCountedForReports(lesson: SavedLesson, studentId: string, todayDateKey: string): boolean {
  return lesson.countsAsClass && lesson.form.studentIds.includes(studentId) && lesson.form.date <= todayDateKey;
}

/** Meses con al menos una clase computable del alumno, orden más-reciente-primero. */
export function getStudentMonthsWithClasses(
  allLessons: SavedLesson[],
  studentId: string,
  todayDateKey: string
): StudentMonthOption[] {
  const countByMonth = new Map<string, number>();
  for (const lesson of allLessons) {
    if (!isLessonCountedForReports(lesson, studentId, todayDateKey)) continue;
    const monthKey = lesson.form.date.slice(0, 7);
    countByMonth.set(monthKey, (countByMonth.get(monthKey) ?? 0) + 1);
  }
  return Array.from(countByMonth.entries())
    .map(([monthKey, classCount]) => ({
      monthKey,
      label: `${capitalize(monthKeyToName(monthKey))} ${parseMonthKey(monthKey).year}`,
      classCount,
    }))
    .sort((first, second) => second.monthKey.localeCompare(first.monthKey));
}

export function formatClassCount(count: number): string {
  return count === 1 ? '1 clase' : `${count} clases`;
}

/**
 * Rango real (primera y última clase incluida) de los meses elegidos —
 * nunca se le pide a la profesora que recuerde cuándo empezó el alumno.
 * Devuelve `null` si no hay ninguna clase computable en esos meses.
 */
export function computeSelectedMonthsRange(
  allLessons: SavedLesson[],
  studentId: string,
  selectedMonths: string[],
  todayDateKey: string
): SelectedMonthsRange | null {
  const monthSet = new Set(selectedMonths);
  const dates = allLessons
    .filter((lesson) => isLessonCountedForReports(lesson, studentId, todayDateKey) && monthSet.has(lesson.form.date.slice(0, 7)))
    .map((lesson) => lesson.form.date)
    .sort();
  if (dates.length === 0) return null;
  return {
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    classCount: dates.length,
  };
}

interface MonthRun {
  startKey: string;
  endKey: string;
}

function groupConsecutiveMonths(sortedMonths: string[]): MonthRun[] {
  const runs: MonthRun[] = [];
  for (const monthKey of sortedMonths) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && nextMonthKey(lastRun.endKey) === monthKey) {
      lastRun.endKey = monthKey;
    } else {
      runs.push({ startKey: monthKey, endKey: monthKey });
    }
  }
  return runs;
}

function joinWithY(phrases: string[]): string {
  if (phrases.length <= 1) return phrases.join('');
  return `${phrases.slice(0, -1).join(', ')} y ${phrases[phrases.length - 1]}`;
}

/**
 * Título automático a partir de los meses elegidos — nunca escrito a mano.
 * Ej.: "julio 2026" (un mes) / "mayo a julio 2026" (consecutivos) /
 * "marzo y junio 2026" (no consecutivos).
 */
export function buildMonthsSummaryLabel(selectedMonths: string[]): string {
  if (selectedMonths.length === 0) return '';
  const sorted = Array.from(new Set(selectedMonths)).sort();
  const runs = groupConsecutiveMonths(sorted);
  const years = new Set(sorted.map((key) => parseMonthKey(key).year));

  if (years.size === 1) {
    const phrases = runs.map((run) =>
      run.startKey === run.endKey ? monthKeyToName(run.startKey) : `${monthKeyToName(run.startKey)} a ${monthKeyToName(run.endKey)}`
    );
    return `${joinWithY(phrases)} ${[...years][0]}`;
  }

  // Meses de años distintos: se aclara el año en cada extremo para no perder precisión.
  const phrasesWithYears = runs.map((run) => {
    const startYear = parseMonthKey(run.startKey).year;
    const endYear = parseMonthKey(run.endKey).year;
    if (run.startKey === run.endKey) return `${monthKeyToName(run.startKey)} ${startYear}`;
    return `${monthKeyToName(run.startKey)} ${startYear} a ${monthKeyToName(run.endKey)} ${endYear}`;
  });
  return joinWithY(phrasesWithYears);
}

export function buildReportTitle(selectedMonths: string[]): string {
  return `Informe — ${buildMonthsSummaryLabel(selectedMonths)}`;
}
