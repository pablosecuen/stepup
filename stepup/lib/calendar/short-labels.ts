import { estimateBoldTextWidthPx, firstWord } from "./card-text.ts";
import type { PositionedItem } from "./layout.ts";

/**
 * PROPUESTA (entorno de revisión, no publicada): identificar las clases cortas sin texto diminuto, sin superposiciones y sin falsear su duración.
 *
 * Una clase de menos de `SHORT_BAR_MAX_HEIGHT_PX` de alto no tiene lugar para una línea de texto legible DENTRO de su bloque (a 50 px/h una de 15 minutos mide 10,5 px). Su bloque conserva la hora y la duración
 * EXACTAS (una barra) y su nombre, hora y estado van en un RÓTULO de 11 px en una columna a la derecha del día. Reglas:
 *  - una clase corta sola o seguida de otras (consecutivas): barra angosta y rótulo en su misma fila (desplazamiento mínimo);
 *  - un grupo de clases simultáneas con alguna corta: TODAS sus clases pasan a barra + rótulo, numeradas 1, 2, 3… en la barra y en el rótulo (la asociación no depende del color);
 *  - las clases largas fuera de esos grupos siguen siendo bloques con su nombre; los rótulos se acomodan para no tapar a ninguna (se mueven lo mínimo posible, hacia arriba o hacia abajo);
 *  - si no hay forma de acomodarlos sin tapar una clase larga, esa clase se angosta (se informa, nunca se oculta nada).
 * PURO: sólo geometría; la tarjeta y el rótulo los dibuja el componente.
 */
export const SHORT_BAR_MAX_HEIGHT_PX = 15;
export const LABEL_HEIGHT_PX = 13;
export const LABEL_FONT_PX = 11;
export const CHAIN_BAR_WIDTH_PX = 26;
export const SIMULTANEOUS_LANE_PX = 15;
export const LABEL_GAP_PX = 6;
const MAX_AREA_SHARE = 0.5;
/** Ancho que reserva el rótulo para que el nombre se lea (la hora, el estado y la primera palabra del nombre) y techo del ensanche de una columna del teléfono. */
export const LABEL_NEED_MAX_PX = 210;

export interface LabelSource {
  id: string;
  title: string;
  timeText: string;
  stateText: string | null;
}

export interface PlannedLabel {
  /** Posición del rótulo dentro de la columna del día (px). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** ¿Entra el nombre completo? Si no, se corta con «…» (siempre queda entera la primera palabra si `firstWordFits`). */
  fullNameFits: boolean;
  firstWordFits: boolean;
  /** Cuánto se movió el rótulo respecto del centro de su barra (px, + hacia abajo). */
  offsetPx: number;
}

export interface PlannedItem {
  id: string;
  /** Barra: posición y ancho dentro de la columna. */
  barLeft: number;
  barWidth: number;
  /** Número de asociación en un grupo de simultáneas (null en una clase sola o consecutiva). */
  number: number | null;
  label: PlannedLabel;
  /** Una clase larga que, por estar con simultáneas cortas, también pasó a barra + rótulo. */
  transformedLong: boolean;
}

export interface DayLabelPlan {
  areaPx: number;
  labelX: number;
  labelW: number;
  items: Map<string, PlannedItem>;
  /** Clases largas que no se pudieron dejar enteras sin tapar un rótulo: id → ancho al que se angostan. */
  narrowed: Map<string, number>;
}

/** Ancho que gasta un rótulo: borde y relleno (9 px), 4 px entre partes, el número de asociación (11 px) si lo lleva, la hora, el estado y el texto del nombre. */
const textWidth = (parts: { time: string; state: string | null; word: string; numbered: boolean }): number =>
  9 + (parts.numbered ? 15 : 0) + estimateBoldTextWidthPx(parts.time, LABEL_FONT_PX - 1) + 4 + (parts.state ? estimateBoldTextWidthPx(parts.state, LABEL_FONT_PX - 1) + 4 : 0) + estimateBoldTextWidthPx(parts.word, LABEL_FONT_PX);

interface Cluster {
  items: PositionedItem[];
  laneCount: number;
  hasShort: boolean;
}

function clustersOf(positioned: readonly PositionedItem[]): Cluster[] {
  const sorted = [...positioned].sort((a, b) => a.top - b.top || a.lane - b.lane);
  const clusters: Cluster[] = [];
  let bottom = -Infinity;
  for (const p of sorted) {
    if (clusters.length === 0 || p.top >= bottom - 0.001) {
      clusters.push({ items: [], laneCount: 1, hasShort: false });
      bottom = -Infinity;
    }
    const cluster = clusters[clusters.length - 1];
    cluster.items.push(p);
    cluster.laneCount = Math.max(cluster.laneCount, p.laneCount);
    cluster.hasShort = cluster.hasShort || p.height < SHORT_BAR_MAX_HEIGHT_PX;
    bottom = Math.max(bottom, p.top + p.height);
  }
  return clusters;
}

