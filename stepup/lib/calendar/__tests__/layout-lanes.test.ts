import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CalendarViewItem } from "../occurrences";
import { END_HOUR, HOUR_HEIGHT_PX, LANE_MIN_WIDTH_PX, MIN_TARGET_PX, START_HOUR, dayColumnMinWidth, layoutDayItems, type PositionedItem } from "../layout.ts";

/**
 * Bloque 4 (corrección): grilla de escritorio con carriles. Ninguna clase queda tapada, el bloque visual conserva la hora y la
 * duración reales y la zona interactiva nunca mide menos de 44 px ni pisa a otra del mismo carril.
 */
const DAY = "2026-10-14"; // miércoles; BA = UTC-3
const GRID_BOTTOM = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

function at(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString();
}
function lesson(id: string, from: string, minutes: number): CalendarViewItem {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
}
const layout = (items: CalendarViewItem[]) => layoutDayItems(items);
const byId = (positioned: PositionedItem[], id: string) => positioned.find((p) => p.item.id === id)!;
const px = (minutes: number) => (minutes / 60) * HOUR_HEIGHT_PX;

/** Las zonas interactivas de dos clases nunca se pisan: o están en carriles distintos o una termina antes de que empiece la otra. */
function assertNoHitCollisions(positioned: PositionedItem[]): void {
  for (let i = 0; i < positioned.length; i++) {
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i];
      const b = positioned[j];
      const verticalOverlap = a.hitTop < b.hitTop + b.hitHeight && b.hitTop < a.hitTop + a.hitHeight;
      // Dos zonas que se tocan en altura sólo pueden convivir en carriles distintos (y entonces no se pisan en horizontal).
      if (verticalOverlap) assert.notEqual(a.lane, b.lane, `${a.item.id} y ${b.item.id} se pisan`);
    }
  }
}

function assertTargets(positioned: PositionedItem[]): void {
  for (const p of positioned) {
    assert.ok(p.hitHeight >= MIN_TARGET_PX, `${p.item.id}: zona de ${p.hitHeight} px`);
    assert.ok(p.hitTop >= 0 && p.hitTop + p.hitHeight <= GRID_BOTTOM + 0.001, `${p.item.id}: dentro de la grilla`);
    assert.ok(p.lane >= 0 && p.lane < p.laneCount, `${p.item.id}: carril válido`);
    assert.ok(p.blockOffset >= 0 && p.blockOffset + p.height <= p.hitHeight + 0.001, `${p.item.id}: el bloque cabe en su zona`);
  }
  assertNoHitCollisions(positioned);
}

test("dos clases con el mismo inicio y el mismo final: las dos visibles, lado a lado, con el mismo alto exacto", () => {
  const out = layout([lesson("b", "10:00", 60), lesson("a", "10:00", 60)]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => [p.item.id, p.lane, p.laneCount]), [["a", 0, 2], ["b", 1, 2]], "desempata por id");
  assert.equal(out[0].top, px(120));
  assert.equal(out[0].height, out[1].height);
  assert.equal(out[0].height, px(60) - 6, "la duración se ve exacta");
  assertTargets(out);
});

test("dos clases parcialmente superpuestas: ninguna se esconde y cada una conserva su hora y su duración", () => {
  const out = layout([lesson("tarde", "10:30", 60), lesson("temprano", "10:00", 60)]);
  assert.deepEqual(out.map((p) => [p.item.id, p.lane, p.laneCount]), [["temprano", 0, 2], ["tarde", 1, 2]]);
  assert.equal(byId(out, "temprano").top, px(120));
  assert.equal(byId(out, "tarde").top, px(150));
  assert.equal(byId(out, "tarde").height, px(60) - 6);
  assertTargets(out);
});

test("tres clases superpuestas: tres carriles; una cuarta posterior que no toca a las anteriores vuelve al ancho completo", () => {
  const out = layout([lesson("c", "10:20", 60), lesson("a", "10:00", 90), lesson("b", "10:10", 60), lesson("d", "13:00", 60)]);
  assert.deepEqual(out.map((p) => [p.item.id, p.lane, p.laneCount]), [["a", 0, 3], ["b", 1, 3], ["c", 2, 3], ["d", 0, 1]]);
  assertTargets(out);
  assert.equal(dayColumnMinWidth(out), 3 * LANE_MIN_WIDTH_PX, "con tres carriles la columna se ensancha para que cada uno conserve su ancho");
});

test("cuatro o más superpuestas: todas visibles, un carril cada una", () => {
  const out = layout(["a", "b", "c", "d", "e"].map((id) => lesson(id, "09:00", 60)));
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((p) => p.lane), [0, 1, 2, 3, 4]);
  assert.ok(out.every((p) => p.laneCount === 5));
  assert.equal(dayColumnMinWidth(out), 5 * LANE_MIN_WIDTH_PX);
});

test("clases consecutivas que no se superponen: un solo carril, ancho completo", () => {
  const out = layout([lesson("a", "09:00", 60), lesson("b", "10:00", 60), lesson("c", "11:00", 45)]);
  assert.ok(out.every((p) => p.lane === 0 && p.laneCount === 1));
  assertTargets(out);
});

