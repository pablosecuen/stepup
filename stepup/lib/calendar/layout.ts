import type { CalendarViewItem } from "./occurrences";
import { instantDateKey, instantMinutesOfDay } from "./civil-calendar.ts";

/**
 * Geometría pura de la grilla — puerto genérico de `lib/calendar-layout.ts`
 * (Fase A, sólo fixtures) para datos REALES (`CalendarViewItem[]`). Semana
 * lunes→domingo, eje 08:00–22:00.
 *
 * Posición y alto del BLOQUE VISUAL son exactos: `top` sale de la hora de inicio y
 * `height` de la duración real (menos una separación fija: 2 px en «Compacta», donde cada
 * píxel cuenta, 6 px en las escalas más altas). La ZONA INTERACTIVA (`hitTop`/`hitHeight`)
 * mide al menos 44 px de alto SIEMPRE QUE HAYA LUGAR: se extiende hacia abajo hasta donde
 * empieza la próxima clase que comparte esa franja del día — nunca la pisa — y, si no hay
 * lugar (clases cortas y consecutivas), coincide con el propio bloque.
 *
 * Los CARRILES paralelos se forman sólo por clases que de verdad se superponen en el
 * tiempo (mismo horario o solapadas): orden estable por inicio, fin e id; cada una toma el
 * primer carril libre y todas las de un mismo grupo comparten el ancho (`laneCount`). Las
 * clases CONSECUTIVAS (una termina cuando empieza la otra) comparten carril y ancho completo:
 * antes se repartían en carriles sólo para que sus zonas de 44 px no se tocaran, y eso las
 * hacía angostas y escalonadas sin que se superpusieran. Así ninguna clase queda tapada y
 * ninguna zona de toque pisa a otra.
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
/** Alto táctil que se busca para cada clase; se alcanza siempre que no pise a la clase de al lado (ver `layoutDayItems`). */
export const MIN_TARGET_PX = 44;
const CARD_GAP_PX = 6;
/** Separación entre bloques consecutivos en «Compacta» (menos de `COMPACT_GAP_BELOW_HOUR_HEIGHT_PX` por hora): el borde ya los separa y cada píxel de alto sirve para leer. */
const COMPACT_CARD_GAP_PX = 2;
const COMPACT_GAP_BELOW_HOUR_HEIGHT_PX = 56;

/** Separación vertical entre bloques para un alto por hora dado. */
export function cardGapPx(hourHeightPx: number): number {
  return hourHeightPx < COMPACT_GAP_BELOW_HOUR_HEIGHT_PX ? COMPACT_CARD_GAP_PX : CARD_GAP_PX;
}
/** Sólo evita un bloque invisible para duraciones absurdas; cualquier clase real (≥ 5 min) usa su alto exacto. */
const MIN_VISUAL_HEIGHT_PX = 4;
/** Una línea de texto (11 px de letra, interlineado 13) y el borde de 1 px: el alto mínimo con el que una clase de 30 minutos o más conserva su nombre. */
export const MIN_TEXT_HEIGHT_PX = 15;

export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
export const WEEKDAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

export interface PositionedItem {
  item: CalendarViewItem;
  /** Posición del bloque visual (exacta, en px desde las 08:00). */
  top: number;
  /** Alto del bloque visual (duración exacta menos la separación). */
  height: number;
  /** Zona interactiva: 44 px de alto o más cuando hay lugar; nunca menor que el bloque ni encima de otra clase. */
  hitTop: number;
  hitHeight: number;
  /** Desplazamiento del bloque visual dentro de la zona interactiva (la zona nace en el bloque: hoy siempre 0). */
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
 * Posiciona TODAS las clases de un día — ninguna se oculta ni se descarta. Sólo las que se superponen en el tiempo (mismo inicio o
 * solapadas) se reparten en carriles; las consecutivas comparten carril y ancho completo.
 */
export function layoutDayItems(items: CalendarViewItem[], hourHeightPx: number = HOUR_HEIGHT_PX): PositionedItem[] {
  const gridBottomPx = (END_HOUR - START_HOUR) * hourHeightPx;
  const gapPx = cardGapPx(hourHeightPx);

  const sorted = items
    .map((item) => ({ item, startMs: new Date(item.start).getTime(), endMs: new Date(item.end).getTime() }))
    .sort(compareItems);

  const boxes = sorted.map(({ item, startMs, endMs }) => {
    const top = Math.max(0, (minutesFromDayStart(item.start) / 60) * hourHeightPx);
    const durationPx = ((endMs - startMs) / 3_600_000) * hourHeightPx;
    // Alto exacto de la duración (menos la separación). Una clase de 30 minutos o más nunca baja del alto de UNA línea de texto: con la escala
    // más ajustada (ventanas bajas, zoom) 30 minutos medirían menos que eso y la clase quedaría sin nombre; la hora de inicio sigue siendo exacta.
    const exactHeight = Math.max(MIN_VISUAL_HEIGHT_PX, Math.min(durationPx - gapPx, gridBottomPx - top));
    const height = endMs - startMs >= 30 * 60_000 ? Math.max(MIN_TEXT_HEIGHT_PX, exactHeight) : exactHeight;
    const displayTop = Math.max(0, Math.min(top, gridBottomPx - height));
    // `laneBottom`: hasta dónde llega la clase en el tiempo (el bloque real, sin el piso de lectura): dos clases consecutivas nunca se reparten carriles por ese píxel de más.
    return { item, top, height, displayTop, laneBottom: displayTop + exactHeight, hitTop: displayTop, hitHeight: height, blockOffset: 0, lane: 0, laneCount: 1 };
  });

  // Carriles por grupos de BLOQUES que se superponen. El recorrido es por inicio creciente (el orden de `sorted` lo conserva).
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  let groupStart = 0;
  const closeGroup = (end: number) => {
    for (let k = groupStart; k < end; k++) boxes[k].laneCount = laneEnds.length;
  };
  boxes.forEach((box, index) => {
    if (box.displayTop >= groupEnd) {
      closeGroup(index);
      laneEnds = [];
      groupStart = index;
    }
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= box.displayTop);
    box.lane = free === -1 ? laneEnds.length : free;
    laneEnds[box.lane] = box.laneBottom;
    groupEnd = Math.max(groupEnd, laneEnds[box.lane]);
  });
  closeGroup(boxes.length);

