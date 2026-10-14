import type { CalendarViewItem } from "./occurrences";
import { instantDateKey, instantMinutesOfDay } from "./civil-calendar.ts";

/**
 * Geometría pura de la grilla — puerto genérico de `lib/calendar-layout.ts`
 * (Fase A, sólo fixtures) para datos REALES (`CalendarViewItem[]`). Semana
 * lunes→domingo, eje 08:00–22:00.
 *
 * Posición y alto del BLOQUE VISUAL son exactos: `top` sale de la hora de inicio y
 * `height` de la duración real (menos una separación fija). La ZONA INTERACTIVA
 * (`hitTop`/`hitHeight`) nunca mide menos de 44 px: si el bloque es más corto se
 * extiende hacia abajo (o hacia arriba pegada al borde inferior de la grilla) y
 * el bloque queda dentro de ella en `blockOffset`.
 *
 * Las clases cuyas zonas se tocan se reparten en CARRILES paralelos dentro de la
 * columna del día: orden estable por inicio, fin e id; cada una toma el primer
 * carril libre y todas las de un mismo grupo comparten el ancho (`laneCount`).
 * Así ninguna clase queda tapada y ninguna zona de toque pisa a otra.
 *
 * Los días son claves civiles (`civil-calendar.ts`) y la hora de una tarjeta
 * se lee en la zona explícita del calendario, nunca con `getHours()` de la
 * zona del proceso: servidor (UTC) y navegador dibujan la misma posición.
 */
export const START_HOUR = 8;
export const END_HOUR = 22;
/** Alto por hora de la densidad «Media» (la de partida; ver `density.ts`): las funciones de abajo reciben el de la densidad elegida. */
export const HOUR_HEIGHT_PX = 64;
export const TIME_COLUMN_WIDTH_PX = 48;
export const DAY_COLUMN_MIN_WIDTH_PX = 148;
/** Lado mínimo de todo objetivo táctil. */
export const MIN_TARGET_PX = 44;
/** Ancho mínimo de un carril: con más carriles la columna del día se ensancha en vez de comprimirse. */
export const LANE_MIN_WIDTH_PX = 68;
const CARD_GAP_PX = 6;
/** Sólo evita un bloque invisible para duraciones absurdas; cualquier clase real (≥ 5 min) usa su alto exacto. */
const MIN_VISUAL_HEIGHT_PX = 4;

export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
export const WEEKDAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

export interface PositionedItem {
  item: CalendarViewItem;
  /** Posición del bloque visual (exacta, en px desde las 08:00). */
  top: number;
  /** Alto del bloque visual (duración exacta menos la separación). */
  height: number;
  /** Zona interactiva: nunca menor de 44 px de alto. */
  hitTop: number;
  hitHeight: number;
  /** Desplazamiento del bloque visual dentro de la zona interactiva. */
  blockOffset: number;
  /** Carril (0 = el primero) y cantidad de carriles del grupo de clases que se tocan. */
  lane: number;
  laneCount: number;
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

/** Orden estable y determinista de las clases de un día: inicio, fin e id (también es el orden de tabulación). */
function compareItems(a: { startMs: number; endMs: number; item: CalendarViewItem }, b: { startMs: number; endMs: number; item: CalendarViewItem }): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.endMs !== b.endMs) return a.endMs - b.endMs;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/**
 * Posiciona TODAS las clases de un día — ninguna se oculta ni se descarta. Las que se tocan (mismo inicio, superpuestas o
 * demasiado seguidas para que sus zonas de 44 px no se pisen) se reparten en carriles.
 */
export function layoutDayItems(items: CalendarViewItem[], hourHeightPx: number = HOUR_HEIGHT_PX): PositionedItem[] {
  const gridBottomPx = (END_HOUR - START_HOUR) * hourHeightPx;

  const sorted = items
    .map((item) => ({ item, startMs: new Date(item.start).getTime(), endMs: new Date(item.end).getTime() }))
    .sort(compareItems);

  const boxes = sorted.map(({ item, startMs, endMs }) => {
    const top = Math.max(0, (minutesFromDayStart(item.start) / 60) * hourHeightPx);
    const durationPx = ((endMs - startMs) / 3_600_000) * hourHeightPx;
    const height = Math.max(MIN_VISUAL_HEIGHT_PX, Math.min(durationPx - CARD_GAP_PX, gridBottomPx - top));
    const hitHeight = Math.max(height, MIN_TARGET_PX);
    const displayTop = Math.max(0, Math.min(top, gridBottomPx - height));
    const hitTop = Math.max(0, Math.min(displayTop, gridBottomPx - hitHeight));
    return { item, top, height, hitTop, hitHeight, blockOffset: displayTop - hitTop, lane: 0, laneCount: 1 };
  });

  // Carriles por grupos de zonas que se tocan. El recorrido es por `hitTop` creciente (el orden de `sorted` lo conserva).
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  let groupStart = 0;
  const closeGroup = (end: number) => {
    for (let k = groupStart; k < end; k++) boxes[k].laneCount = laneEnds.length;
  };
  boxes.forEach((box, index) => {
    if (box.hitTop >= groupEnd) {
      closeGroup(index);
      laneEnds = [];
      groupStart = index;
    }
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= box.hitTop);
    box.lane = free === -1 ? laneEnds.length : free;
    laneEnds[box.lane] = box.hitTop + box.hitHeight;
    groupEnd = Math.max(groupEnd, laneEnds[box.lane]);
  });
  closeGroup(boxes.length);

  return boxes;
}

/** Ancho mínimo de la columna de un día: cada carril conserva al menos `LANE_MIN_WIDTH_PX`. */
export function dayColumnMinWidth(positioned: PositionedItem[]): number {
  const lanes = positioned.reduce((max, p) => Math.max(max, p.laneCount), 1);
  return Math.max(DAY_COLUMN_MIN_WIDTH_PX, lanes * LANE_MIN_WIDTH_PX);
}

export function currentTimeTop(now: Date, hourHeightPx: number = HOUR_HEIGHT_PX): number | null {
  const minutesOfDay = instantMinutesOfDay(now.toISOString());
  if (minutesOfDay < START_HOUR * 60 || minutesOfDay >= END_HOUR * 60) return null;
  return ((minutesOfDay - START_HOUR * 60) / 60) * hourHeightPx;
}