/** Ancho que necesita un día para que cada rótulo muestre hora, estado y al menos la primera palabra del nombre (para ensanchar la columna en el teléfono). 0 si el día no tiene clases cortas. */
export function shortLabelsNeedPx(positioned: readonly PositionedItem[], sources: ReadonlyMap<string, LabelSource>): number {
  const clusters = clustersOf(positioned).filter((c) => c.hasShort);
  if (clusters.length === 0) return 0;
  const area = Math.max(...clusters.map((c) => (c.laneCount > 1 ? c.laneCount * SIMULTANEOUS_LANE_PX : CHAIN_BAR_WIDTH_PX)));
  let widest = 0;
  for (const c of clusters) {
    for (const p of c.items) {
      if (c.laneCount === 1 && p.height >= SHORT_BAR_MAX_HEIGHT_PX) continue;
      const s = sources.get(p.item.id);
      if (s) widest = Math.max(widest, textWidth({ time: s.timeText, state: s.stateText, word: firstWord(s.title), numbered: c.laneCount > 1 }));
    }
  }
  // +12 px de margen: la estimación de ancho de las letras es aproximada y la primera palabra NUNCA debe quedar cortada.
  return Math.min(LABEL_NEED_MAX_PX, Math.ceil(area + LABEL_GAP_PX + widest + 12));
}

/**
 * Mejor posición vertical de los rótulos: en orden, sin pisarse entre sí (`height` de separación), sin tapar a las clases largas (`forbidden`: intervalos prohibidos para cada rótulo) y lo más cerca posible de su
 * lugar ideal (suma de desplazamientos mínima). Programación dinámica sobre medios píxeles. `null` si no hay forma.
 */
export function placeLabels(ideal: readonly number[], forbidden: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, height: number, maxY: number): number[] | null {
  const STEP = 0.5;
  const cells = Math.max(1, Math.floor(maxY / STEP) + 1);
  const sep = Math.ceil(height / STEP);
  const blocked = (i: number, y: number) => forbidden[i].some(([from, to]) => y < to - 0.001 && y + height > from + 0.001);
  const INF = 1e9;
  let prev: number[] | null = null;
  const back: number[][] = [];
  for (let i = 0; i < ideal.length; i++) {
    const cost = new Array<number>(cells).fill(INF);
    const from = new Array<number>(cells).fill(-1);
    // Mínimo acumulado del paso anterior hasta (c - sep).
    let best = INF;
    let bestAt = -1;
    for (let c = 0; c < cells; c++) {
      const y = c * STEP;
      if (prev !== null) {
        const p = c - sep;
        if (p >= 0 && prev[p] < best) {
          best = prev[p];
          bestAt = p;
        }
      } else {
        best = 0;
      }
      if (blocked(i, y) || best >= INF) continue;
      // A igual desplazamiento total se prefiere bajar un rótulo antes que subir otro (el orden natural de lectura).
      cost[c] = best + Math.abs(y - ideal[i]) + (y < ideal[i] ? 0.01 * (ideal[i] - y) : 0);
      from[c] = bestAt;
    }
    back.push(from);
    prev = cost;
  }
  if (prev === null) return [];
  let end = -1;
  let min = INF;
  for (let c = 0; c < cells; c++) if (prev[c] < min) {
    min = prev[c];
    end = c;
  }
  if (end < 0) return null;
  const out = new Array<number>(ideal.length);
  let c = end;
  for (let i = ideal.length - 1; i >= 0; i--) {
    out[i] = c * STEP;
    c = back[i][c];
  }
  return out;
}

/** Desplazamiento máximo tolerado de un rótulo respecto de su barra antes de convertir también a las clases largas que lo obligan a alejarse (px). */
export const MAX_LABEL_OFFSET_PX = 14;

