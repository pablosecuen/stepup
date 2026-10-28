/**
 * Puerto de `reportMonths.ts` (móvil) — detecta los meses reales con
 * clases del alumno y calcula el período real (primera/última clase
 * incluida) de los meses seleccionados. Permite seleccionar uno o varios
 * meses, no necesariamente consecutivos (el móvil real NO tiene un
 * selector de rango de fechas libre para reportes — sólo selección por
 * meses reales con clases, `reportPeriods.ts` con "mes actual/anterior/
 * últimos 30 días/personalizado" existe en el código móvil pero está
 * desconectado de la pantalla real — no se porta esa opción para no
 * inventar una funcionalidad que la profesora nunca ve).
 */
export interface RegistrationForReportMonths {
  countsAsClass: boolean;
  dateKey: string; // fecha real de la clase, YYYY-MM-DD
}

/** Mismo criterio que `isLessonCountedForReports` (móvil) — nunca clases futuras, nunca las que no cuentan como clase. */
export function isRegistrationCountedForReports(registration: RegistrationForReportMonths, todayDateKey: string): boolean {
  return registration.countsAsClass && registration.dateKey <= todayDateKey;
}

export function getStudentMonthsWithClasses(registrations: readonly RegistrationForReportMonths[], todayDateKey: string): string[] {
  const months = new Set(
    registrations.filter((r) => isRegistrationCountedForReports(r, todayDateKey)).map((r) => r.dateKey.slice(0, 7))
  );
  return [...months].sort();
}

export interface SelectedMonthsRange {
  periodStart: string;
  periodEnd: string;
  classCount: number;
}

/** Período real = primera/última clase computable dentro de los meses elegidos — NUNCA "1 al 31 del mes". */
export function computeSelectedMonthsRange(
  registrations: readonly RegistrationForReportMonths[],
  selectedMonths: readonly string[],
  todayDateKey: string
): SelectedMonthsRange | null {
  const monthSet = new Set(selectedMonths);
  const dates = registrations
    .filter((r) => isRegistrationCountedForReports(r, todayDateKey) && monthSet.has(r.dateKey.slice(0, 7)))
    .map((r) => r.dateKey)
    .sort();
  if (dates.length === 0) return null;
  return { periodStart: dates[0], periodEnd: dates[dates.length - 1], classCount: dates.length };
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function monthKeyToName(monthKey: string): string {
  const [, monthNumber] = monthKey.split("-").map(Number);
  return MONTH_NAMES[monthNumber - 1] ?? monthKey;
}

function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/** Agrupa meses ordenados en tandas de meses seguidos: [03, 04, 06] → [03 a 04], [06]. */
function groupConsecutiveMonths(sortedMonths: readonly string[]): Array<{ startKey: string; endKey: string }> {
  const runs: Array<{ startKey: string; endKey: string }> = [];
  for (const monthKey of sortedMonths) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && nextMonthKey(lastRun.endKey) === monthKey) lastRun.endKey = monthKey;
    else runs.push({ startKey: monthKey, endKey: monthKey });
  }
  return runs;
}

function joinWithY(phrases: string[]): string {
  if (phrases.length <= 1) return phrases.join("");
  return `${phrases.slice(0, -1).join(", ")} y ${phrases[phrases.length - 1]}`;
}

/**
 * Puerto de `buildMonthsSummaryLabel` (misma lógica que el original, comparada contra él en `report-months-parity.test.ts`): el título sale de los meses elegidos, nunca escrito a mano.
 * Un mes → «julio 2026»; seguidos → «mayo a julio 2026»; salteados → «marzo y junio 2026» (el año una sola vez si es el mismo) o, de años distintos, con el año en cada extremo.
 */
export function buildMonthsSummaryLabel(selectedMonths: readonly string[]): string {
  if (selectedMonths.length === 0) return "";
  const sorted = Array.from(new Set(selectedMonths)).sort();
  const runs = groupConsecutiveMonths(sorted);
  const years = new Set(sorted.map((key) => Number(key.slice(0, 4))));
  if (years.size === 1) {
    const phrases = runs.map((run) => (run.startKey === run.endKey ? monthKeyToName(run.startKey) : `${monthKeyToName(run.startKey)} a ${monthKeyToName(run.endKey)}`));
    return `${joinWithY(phrases)} ${[...years][0]}`;
  }
  // Meses de años distintos: se aclara el año en cada extremo para no perder precisión.
  const phrasesWithYears = runs.map((run) => {
    const startYear = run.startKey.slice(0, 4);
    const endYear = run.endKey.slice(0, 4);
    if (run.startKey === run.endKey) return `${monthKeyToName(run.startKey)} ${startYear}`;
    return `${monthKeyToName(run.startKey)} ${startYear} a ${monthKeyToName(run.endKey)} ${endYear}`;
  });
  return joinWithY(phrasesWithYears);
}
