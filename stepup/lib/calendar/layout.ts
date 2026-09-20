import type { CalendarViewItem } from "./occurrences";

/**
 * Geometría pura de la grilla — puerto genérico de `lib/calendar-layout.ts`
 * (Fase A, sólo fixtures) para datos REALES (`CalendarViewItem[]`). Mismas
 * constantes/criterios: semana lunes→domingo, eje 08:00–21:00, ancho
 * completo de columna (nunca carriles paralelos), alto de tarjeta acotado
 * al hueco real hasta la próxima clase.
 */
export const START_HOUR = 8;
export const END_HOUR = 22;
export const HOUR_HEIGHT_PX = 80;
export const TIME_COLUMN_WIDTH_PX = 48;
export const DAY_COLUMN_MIN_WIDTH_PX = 168;
const CARD_GAP_PX = 6;
const MIN_CARD_HEIGHT_PX = 46;

export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
export const WEEKDAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const startLabel = weekStart.toLocaleDateString("es-AR", { day: "2-digit" });
  const endLabel = weekEnd.toLocaleDateString("es-AR", { day: "2-digit", month: sameMonth ? undefined : "short" });
  const monthYearLabel = weekEnd.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return `${startLabel} - ${endLabel} de ${monthYearLabel}`;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export interface PositionedItem {
  item: CalendarViewItem;
  top: number;
  height: number;
}

function minutesFromDayStart(date: Date): number {
  return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
}

/** Igual criterio que `layoutDayLessons` (Fase A): el alto nunca invade la próxima tarjeta del mismo día. */
export function layoutDayItems(items: CalendarViewItem[]): PositionedItem[] {
  const withTimes = items
    .map((item) => ({ item, start: new Date(item.start), end: new Date(item.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const gridBottomPx = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

  return withTimes.map(({ item, start }, index) => {
    const top = Math.max(0, (minutesFromDayStart(start) / 60) * HOUR_HEIGHT_PX);
    const durationMinutes = (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000;
    const naturalHeight = (durationMinutes / 60) * HOUR_HEIGHT_PX - CARD_GAP_PX;

    const next = withTimes[index + 1];
    const nextTopPx = next ? (minutesFromDayStart(next.start) / 60) * HOUR_HEIGHT_PX : gridBottomPx;
    const availableToNextPx = Math.max(0, nextTopPx - top - CARD_GAP_PX);

    const height = Math.min(availableToNextPx, Math.max(MIN_CARD_HEIGHT_PX, naturalHeight));
    return { item, top, height };
  });
}

export function currentTimeTop(now: Date): number | null {
  const minutesFromStart = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  if (now.getHours() < START_HOUR || now.getHours() >= END_HOUR) return null;
  return (minutesFromStart / 60) * HOUR_HEIGHT_PX;
}
