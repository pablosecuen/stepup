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

function monthLabel(month: string): { name: string; year: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return { name: MONTH_NAMES[monthNumber - 1], year };
}

function areConsecutiveMonths(sortedMonths: readonly string[]): boolean {
  for (let i = 1; i < sortedMonths.length; i += 1) {
    const [prevYear, prevMonth] = sortedMonths[i - 1].split("-").map(Number);
    const [year, month] = sortedMonths[i].split("-").map(Number);
    const prevTotal = prevYear * 12 + prevMonth;
    const total = year * 12 + month;
    if (total - prevTotal !== 1) return false;
  }
  return true;
}

/** Puerto de `buildMonthsSummaryLabel` — título distinto según sean consecutivos o no. */
export function buildMonthsSummaryLabel(selectedMonths: readonly string[]): string {
  if (selectedMonths.length === 0) return "";
  const sorted = [...selectedMonths].sort();
  if (sorted.length === 1) {
    const { name, year } = monthLabel(sorted[0]);
    return `${name} ${year}`;
  }
  if (areConsecutiveMonths(sorted)) {
    const first = monthLabel(sorted[0]);
    const last = monthLabel(sorted[sorted.length - 1]);
    return first.year === last.year ? `${first.name} a ${last.name} ${last.year}` : `${first.name} ${first.year} a ${last.name} ${last.year}`;
  }
  const labels = sorted.map((m) => {
    const { name, year } = monthLabel(m);
    return `${name} ${year}`;
  });
  return labels.length === 2 ? labels.join(" y ") : `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}