export function planShortLabels(positioned: readonly PositionedItem[], sources: ReadonlyMap<string, LabelSource>, colWidthPx: number, gridHeightPx: number): DayLabelPlan | null {
  const clusters = clustersOf(positioned);
  const withLabels = clusters.filter((c) => c.hasShort);
  if (withLabels.length === 0) return null;

  const wantedArea = Math.max(...withLabels.map((c) => (c.laneCount > 1 ? c.laneCount * SIMULTANEOUS_LANE_PX : CHAIN_BAR_WIDTH_PX)));
  const areaPx = Math.min(wantedArea, Math.floor(colWidthPx * MAX_AREA_SHARE));
  const labelX = areaPx + LABEL_GAP_PX;
  const labelW = Math.max(20, colWidthPx - labelX - 2);
  const maxY = Math.max(0, gridHeightPx - LABEL_HEIGHT_PX);

  type Entry = { p: PositionedItem; cluster: Cluster; number: number | null; transformedLong: boolean; ideal: number };
  const clusterOf = new Map<string, Cluster>();
  for (const c of clusters) for (const p of c.items) clusterOf.set(p.item.id, c);

  // `extra`: clases largas (solas en su carril) que, para no obligar a un rótulo a alejarse de su barra, también pasan a barra + rótulo. Se agregan SÓLO si hace falta.
  const solve = (extra: ReadonlySet<string>) => {
    const entries: Entry[] = [];
    for (const cluster of withLabels) {
      const simultaneous = cluster.laneCount > 1;
      const members = simultaneous ? cluster.items : cluster.items.filter((p) => p.height < SHORT_BAR_MAX_HEIGHT_PX);
      const ordered = [...members].sort((a, b) => a.top - b.top || a.lane - b.lane);
      const barsTop = Math.min(...ordered.map((p) => p.top));
      const barsBottom = Math.max(...ordered.map((p) => p.top + p.height));
      ordered.forEach((p, index) => {
        // Una clase sola o consecutiva: el rótulo en su misma fila. Un grupo simultáneo: los rótulos centrados sobre el conjunto de sus barras.
        const ideal = simultaneous ? (barsTop + barsBottom) / 2 - (ordered.length * LABEL_HEIGHT_PX) / 2 + index * LABEL_HEIGHT_PX : p.top + p.height / 2 - LABEL_HEIGHT_PX / 2;
        entries.push({ p, cluster, number: simultaneous ? index + 1 : null, transformedLong: simultaneous && p.height >= SHORT_BAR_MAX_HEIGHT_PX, ideal });
      });
    }
    for (const p of positioned) {
      if (!extra.has(p.item.id) || entries.some((e) => e.p.item.id === p.item.id)) continue;
      entries.push({ p, cluster: clusterOf.get(p.item.id)!, number: null, transformedLong: true, ideal: p.top + p.height / 2 - LABEL_HEIGHT_PX / 2 });
    }
    entries.sort((a, b) => a.ideal - b.ideal || a.p.top - b.p.top);
    const labeledIds = new Set(entries.map((e) => e.p.item.id));
    const longBlocks = positioned.filter((p) => !labeledIds.has(p.item.id));
    const blocking = longBlocks.filter((p) => ((p.lane + 1) / p.laneCount) * colWidthPx > labelX);
    const obstacles = blocking.map((p) => [p.top, p.top + p.height] as const);
    const ideals = entries.map((e) => e.ideal);
    let ys = placeLabels(ideals, entries.map(() => obstacles), LABEL_HEIGHT_PX, maxY);
    const narrowed = new Map<string, number>();
    if (ys === null) {
      // Sin forma de acomodar los rótulos sin tapar una clase larga: se angostan las largas que estorban (se informa) y se vuelve a acomodar sin ellas.
      for (const p of blocking) narrowed.set(p.item.id, labelX - 3);
      ys = placeLabels(ideals, entries.map(() => []), LABEL_HEIGHT_PX, maxY) ?? ideals.map((y) => Math.min(Math.max(0, y), maxY));
    }
    return { entries, ys, narrowed, blocking };
  };

  const extra = new Set<string>();
  let solved = solve(extra);
  for (let round = 0; round < 6; round++) {
    // ¿Algún rótulo quedó lejos de su barra? Se convierten las clases largas que están en el camino (entre su lugar ideal y el que le tocó) y se vuelve a acomodar.
    const culprits = new Set<string>();
    solved.entries.forEach((e, i) => {
      const y = solved.ys[i];
      if (Math.abs(y - e.ideal) <= MAX_LABEL_OFFSET_PX) return;
      const from = Math.min(e.ideal, y);
      const to = Math.max(e.ideal, y) + LABEL_HEIGHT_PX;
      for (const p of solved.blocking) if (p.top < to && p.top + p.height > from && !extra.has(p.item.id)) culprits.add(p.item.id);
    });
    if (culprits.size === 0) break;
    culprits.forEach((id) => extra.add(id));
    solved = solve(extra);
  }

  const { entries, ys, narrowed } = solved;
  const items = new Map<string, PlannedItem>();
  entries.forEach((e, i) => {
    const s = sources.get(e.p.item.id);
    const word = s ? firstWord(s.title) : "";
    const wordNeed = s ? textWidth({ time: s.timeText, state: s.stateText, word, numbered: e.number !== null }) : 0;
    const fullNeed = s ? textWidth({ time: s.timeText, state: s.stateText, word: s.title, numbered: e.number !== null }) : 0;
    const laneW = e.cluster.laneCount > 1 ? areaPx / e.cluster.laneCount : areaPx;
    items.set(e.p.item.id, {
      id: e.p.item.id,
      barLeft: 1 + (e.cluster.laneCount > 1 ? e.p.lane * laneW : 0),
      barWidth: Math.max(4, laneW - 1),
      number: e.number,
      transformedLong: e.transformedLong,
      label: { x: labelX, y: ys[i], width: labelW, height: LABEL_HEIGHT_PX, fullNameFits: fullNeed <= labelW, firstWordFits: wordNeed <= labelW, offsetPx: ys[i] - e.ideal },
    });
  });
  return { areaPx, labelX, labelW, items, narrowed };
}
