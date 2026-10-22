import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarViewItem } from "../occurrences";
import { layoutDayItems } from "../layout.ts";
import { LABEL_HEIGHT_PX, SHORT_BAR_MAX_HEIGHT_PX, planShortLabels, placeLabels, shortLabelsNeedPx, type LabelSource } from "../short-labels.ts";

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString();
};
const lesson = (id: string, from: string, minutes: number): CalendarViewItem => {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
};
const sourcesOf = (items: CalendarViewItem[]) => new Map<string, LabelSource>(items.map((i) => [i.id, { id: i.id, title: `Alumno ${i.id}`, timeText: "10:00", stateText: null }]));

function plan(items: CalendarViewItem[], hourPx: number, colPx: number) {
  const positioned = layoutDayItems(items, hourPx);
  return { positioned, plan: planShortLabels(positioned, sourcesOf(items), colPx, 14 * hourPx) };
}
const overlaps = (a: { y: number; height: number }, b: { y: number; height: number }) => a.y < b.y + b.height - 0.001 && b.y < a.y + a.height - 0.001;

test("sin clases cortas no cambia nada (null)", () => {
  assert.equal(plan([lesson("a", "10:00", 60), lesson("b", "11:00", 30)], 50, 150).plan, null);
});

test("consecutivas: cada rótulo queda en la fila de su barra (a 50 px/h, a ≤ 2 px) y nunca pisa a otro rótulo ni a la clase larga que sigue", () => {
  const items = [lesson("a", "10:00", 15), lesson("b", "10:15", 15), lesson("c", "10:30", 30), lesson("d", "11:00", 15)];
  const { positioned, plan: p } = plan(items, 50, 150);
  assert.ok(p);
  const labels = ["a", "b", "d"].map((id) => p!.items.get(id)!.label);
  for (const id of ["a", "b", "d"]) assert.ok(Math.abs(p!.items.get(id)!.label.offsetPx) <= 2, `${id}: ${p!.items.get(id)!.label.offsetPx}`);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!overlaps(labels[i], labels[j]));
  const longBlock = positioned.find((q) => q.item.id === "c")!;
  for (const l of labels) assert.ok(!(l.y < longBlock.top + longBlock.height && l.y + l.height > longBlock.top), "el rótulo no tapa la clase larga");
  assert.equal(p!.items.has("c"), false, "la clase larga NO se transforma");
  assert.equal(p!.narrowed.size, 0);
});

test("cuatro seguidas a 35,8 px/h: los rótulos se acomodan sin pisarse ni tapar a la larga; el desplazamiento se informa", () => {
  const items = [lesson("a", "16:00", 15), lesson("b", "16:15", 15), lesson("c", "16:30", 15), lesson("d", "16:45", 15), lesson("z", "17:00", 60)];
  const { positioned, plan: p } = plan(items, 35.8, 147);
  assert.ok(p);
  const ids = ["a", "b", "c", "d"];
  const labels = ids.map((id) => p!.items.get(id)!.label);
  for (let i = 0; i < labels.length - 1; i++) assert.ok(labels[i + 1].y >= labels[i].y + LABEL_HEIGHT_PX - 0.001, "en orden y sin pisarse");
  const z = positioned.find((q) => q.item.id === "z")!;
  assert.ok(labels.every((l) => l.y + l.height <= z.top + 0.001 || l.y >= z.top + z.height), "ninguno tapa a la clase larga");
  assert.ok(Math.max(...labels.map((l) => Math.abs(l.offsetPx))) <= 14, `desplazamiento máximo ${Math.max(...labels.map((l) => Math.abs(l.offsetPx)))}`);
});

test("simultáneas: todas llevan número 1..n en la barra y en el rótulo, rótulos centrados sobre el conjunto (desplazamiento ≤ n·13/2) y sin pisarse", () => {
  const items = [lesson("a", "09:00", 15), lesson("b", "09:00", 15), lesson("c", "09:00", 15), lesson("l", "10:00", 60)];
  const { plan: p } = plan(items, 50, 190);
  assert.ok(p);
  const sim = ["a", "b", "c"].map((id) => p!.items.get(id)!);
  assert.deepEqual(sim.map((s) => s.number), [1, 2, 3]);
  assert.ok(Math.max(...sim.map((s) => Math.abs(s.label.offsetPx))) <= 3 * LABEL_HEIGHT_PX / 2 + 0.5);
  for (let i = 0; i < 2; i++) assert.ok(sim[i + 1].label.y >= sim[i].label.y + LABEL_HEIGHT_PX - 0.001);
  assert.deepEqual(sim.map((s) => s.barLeft), [1, 1 + p!.areaPx / 3, 1 + (2 * p!.areaPx) / 3].map((x) => x), "barras de izquierda a derecha en el orden de los números");
  assert.equal(p!.items.has("l"), false);
});

test("una clase larga simultánea con cortas pasa a barra + rótulo (justificado: su carril sería demasiado angosto) y así se marca", () => {
  const items = [lesson("a", "12:00", 15), lesson("b", "12:00", 30)];
  const { plan: p } = plan(items, 50, 150);
  assert.ok(p);
  assert.equal(p!.items.get("b")!.transformedLong, true);
  assert.equal(p!.items.get("a")!.transformedLong, false);
});

test("placeLabels: sin pisarse, esquiva intervalos prohibidos y se queda lo más cerca posible del lugar ideal", () => {
  assert.deepEqual(placeLabels([10, 12], [[], []], 13, 200), [10, 23], "el segundo baja lo mínimo");
  const ys = placeLabels([50, 51], [[[48, 70]], [[48, 70]]], 13, 200)!;
  assert.ok(ys.every((y) => y + 13 <= 48 + 0.001 || y >= 70 - 0.001), "no entra en el intervalo prohibido");
  assert.equal(placeLabels([5], [[[0, 100]]], 13, 90), null, "sin lugar: null");
});

test("el ancho que pide un día con cortas incluye hora, estado y la primera palabra; sin cortas es 0", () => {
  const items = [lesson("a", "10:00", 15), lesson("b", "10:15", 15)];
  const positioned = layoutDayItems(items, 50);
  const need = shortLabelsNeedPx(positioned, sourcesOf(items));
  assert.ok(need > 60 && need <= 210, String(need));
  assert.equal(shortLabelsNeedPx(layoutDayItems([lesson("x", "10:00", 60)], 50), sourcesOf([lesson("x", "10:00", 60)])), 0);
  assert.ok(SHORT_BAR_MAX_HEIGHT_PX === 15);
});