test("duraciones de 15, 30, 45 y 60 minutos: bloque exacto y zona interactiva de al menos 44 px", () => {
  for (const minutes of [15, 30, 45, 60]) {
    const [p] = layout([lesson("x", "12:00", minutes)]);
    assert.equal(p.top, px(240), `${minutes} min: la posición es exacta`);
    assert.equal(p.height, px(minutes) - 6, `${minutes} min: el alto refleja la duración real`);
    assert.equal(p.hitHeight, Math.max(p.height, MIN_TARGET_PX), `${minutes} min: la zona se amplía sólo si hace falta`);
    assert.ok(p.hitHeight >= 44);
    assert.equal(p.hitTop, p.top, "la zona nace en la hora de inicio");
    assert.equal(p.blockOffset, 0);
  }
});

test("dos clases consecutivas de 30 minutos: las dos en el mismo carril, con zonas de 44 px que no se tocan", () => {
  const out = layout([lesson("b", "10:30", 30), lesson("a", "10:00", 30)]);
  assert.deepEqual(out.map((p) => [p.item.id, p.lane, p.laneCount]), [["a", 0, 1], ["b", 0, 1]]);
  assert.ok(out[0].hitHeight >= 44 && out[1].hitHeight >= 44);
  assert.ok(out[0].hitTop + out[0].hitHeight <= out[1].hitTop, "la zona de la primera no invade a la segunda");
  assertTargets(out);
});

test("dos clases consecutivas de 15 minutos: sus zonas de 44 px no caben en una columna, así que se reparten en carriles (ninguna se oculta)", () => {
  const out = layout([lesson("a", "10:00", 15), lesson("b", "10:15", 15)]);
  assert.deepEqual(out.map((p) => [p.item.id, p.lane, p.laneCount]), [["a", 0, 2], ["b", 1, 2]]);
  assert.equal(out[0].height, px(15) - 6, "la duración sigue siendo exacta");
  assertTargets(out);
});

test("orden estable: la misma salida aunque la entrada llegue desordenada (inicio, fin e id)", () => {
  const items = [lesson("z", "10:00", 60), lesson("m", "10:00", 30), lesson("a", "10:00", 60), lesson("k", "09:00", 45), lesson("q", "10:45", 30)];
  const expected = layout(items).map((p) => [p.item.id, p.lane, p.laneCount, p.hitTop]);
  assert.deepEqual(expected.map((row) => row[0]), ["k", "m", "a", "z", "q"], "inicio, luego fin (30 antes que 60) y luego id");
  const permutations = [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 3, 0, 4, 2], [3, 4, 1, 2, 0]];
  for (const order of permutations) {
    const shuffled = order.map((i) => items[i]);
    assert.deepEqual(layout(shuffled).map((p) => [p.item.id, p.lane, p.laneCount, p.hitTop]), expected);
  }
});

test("ninguna clase desaparece: toda clase de entrada sale posicionada (también las que empiezan fuera del eje)", () => {
  const items = [lesson("temprana", "07:00", 60), lesson("a", "09:00", 60), lesson("a2", "09:00", 60), lesson("noche", "21:45", 60), lesson("muy-noche", "22:30", 30)];
  const out = layout(items);
  assert.deepEqual(out.map((p) => p.item.id).sort(), items.map((i) => i.id).sort());
  assertTargets(out);
  for (const p of out) assert.ok(p.height > 0 && p.hitHeight >= 44, `${p.item.id} tiene alto visible`);
});

test("propiedad: conjuntos aleatorios deterministas nunca ocultan una clase, nunca bajan de 44 px y nunca se pisan", () => {
  let seed = 20261014;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 60; run++) {
    const count = 1 + Math.floor(rnd() * 9);
    const items = Array.from({ length: count }, (_, i) => {
      const startMin = 8 * 60 + Math.floor(rnd() * 28) * 30 + (rnd() < 0.3 ? 15 : 0);
      const minutes = [15, 30, 45, 60, 90][Math.floor(rnd() * 5)];
      return lesson(`l${i}`, `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`, minutes);
    });
    const out = layout(items);
    assert.equal(out.length, items.length);
    assertTargets(out);
    assert.deepEqual(layout([...items].reverse()).map((p) => p.item.id), out.map((p) => p.item.id), "el orden no depende de la entrada");
  }
});

test("cableado: la grilla dibuja TODAS las clases posicionadas (sin filtros) y cada tarjeta es un botón de la zona ampliada con su carril", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /positioned\.map\(\(positionedItem\) => \(\s*<RealLessonCard key=\{positionedItem\.item\.id\}/, "una tarjeta por clase, en el orden estable (también el de tabulación)");
  assert.match(grid, /dayColumnMinWidth\(positionedByDay\.get\(dayKey\)/);
  const card = read("components/calendar/real-lesson-card.tsx");
  assert.match(card, /top: hitTop,\s*height: hitHeight,/, "el botón ocupa la zona interactiva");
  assert.match(card, /top: blockOffset, height, boxSizing/, "el bloque visual conserva su alto exacto");
  assert.match(card, /left: `calc\(\$\{\(lane \* 100\) \/ laneCount\}% \+ \$\{inset\}px\)`/);
  assert.match(card, /aria-label=\{ariaLabelOf\(/);
  assert.match(card, /title=\{fullInfo\}/, "nombre, hora, modalidad y estado completos al pasar el puntero");
  // La agenda móvil no cambió: sigue dibujando la misma lista, sin carriles.
  const row = card.slice(card.indexOf("export function RealLessonAgendaRow"));
  assert.doesNotMatch(row, /lane|hitTop|blockOffset/);
});