  // Zona interactiva: 44 px de alto cuando hay lugar, nunca encima de otra clase que ocupe esa misma franja horizontal y empiece después.
  for (const box of boxes) {
    const left = box.lane / box.laneCount;
    const right = (box.lane + 1) / box.laneCount;
    let limit = gridBottomPx;
    for (const other of boxes) {
      if (other === box || other.displayTop < box.laneBottom - 0.001) continue;
      const otherLeft = other.lane / other.laneCount;
      const otherRight = (other.lane + 1) / other.laneCount;
      if (left < otherRight - 1e-9 && otherLeft < right - 1e-9) limit = Math.min(limit, other.displayTop);
    }
    // Nunca pasa de donde empieza la clase de al lado (aunque eso deje la zona un píxel más baja que el bloque dibujado con el piso de lectura).
    box.hitHeight = Math.min(Math.max(box.height, MIN_TARGET_PX), limit - box.displayTop);
  }

  return boxes.map(({ displayTop: _displayTop, laneBottom: _laneBottom, ...positioned }) => positioned);
}

/**
 * Los carriles NUNCA ensanchan la columna del día: cada uno divide el ancho disponible. Lo que sí cambia es cuánto texto entra en
 * la tarjeta (`cardPresentation`): si no cabe, pasa a un modo más compacto en vez de ensanchar la grilla o desbordar.
 */
export function cardInsetPx(laneCount: number, tight = false): number {
  // `tight` (teléfono): la columna ya mide ~50 px, así que el margen se reduce a 1 px para que el nombre tenga todo el ancho posible.
  if (tight) return laneCount <= 2 ? 1 : 0.5;
  return laneCount === 1 ? 4 : laneCount === 2 ? 2 : 1;
}

/** Ancho real de una tarjeta: su carril dentro de la columna, menos el margen a cada lado. */
export function cardWidthPx(columnWidthPx: number, laneCount: number, tight = false): number {
  return Math.max(0, columnWidthPx / Math.max(1, laneCount) - cardInsetPx(laneCount, tight) * 2);
}

/** Ancho de la columna de horas en el teléfono: 34 px (48 px en escritorio; la app original usa 38 y sólo muestra la hora). */
export const MOBILE_TIME_COLUMN_WIDTH_PX = 34;

/** Ancho de la columna de un día según el ancho útil de la zona de agenda (sin la columna de horas ni los bordes de las columnas). */
export function dayColumnWidthPx(areaWidthPx: number, dayCount: number, timeColumnPx: number = TIME_COLUMN_WIDTH_PX, frame = 3): number {
  const borders = frame + dayCount; // marco de la zona + borde izquierdo de cada día
  return Math.max(0, (areaWidthPx - timeColumnPx - borders) / Math.max(1, dayCount));
}

/**
 * Semana en el teléfono: un día con clases a la misma hora ensancha SU columna lo necesario para que cada carril muestre el nombre en texto horizontal y sin cortes (el resto de los días
 * conserva su ancho y la grilla se desplaza hacia los costados si la suma pasa del ancho de la pantalla). Nunca se gira el texto, nunca se corta una palabra y nunca se oculta una clase:
 * el alto, la hora y los carriles siguen siendo exactos. `needPx` es el ancho mínimo de la columna de cada día (cero si no necesita más que el común).
 */
export const MOBILE_MAX_DAY_COLUMN_PX = 300;

