import { estimateBoldTextWidthPx, initials } from "./card-text.ts";
import type { PositionedItem } from "./layout.ts";
import type { DayLabelPlan, LabelSource, MobileLabelText, PlannedItem } from "./short-labels.ts";

/**
 * Teléfono: dónde y cómo se escribe el nombre de cada clase con columnas de ancho fijo (cinco días iguales en Semana, un día completo en Día).
 *
 * Reglas (PURO: sólo geometría y texto; los componentes dibujan lo que se decide acá):
 *  - El bloque conserva la hora y la duración EXACTAS. Si el nombre entero (en palabras completas, sin partirlas por letras) entra dentro del bloque, se escribe dentro.
 *  - Si no entra, la clase pasa a barra exacta + rótulo al costado. El rótulo parte el nombre en palabras (hasta dos líneas) y puede ser más alto que la barra: su posición se
 *    acomoda sin tapar otras clases, nunca se agranda ni se mueve la barra.
 *  - Un grupo de clases simultáneas se numera en la barra y en el rótulo. Si el ancho no alcanza para el nombre se escribe la primera palabra, o las iniciales, o sólo el número;
 *    el nombre completo siempre queda en el nombre accesible, en el detalle y en la vista Día.
 *  - Todo texto recortado lleva «…»: nada se corta sin avisar.
 */
export interface MobileTextFit {
  lines: string[];
  fontPx: number;
  lineHeightPx: number;
}

export interface MobileCardText extends MobileTextFit {
  /** Estado importante («Cancel.», «Reprog.», «Reemp.») en su propia línea, nunca sólo por color. */
  state: string | null;
}

export interface MobileDayPlan {
  labelPlan: DayLabelPlan | null;
  /** Clases que escriben su nombre dentro del bloque, con el texto ya partido en líneas que entran. */
  cards: Map<string, MobileCardText>;
}

interface Profile {
  /** Tamaños de letra del nombre dentro del bloque, de mayor a menor (el primero que entra sin cortar ninguna palabra). */
  cardSizes: ReadonlyArray<{ fontPx: number; lineHeightPx: number }>;
  /** Relleno horizontal total del bloque (bordes + relleno) que no es texto. */
  cardChromePx: number;
  /** Tamaños de letra del rótulo, de mayor a menor: se baja de escalón sólo si la palabra más larga no entra (nunca por debajo de 10 px). */
  labelSizes: ReadonlyArray<{ fontPx: number; lineHeightPx: number }>;
  chainBarPx: number;
  laneBarPx: number;
  areaShare: number;
  maxLabelLines: number;
  /** Tope del ancho de un bloque con un solo carril (Día: las tarjetas no ocupan todo el ancho). */
  maxCardWidthPx: number;
}

const WEEK: Profile = { cardSizes: [{ fontPx: 12, lineHeightPx: 13 }, { fontPx: 11, lineHeightPx: 12 }], cardChromePx: 6, labelSizes: [{ fontPx: 11, lineHeightPx: 12 }, { fontPx: 10, lineHeightPx: 11 }], chainBarPx: 6, laneBarPx: 8, areaShare: 0.5, maxLabelLines: 3, maxCardWidthPx: Infinity };
const DAY: Profile = { cardSizes: [{ fontPx: 16, lineHeightPx: 19 }], cardChromePx: 18, labelSizes: [{ fontPx: 14, lineHeightPx: 16 }], chainBarPx: 14, laneBarPx: 14, areaShare: 0.45, maxLabelLines: 2, maxCardWidthPx: 244 };

/** La estimación de ancho es aproximada: se deja un margen para que una palabra que «entra» no se corte en pantalla. */
const MARGIN = 1.05;
const widthOf = (text: string, fontPx: number) => estimateBoldTextWidthPx(text, fontPx) * MARGIN;
/** Rótulo del teléfono: borde 2 px + relleno 3 px + 1 px a la derecha; el número de asociación mide 10 px más 2 px de separación. */
const GAP_PX = 3;
const LABEL_CHROME_PX = 6;
const CHIP_PX = 12;
const ELLIPSIS = "…";

const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter((word) => word !== "");

/** Recorta una palabra con «…» hasta que entre. */
function ellipsize(text: string, widthPx: number, fontPx: number): string {
  const characters = Array.from(text);
  while (characters.length > 1 && widthOf(characters.join("") + ELLIPSIS, fontPx) > widthPx) characters.pop();
  return characters.join("") + ELLIPSIS;
}

