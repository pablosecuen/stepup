import type { CalendarViewItem } from "./occurrences";
import { instantDateKey, instantMinutesOfDay } from "./civil-calendar.ts";

/**
 * Geometría pura de la grilla — puerto genérico de `lib/calendar-layout.ts`
 * (Fase A, sólo fixtures) para datos REALES (`CalendarViewItem[]`). Mismas
 * constantes/criterios: semana lunes→domingo, eje 08:00–21:00, ancho
 * completo de columna (nunca carriles paralelos), alto de tarjeta acotado
 * al hueco real hasta la próxima clase.
 *
 * Los días son claves civiles (`civil-calendar.ts`) y la hora de una tarjeta
 * se lee en la zona explícita del calendario, nunca con `getHours()` de la
 * zona del proceso: servidor (UTC) y navegador dibujan la misma posición.
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

export interface PositionedItem {
  item: CalendarViewItem;
  top: number;
  height: number;
}

/** Agrupa las tarjetas por su día civil (clave YYYY-MM-DD en la zona del calendario). */
export function groupItemsByDayKey(items: CalendarViewItem[]): Map<string, CalendarViewItem[]> {
  const byDayKey = new Map<string, CalendarViewItem[]>();
  for (const item of items) {
    const key = instantDateKey(item.start);
    const bucket = byDayKey.get(key);
    if (bucket) bucket.push(item);
    else byDayKey.set(key, [item]);
  }
  return byDayKey;
}

function minutesFromDayStart(iso: string): number {
  return instantMinutesOfDay(iso) - START_HOUR * 60;
}

/** Igual criterio que `layoutDayLessons` (Fase A): el alto nunca invade la próxima tarjeta del mismo día. */
export function layoutDayItems(items: CalendarViewItem[]): PositionedItem[] {
  const withTimes = items
    .map((item) => ({ item, startMs: new Date(item.start).getTime(), endMs: new Date(item.end).getTime() }))
    .sort((a, b) => a.startMs - b.startMs);

  const gridBottomPx = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

  return withTimes.map(({ item, startMs, endMs }, index) => {
    const top = Math.max(0, (minutesFromDayStart(item.start) / 60) * HOUR_HEIGHT_PX);
    const durationMinutes = (endMs - startMs) / 60_000;
    const naturalHeight = (durationMinutes / 60) * HOUR_HEIGHT_PX - CARD_GAP_PX;

    const next = withTimes[index + 1];
    const nextTopPx = next ? (minutesFromDayStart(next.item.start) / 60) * HOUR_HEIGHT_PX : gridBottomPx;
    const availableToNextPx = Math.max(0, nextTopPx - top - CARD_GAP_PX);

    const height = Math.min(availableToNextPx, Math.max(MIN_CARD_HEIGHT_PX, naturalHeight));
    return { item, top, height };
  });
}

export function currentTimeTop(now: Date): number | null {
  const minutesOfDay = instantMinutesOfDay(now.toISOString());
  if (minutesOfDay < START_HOUR * 60 || minutesOfDay >= END_HOUR * 60) return null;
  return ((minutesOfDay - START_HOUR * 60) / 60) * HOUR_HEIGHT_PX;
}