export interface MobileWeekColumns {
  /** Ancho de cada columna de día INCLUIDO su borde izquierdo (px). */
  trackPx: number[];
  /** Ancho total de la grilla (columna de horas + días). */
  totalPx: number;
  /** ¿Algún día pasa del ancho común (la grilla se desplaza hacia los costados)? */
  expanded: boolean;
}

export function mobileWeekColumns(input: { areaWidthPx: number; timeColumnPx: number; needPx: readonly number[] }): MobileWeekColumns {
  const dayCount = Math.max(1, input.needPx.length);
  const commonPx = dayColumnWidthPx(input.areaWidthPx, dayCount, input.timeColumnPx, 0) + 1;
  const trackPx = input.needPx.map((need) => Math.max(commonPx, Math.min(MOBILE_MAX_DAY_COLUMN_PX, need + 1)));
  const daysPx = trackPx.reduce((sum, width) => sum + width, 0);
  const expanded = daysPx > commonPx * dayCount + 0.5;
  return { trackPx, totalPx: input.timeColumnPx + daysPx, expanded };
}

/** ¿La grilla horaria entra con columnas legibles? Si no, se usa la agenda por día (la misma de móvil). */
export function gridFitsWidth(areaWidthPx: number, dayCount: number): boolean {
  return areaWidthPx >= TIME_COLUMN_WIDTH_PX + MIN_DAY_COLUMN_WIDTH_PX * Math.max(1, dayCount);
}

/**
 * Presentación de una tarjeta según su tamaño REAL (alto del bloque visual y ancho de su carril):
 *  - `full`: nombre y datos (hora, quiénes si es un grupo, estado), una línea cada uno;
 *  - `stack`: dos líneas en una tarjeta angosta pero alta — nombre (primera palabra o iniciales) y, debajo, el estado o la hora;
 *  - `title`: UNA línea («09:00 Nombre» si entra la hora; si no, el nombre), truncada con elipsis — las clases cortas;
 *  - `block`: bloque de color sin texto (sólo clases de ~15 minutos o carriles de menos de 28 px); el nombre accesible y el tooltip siguen completos.
 * Nunca se agranda el bloque ni se mueve la clase para hacer entrar texto: el texto se adapta al bloque. Los alturas mínimas salen de las líneas reales
 * (11–12 px de letra, interlineado 13–14 px) más el borde: ver `card-presentation.test.ts`.
 */
export type CardPresentation = "full" | "stack" | "title" | "vertical" | "block";
export const FULL_CARD_MIN_HEIGHT_PX = 32;
export const FULL_CARD_MIN_WIDTH_PX = 84;
export const STACK_CARD_MIN_HEIGHT_PX = 27;
/** Debajo de este ancho no entra la segunda línea (la hora): queda una sola línea con las iniciales. */
export const STACK_CARD_MIN_WIDTH_PX = 30;
export const TITLE_CARD_MIN_HEIGHT_PX = 15;
export const TITLE_CARD_MIN_WIDTH_PX = 22;
/**
 * `vertical`: en un carril muy angosto de escritorio (11–22 px) la primera palabra del nombre se escribe girada, de arriba hacia abajo, a lo largo del bloque — una línea de 10 px de
 * letra necesita ≥ 11 px de ancho y el bloque ≥ 30 px de alto. Por debajo de eso sólo queda el bloque de color.
 */
export const VERTICAL_CARD_MIN_WIDTH_PX = 11;
export const VERTICAL_CARD_MIN_HEIGHT_PX = 30;

/** El texto girado sólo existe en escritorio, en carriles de menos de 22 px, donde el puntero ya muestra todo en el cuadro de información; el teléfono ensancha la columna en vez de girar el nombre (`mobileWeekColumns`). */
export function cardPresentation(input: { heightPx: number; widthPx: number }): CardPresentation {
  const { heightPx, widthPx } = input;
  if (heightPx >= VERTICAL_CARD_MIN_HEIGHT_PX && widthPx >= VERTICAL_CARD_MIN_WIDTH_PX && widthPx < TITLE_CARD_MIN_WIDTH_PX) return "vertical";
  if (!(heightPx >= TITLE_CARD_MIN_HEIGHT_PX) || !(widthPx >= TITLE_CARD_MIN_WIDTH_PX)) return "block";
  if (heightPx >= FULL_CARD_MIN_HEIGHT_PX && widthPx >= FULL_CARD_MIN_WIDTH_PX) return "full";
  return heightPx >= STACK_CARD_MIN_HEIGHT_PX && widthPx >= STACK_CARD_MIN_WIDTH_PX ? "stack" : "title";
}

export function currentTimeTop(now: Date, hourHeightPx: number = HOUR_HEIGHT_PX): number | null {
  const minutesOfDay = instantMinutesOfDay(now.toISOString());
  if (minutesOfDay < START_HOUR * 60 || minutesOfDay >= END_HOUR * 60) return null;
  return ((minutesOfDay - START_HOUR * 60) / 60) * hourHeightPx;
}
