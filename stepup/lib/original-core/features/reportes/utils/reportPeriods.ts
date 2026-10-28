// Puerto VERBATIM del original (`src/features/reportes/utils/reportPeriods.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentReportPeriod } from '../types/index.ts';

/**
 * Constructores puros de período para el generador de reportes — reciben
 * siempre `today` como parámetro (nunca `new Date()` interno) para quedar
 * 100% testeables sin depender de la fecha real del sistema.
 */
const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildCurrentMonthPeriod(today: Date): StudentReportPeriod {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  return {
    startDate: toDateKey(year, month, 1),
    endDate: toDateKey(year, month, daysInMonth(year, month)),
    label: `${capitalize(MONTH_LABELS[month - 1])} ${year}`,
  };
}

export function buildPreviousMonthPeriod(today: Date): StudentReportPeriod {
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  const year = currentMonth === 1 ? currentYear - 1 : currentYear;
  return {
    startDate: toDateKey(year, month, 1),
    endDate: toDateKey(year, month, daysInMonth(year, month)),
    label: `${capitalize(MONTH_LABELS[month - 1])} ${year}`,
  };
}

export function buildLast30DaysPeriod(today: Date): StudentReportPeriod {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    startDate: toDateKey(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: toDateKey(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label: 'Últimos 30 días',
  };
}

function formatDayMonthYear(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

/** Período elegido a mano por la profesora — valida que el inicio no sea posterior al fin. */
export function buildCustomPeriod(startDate: string, endDate: string): StudentReportPeriod {
  if (startDate > endDate) {
    throw new RangeError('La fecha de inicio no puede ser posterior a la fecha de fin.');
  }
  return {
    startDate,
    endDate,
    label: `${formatDayMonthYear(startDate)} - ${formatDayMonthYear(endDate)}`,
  };
}
