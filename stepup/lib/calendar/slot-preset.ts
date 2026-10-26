import type { RecurrenceWeek } from "./types.ts";

/**
 * Horario elegido al tocar un espacio libre del Calendario: día civil (AAAA-MM-DD, el de la columna tocada, en la zona horaria de la cuenta), hora de la grilla y duración.
 * Viaja por todo el circuito de «Nueva clase» (clase única Y serie) sin pasar nunca por una conversión de zona horaria: sólo se trabaja con la fecha civil escrita, así el día y
 * la hora no pueden correrse. PURO.
 */
export interface SlotPreset {
  date: string;
  hour: number;
  minute: number;
  durationMinutes: number;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha civil real (no 2026-02-31)? */
export function isCivilDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function integerInRange(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === "" || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** El horario de los parámetros de la URL (`date`, `hour`, `minute`, `duration`), o `null` si no hay una fecha y hora válidas (entonces rige la selección manual de siempre). */
export function parseSlotPreset(input: { date?: string; hour?: string; minute?: string; duration?: string }): SlotPreset | null {
  if (!input.date || !isCivilDateKey(input.date)) return null;
  const hour = integerInRange(input.hour, 0, 23);
  if (hour === null) return null;
  const minute = integerInRange(input.minute ?? "0", 0, 59) ?? 0;
  const durationMinutes = integerInRange(input.duration, 1, 24 * 60) ?? 60;
  return { date: input.date, hour, minute, durationMinutes };
}

/** Día de la semana de una fecha civil: 0 = lunes … 6 = domingo (el mismo índice que `RecurrenceSession.weekday`). */
export function weekdayIndexOfDate(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Patrón semanal de una serie que se repite cada semana en el día y la hora del horario elegido. */
export function seriesWeeksFromSlot(slot: SlotPreset): RecurrenceWeek[] {
  return [{ weekIndex: 0, sessions: [{ weekday: weekdayIndexOfDate(slot.date), hour: slot.hour, minute: slot.minute, durationMinutes: slot.durationMinutes }] }];
}

export const WEEKDAY_NAMES_LOWER = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

export const formatClock = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** «los miércoles a las 22:00; los viernes a las 18:30» — los días activados del PRIMER ciclo; vacío si no hay ninguno. */
export function describeWeeklySessions(weeks: RecurrenceWeek[]): string {
  const first = weeks.find((week) => week.weekIndex === 0) ?? weeks[0];
  if (!first) return "";
  return [...first.sessions]
    .sort((a, b) => a.weekday - b.weekday)
    .map((session) => `los ${WEEKDAY_NAMES_LOWER[session.weekday]} a las ${formatClock(session.hour, session.minute)}`)
    .join("; ");
}
