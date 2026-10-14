import { addDaysToDateKey } from "./timezone.ts";
import { formatCivilMonthYear } from "../format/date-format.ts";

/**
 * Navegación temporal del encabezado del Calendario: «‹ octubre 2026 ›». Sólo texto y nombres accesibles; las fechas siguen siendo
 * las del servidor (`week`/`day` de la URL) y nada de acá las modifica.
 *
 * Fecha ancla: en Día es el día visible; en Semana, el jueves de la semana visible. Una semana tiene siete días y el jueves es el
 * cuarto: el mes del jueves es siempre el mes en el que caen MÁS días de esa semana (28 sept – 4 oct → «octubre»).
 */
export type CalendarHeaderView = "week" | "day";

export function calendarAnchorKey(view: CalendarHeaderView, weekStartKey: string, dayKey: string): string {
  return view === "week" ? addDaysToDateKey(weekStartKey, 3) : dayKey;
}

export interface CalendarHeaderNav {
  readonly monthLabel: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
}

export function calendarHeaderNav(view: CalendarHeaderView, weekStartKey: string, dayKey: string): CalendarHeaderNav {
  return {
    monthLabel: formatCivilMonthYear(calendarAnchorKey(view, weekStartKey, dayKey)),
    previousLabel: view === "week" ? "Semana anterior" : "Día anterior",
    nextLabel: view === "week" ? "Semana siguiente" : "Día siguiente",
  };
}
