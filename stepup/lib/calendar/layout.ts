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
/** Ancho mínimo de la columna de un día para que la grilla tenga sentido; con menos, el Calendario usa la agenda por día. */
export const MIN_DAY_COLUMN_WIDTH_PX = 96;
/** Lado mínimo de todo objetivo táctil. */
export const MIN_TARGET_PX = 44;
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

/**
 * Los carriles NUNCA ensanchan la columna del día: cada uno divide el ancho disponible. Lo que sí cambia es cuánto texto entra en
 * la tarjeta (`cardPresentation`): si no cabe, pasa a un modo más compacto en vez de ensanchar la grilla o desbordar.
 */
export function cardInsetPx(laneCount: number): number {
  return laneCount === 1 ? 4 : 2;
}

/** Ancho real de una tarjeta: su carril dentro de la columna, menos el margen a cada lado. */
export function cardWidthPx(columnWidthPx: number, laneCount: number): number {
  return Math.max(0, columnWidthPx / Math.max(1, laneCount) - cardInsetPx(laneCount) * 2);
}

/** Ancho de la columna de un día según el ancho útil de la zona de agenda (sin la columna de horas ni los bordes de las columnas). */
export function dayColumnWidthPx(areaWidthPx: number, dayCount: number): number {
  const borders = 3 + dayCount; // marco de la zona + borde izquierdo de cada día
  return Math.max(0, (areaWidthPx - TIME_COLUMN_WIDTH_PX - borders) / Math.max(1, dayCount));
}

/** ¿La grilla horaria entra con columnas legibles? Si no, se usa la agenda por día (la misma de móvil). */
export function gridFitsWidth(areaWidthPx: number, dayCount: number): boolean {
  return areaWidthPx >= TIME_COLUMN_WIDTH_PX + MIN_DAY_COLUMN_WIDTH_PX * Math.max(1, dayCount);
}

/**
 * Presentación de una tarjeta según su tamaño REAL (alto del bloque visual y ancho de su carril):
 *  - `full`: título y datos (hora y estado), una línea cada uno;
 *  - `title`: sólo el título, en una línea, truncado con elipsis;
 *  - `block`: bloque de color sin texto visible (el nombre accesible y el tooltip siguen completos).
 * Nunca se agranda el bloque ni se mueve la clase para hacer entrar texto: el texto se adapta al bloque.
 */
export type CardPresentation = "full" | "title" | "block";
export const FULL_CARD_MIN_HEIGHT_PX = 46;
export const FULL_CARD_MIN_WIDTH_PX = 84;
export const TITLE_CARD_MIN_HEIGHT_PX = 20;
export const TITLE_CARD_MIN_WIDTH_PX = 44;

export function cardPresentation(input: { heightPx: number; widthPx: number }): CardPresentation {
  const { heightPx, widthPx } = input;
  if (!(heightPx >= TITLE_CARD_MIN_HEIGHT_PX) || !(widthPx >= TITLE_CARD_MIN_WIDTH_PX)) return "block";
  return heightPx >= FULL_CARD_MIN_HEIGHT_PX && widthPx >= FULL_CARD_MIN_WIDTH_PX ? "full" : "title";
}

export function currentTimeTop(now: Date, hourHeightPx: number = HOUR_HEIGHT_PX): number | null {
  const minutesOfDay = instantMinutesOfDay(now.toISOString());
  if (minutesOfDay < START_HOUR * 60 || minutesOfDay >= END_HOUR * 60) return null;
  return ((minutesOfDay - START_HOUR * 60) / 60) * hourHeightPx;
}