/** Parte `text` en líneas de palabras completas. Una palabra más ancha que la línea se recorta con «…» (nunca por letras); si sobran líneas, la última termina en «…». */
export function wrapWords(text: string, widthPx: number, fontPx: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  let current = "";
  for (const word of wordsOf(text)) {
    if (widthOf(word, fontPx) > widthPx) {
      if (current) lines.push(current);
      lines.push(ellipsize(word, widthPx, fontPx));
      truncated = true;
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (widthOf(candidate, fontPx) <= widthPx) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(" ");
    lines.length = maxLines - 1;
    lines.push(ellipsize(rest, widthPx, fontPx));
    truncated = true;
  }
  return { lines, truncated };
}

/** ¿Entra el nombre entero (y el estado, si lo hay) dentro de un bloque de ese tamaño, sin cortar nada? */
export function fitCardText(title: string, stateText: string | null, widthPx: number, heightPx: number, sizes: Profile["cardSizes"]): MobileCardText | null {
  for (const { fontPx, lineHeightPx } of sizes) {
    const maxLines = Math.floor((heightPx - 2) / lineHeightPx) - (stateText ? 1 : 0);
    if (maxLines < 1 || (stateText && widthOf(stateText, fontPx - 1) > widthPx)) continue;
    const wrapped = wrapWords(title, widthPx, fontPx, maxLines);
    if (!wrapped.truncated) return { state: stateText, lines: wrapped.lines, fontPx, lineHeightPx };
  }
  return null;
}

interface Cluster {
  items: PositionedItem[];
  laneCount: number;
}

function clustersOf(positioned: readonly PositionedItem[]): Cluster[] {
  const sorted = [...positioned].sort((a, b) => a.top - b.top || a.lane - b.lane);
  const clusters: Cluster[] = [];
  let bottom = -Infinity;
  for (const p of sorted) {
    if (clusters.length === 0 || p.top >= bottom - 0.001) {
      clusters.push({ items: [], laneCount: 1 });
      bottom = -Infinity;
    }
    const cluster = clusters[clusters.length - 1];
    cluster.items.push(p);
    cluster.laneCount = Math.max(cluster.laneCount, p.laneCount);
    bottom = Math.max(bottom, p.top + p.height);
  }
  return clusters;
}

/**
 * Mejor posición vertical de los rótulos (cada uno con SU alto): en orden, sin pisarse, sin tapar los intervalos prohibidos y lo más cerca posible de su lugar ideal. Programación dinámica
 * sobre medios píxeles. `null` si no hay forma.
 */
export function placeVariableLabels(ideal: readonly number[], heights: readonly number[], forbidden: ReadonlyArray<readonly (readonly [number, number])[]>, gridHeightPx: number): number[] | null {
  const STEP = 0.5;
  const cells = Math.max(1, Math.floor(gridHeightPx / STEP) + 1);
  const INF = 1e9;
  const blocked = (i: number, y: number) => forbidden[i].some(([from, to]) => y < to - 0.001 && y + heights[i] > from + 0.001);
  let previous: number[] | null = null;
  const back: number[][] = [];
  for (let i = 0; i < ideal.length; i++) {
    const cost = new Array<number>(cells).fill(INF);
    const from = new Array<number>(cells).fill(-1);
    const separation = i === 0 ? 0 : Math.ceil(heights[i - 1] / STEP);
    // Mínimo acumulado del paso anterior hasta (c - separation).
    let best = INF;
    let bestAt = -1;
    for (let c = 0; c < cells; c++) {
      const y = c * STEP;
      if (previous !== null) {
        const p = c - separation;
        if (p >= 0 && previous[p] < best) {
          best = previous[p];
          bestAt = p;
        }
      } else best = 0;
      if (y + heights[i] > gridHeightPx + 0.001 || blocked(i, y) || best >= INF) continue;
      cost[c] = best + Math.abs(y - ideal[i]) + (y < ideal[i] ? 0.01 * (ideal[i] - y) : 0);
      from[c] = bestAt;
    }
    back.push(from);
    previous = cost;
  }
  if (previous === null) return [];
  let end = -1;
  let min = INF;
  for (let c = 0; c < cells; c++) if (previous[c] < min) {
    min = previous[c];
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

function labelTextFor(source: LabelSource, textWidthPx: number, numbered: boolean, profile: Profile): MobileLabelText {
  const { maxLabelLines } = profile;
  const available = textWidthPx - (numbered ? CHIP_PX : 0);
  const first = wordsOf(source.title)[0] ?? source.title;
  // Primero el escalón más grande en el que la palabra más larga del nombre entra entera: el nombre se parte en palabras, nunca por letras.
  const longest = wordsOf(source.title).reduce((best, word) => (widthOf(word, profile.labelSizes[0].fontPx) > widthOf(best, profile.labelSizes[0].fontPx) ? word : best), first);
  const size = profile.labelSizes.find(({ fontPx }) => widthOf(longest, fontPx) <= available) ?? profile.labelSizes.find(({ fontPx }) => widthOf(first, fontPx) <= available) ?? profile.labelSizes[profile.labelSizes.length - 1];
  const { fontPx: font, lineHeightPx: lineHeight } = size;
  const state = source.stateText && widthOf(source.stateText, font - 1) <= textWidthPx - (numbered ? CHIP_PX : 0) ? source.stateText : null;
  let lines: string[];
  let abbreviated = false;
  if (widthOf(first, font) <= available) lines = wrapWords(source.title, available, font, maxLabelLines).lines;
  else if (!numbered) lines = [ellipsize(first, Math.max(available, 12), font)];
  else {
    // Grupo simultáneo sin ancho para el nombre (límite físico, ver docs): el comienzo de la primera palabra con «…» si quedan al menos tres letras, si no las iniciales («FT») o sólo el número.
    // El nombre completo queda en el detalle y en la vista Día; es un caso abierto que se informa, no una solución.
    const prefix = available > 0 ? ellipsize(first, available, font) : "";
    const short = initials(source.title);
    if (Array.from(prefix).length - 1 >= 3 && widthOf(prefix, font) <= available) lines = [prefix];
    else if (short && widthOf(short, font) <= available) {
      lines = [short];
      abbreviated = true;
    } else lines = [];
  }
  return { state, lines, fontPx: font, lineHeightPx: lineHeight, abbreviated };
}

/** Sólo iniciales (o el número, si ni así entran) con la misma letra y estado que el texto original. */
function initialsText(source: LabelSource, textWidthPx: number, like: MobileLabelText): MobileLabelText {
  const short = initials(source.title);
  const fits = short !== "" && widthOf(short, like.fontPx) <= textWidthPx - CHIP_PX;
  return { ...like, lines: fits ? [short] : [], abbreviated: fits };
}

export function planMobileDay(positioned: readonly PositionedItem[], sources: ReadonlyMap<string, LabelSource>, colWidthPx: number, gridHeightPx: number, dayView: boolean): MobileDayPlan {
  const profile = dayView ? DAY : WEEK;
  const cards = new Map<string, MobileCardText>();
  const fits = new Map<string, MobileCardText | null>();
  for (const p of positioned) {
    const cardWidth = Math.min(colWidthPx / p.laneCount - 4, p.laneCount === 1 ? profile.maxCardWidthPx : Infinity);
    fits.set(p.item.id, fitCardText(sources.get(p.item.id)?.title ?? "", sources.get(p.item.id)?.stateText ?? null, cardWidth - profile.cardChromePx, p.height, profile.cardSizes));
  }

  // Quiénes pasan a barra + rótulo: la clase que no entra en su bloque; en un grupo simultáneo, todas (así la numeración las asocia).
  const labeled: Array<{ p: PositionedItem; cluster: Cluster }> = [];
  const clusters = clustersOf(positioned);
  for (const cluster of clusters) {
    const needsLabel = cluster.items.some((p) => fits.get(p.item.id) === null);
    for (const p of cluster.items) {
      if (cluster.laneCount > 1 ? needsLabel : fits.get(p.item.id) === null) labeled.push({ p, cluster });
      else cards.set(p.item.id, fits.get(p.item.id)!);
    }
  }
  if (labeled.length === 0) return { labelPlan: null, cards };

  // Cada grupo tiene SU geometría: un grupo de tres simultáneas en el día no le quita ancho al rótulo de una clase sola o de un grupo de dos.
  const geometryOf = (simultaneous: boolean, laneCount: number) => {
    const areaPx = Math.min(simultaneous ? laneCount * profile.laneBarPx : profile.chainBarPx, Math.floor(colWidthPx * profile.areaShare));
    const labelX = areaPx + GAP_PX;
    const labelW = Math.max(20, colWidthPx - labelX - 1);
    return { areaPx, labelX, labelW, textW: labelW - LABEL_CHROME_PX };
  };

  type Entry = { p: PositionedItem; cluster: Cluster; number: number | null; text: MobileLabelText; height: number; ideal: number; areaPx: number; labelX: number; labelW: number };
  // `extra`: clases que sí entraban en su bloque pero estorban a un rótulo (no hay forma de acomodarlo sin taparlas): pasan también a barra + rótulo. Sólo se agregan si hace falta; nunca se oculta ni se tapa una clase.
  const solve = (extra: ReadonlySet<string>) => {
    const entries: Entry[] = [];
    for (const cluster of clusters) {
      const members = labeled.filter((entry) => entry.cluster === cluster).map((entry) => entry.p);
      const standalone = cluster.laneCount === 1 ? cluster.items.filter((p) => extra.has(p.item.id) && !members.includes(p)) : [];
      const group = [...members, ...standalone];
      if (group.length === 0) continue;
      const simultaneous = cluster.laneCount > 1;
      const geometry = geometryOf(simultaneous, cluster.laneCount);
      const ordered = [...group].sort((a, b) => a.top - b.top || a.lane - b.lane);
      const texts = ordered.map((p) => labelTextFor(sources.get(p.item.id)!, geometry.textW, simultaneous, profile));
      // Un grupo se lee parejo: si alguno sólo puede mostrar iniciales (o el número), los que no entran enteros también las muestran; los que sí entran completos conservan su nombre.
      if (simultaneous && texts.some((text) => text.abbreviated || text.lines.length === 0)) {
        texts.forEach((text, i) => {
          if (text.lines.some((line) => line.endsWith(ELLIPSIS))) texts[i] = initialsText(sources.get(ordered[i].item.id)!, geometry.textW, text);
        });
      }
      const sized = ordered.map((p, index) => {
        const text = texts[index];
        const lines = Math.max(1, text.lines.length + (text.state ? 1 : 0));
        return { p, text, height: lines * text.lineHeightPx + 1, index };
      });
      const barsTop = Math.min(...ordered.map((p) => p.top));
      const barsBottom = Math.max(...ordered.map((p) => p.top + p.height));
      let stackY = (barsTop + barsBottom) / 2 - sized.reduce((sum, entry) => sum + entry.height, 0) / 2;
      for (const entry of sized) {
        // Una clase sola o consecutiva: el rótulo centrado en su barra. Un grupo simultáneo: los rótulos apilados y centrados sobre el conjunto de sus barras.
        const ideal = simultaneous ? stackY : entry.p.top + entry.p.height / 2 - entry.height / 2;
        stackY += entry.height;
        entries.push({ p: entry.p, cluster, number: simultaneous ? entry.index + 1 : null, text: entry.text, height: entry.height, ideal: Math.max(0, ideal), areaPx: geometry.areaPx, labelX: geometry.labelX, labelW: geometry.labelW });
      }
    }
    entries.sort((a, b) => a.ideal - b.ideal || a.p.top - b.p.top);
    const labeledIds = new Set(entries.map((entry) => entry.p.item.id));
    // Lo que estorba a un rótulo depende de dónde empieza ESE rótulo (su propia columna de texto).
    const blockersOf = (labelX: number) => positioned.filter((p) => !labeledIds.has(p.item.id) && ((p.lane + 1) / p.laneCount) * colWidthPx > labelX);
    const blocking = [...new Set(entries.flatMap((entry) => blockersOf(entry.labelX)))];
    const ideals = entries.map((entry) => entry.ideal);
    const heights = entries.map((entry) => entry.height);
    const forbidden = entries.map((entry) => blockersOf(entry.labelX).map((p) => [p.top, p.top + p.height] as const));
    return { entries, blocking, ys: placeVariableLabels(ideals, heights, forbidden, gridHeightPx), ideals, heights };
  };

  const extra = new Set<string>();
  let solved = solve(extra);
  for (let round = 0; round < 4 && solved.ys === null && solved.blocking.length > 0; round++) {
    solved.blocking.forEach((p) => extra.add(p.item.id));
    solved = solve(extra);
  }
  const { entries, ideals, heights } = solved;
  const ys = solved.ys ?? ideals.map((y, i) => Math.min(Math.max(0, y), gridHeightPx - heights[i]));
  for (const entry of entries) cards.delete(entry.p.item.id);

  const narrowed = new Map<string, number>();
  const items = new Map<string, PlannedItem>();
  entries.forEach((entry, i) => {
    const laneW = entry.cluster.laneCount > 1 ? entry.areaPx / entry.cluster.laneCount : entry.areaPx;
    items.set(entry.p.item.id, {
      id: entry.p.item.id,
      barLeft: 1 + (entry.cluster.laneCount > 1 ? entry.p.lane * laneW : 0),
      barWidth: Math.max(4, laneW - 1),
      number: entry.number,
      transformedLong: entry.cluster.laneCount > 1 && fits.get(entry.p.item.id) !== null || extra.has(entry.p.item.id),
      label: { x: entry.labelX, y: ys[i], width: entry.labelW, height: entry.height, fullNameFits: !entry.text.abbreviated && !entry.text.lines.some((line) => line.endsWith(ELLIPSIS)) && entry.text.lines.length > 0, firstWordFits: !entry.text.abbreviated && entry.text.lines.length > 0, offsetPx: ys[i] - entry.ideal, text: entry.text },
    });
  });
  const widest = entries.reduce((best, entry) => (entry.areaPx > best.areaPx ? entry : best), entries[0]);
  return { labelPlan: { areaPx: widest.areaPx, labelX: widest.labelX, labelW: widest.labelW, items, narrowed }, cards };
}
