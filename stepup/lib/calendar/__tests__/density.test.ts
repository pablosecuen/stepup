import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CalendarViewItem } from "../occurrences";
import { END_HOUR, HOURS, MIN_TARGET_PX, START_HOUR, currentTimeTop, layoutDayItems, type PositionedItem } from "../layout.ts";
import {
  CALENDAR_DENSITIES,
  CALENDAR_DENSITY_STORAGE_KEY,
  DEFAULT_CALENDAR_DENSITY,
  hourHeightFor,
  parseCalendarDensity,
  readStoredCalendarDensity,
  writeStoredCalendarDensity,
} from "../density.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PX = { compact: 48, medium: 64, wide: 80 } as const;
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString(); // Buenos Aires = UTC-3
};
const lesson = (id: string, from: string, minutes: number): CalendarViewItem => {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
};

function assertNoCollisions(positioned: PositionedItem[], gridBottom: number): void {
  for (const p of positioned) {
    assert.ok(p.hitHeight >= MIN_TARGET_PX, `${p.item.id}: zona de ${p.hitHeight}px`);
    assert.ok(p.hitTop >= 0 && p.hitTop + p.hitHeight <= gridBottom + 0.001, `${p.item.id}: dentro de la grilla`);
    assert.ok(p.blockOffset >= 0 && p.blockOffset + p.height <= p.hitHeight + 0.001, `${p.item.id}: el bloque cabe en su zona`);
  }
  for (let i = 0; i < positioned.length; i++)
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i];
      const b = positioned[j];
      if (a.hitTop < b.hitTop + b.hitHeight && b.hitTop < a.hitTop + a.hitHeight) assert.notEqual(a.lane, b.lane, `${a.item.id} y ${b.item.id} se pisan`);
    }
}

test("tres densidades: Compacta 48, Media 64 y Amplia 80 px por hora; la de partida es Media", () => {
  assert.deepEqual(CALENDAR_DENSITIES.map((d) => [d.key, d.label, d.hourHeightPx]), [["compact", "Compacta", 48], ["medium", "Media", 64], ["wide", "Amplia", 80]]);
  assert.equal(DEFAULT_CALENDAR_DENSITY, "medium");
  assert.equal(hourHeightFor("medium"), 64);
  // Media muestra sensiblemente más horas que antes (96 px/h): el eje de 14 h pasa de 1.344 a 896 px.
  assert.equal(HOURS.length * hourHeightFor("medium"), 896);
  assert.ok(HOURS.length * hourHeightFor("medium") <= (HOURS.length * 96) * 0.7);
});

test("un valor guardado inválido, ausente o ilegible vuelve a Media; uno válido se respeta", () => {
  for (const bad of [null, undefined, "", " medium", "MEDIUM", "ancha", "compacta", 64, {}, [], "wide ", "0", "null"]) assert.equal(parseCalendarDensity(bad), "medium", String(bad));
  for (const key of ["compact", "medium", "wide"] as const) assert.equal(parseCalendarDensity(key), key);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readStoredCalendarDensity(storage), "medium", "nada guardado → Media");
  assert.equal(writeStoredCalendarDensity(storage, "compact"), true);
  assert.equal(store.get(CALENDAR_DENSITY_STORAGE_KEY), "compact");
  assert.equal(readStoredCalendarDensity(storage), "compact");
  store.set(CALENDAR_DENSITY_STORAGE_KEY, "{\"x\":1}");
  assert.equal(readStoredCalendarDensity(storage), "medium", "valor corrupto → Media");
  const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
  assert.equal(readStoredCalendarDensity(broken), "medium", "almacenamiento bloqueado → Media, sin lanzar");
  assert.equal(writeStoredCalendarDensity(broken, "wide"), false, "no se puede guardar: no lanza");
  assert.equal(readStoredCalendarDensity(null), "medium");
  assert.equal(writeStoredCalendarDensity(undefined, "wide"), false);
});

test("la densidad sólo cambia la escala: la posición temporal y la duración de cada clase son proporcionales y exactas en las tres", () => {
  const cases: Array<[string, number]> = [["08:00", 60], ["09:15", 45], ["12:00", 30], ["14:30", 90], ["19:45", 15], ["21:00", 60]];
  for (const [key, px] of Object.entries(PX)) {
    for (const [from, minutes] of cases) {
      const item = lesson("x", from, minutes);
      const [p] = layoutDayItems([item], px);
      const [h, m] = from.split(":").map(Number);
      const minutesFromStart = (h - START_HOUR) * 60 + m;
      assert.equal(p.top, (minutesFromStart / 60) * px, `${key} ${from}: la posición es minutos × px/hora`);
      assert.ok(Math.abs(p.top / px - minutesFromStart / 60) < 1e-9, "misma posición en horas en cualquier densidad");
      const expectedHeight = Math.max(4, Math.min((minutes / 60) * px - 6, (END_HOUR - START_HOUR) * px - p.top));
      assert.equal(p.height, expectedHeight, `${key} ${from}+${minutes}: el alto del bloque sigue la duración`);
      assert.equal(p.item, item, "la clase no se modifica: mismas fechas, horas y duración");
      assert.equal(p.item.start, item.start);
      assert.equal(p.item.end, item.end);
      assertNoCollisions([p], (END_HOUR - START_HOUR) * px);
    }
  }
});

test("clases de 15, 30, 45 y 60 minutos: la zona interactiva nunca baja de 44 px y el bloque visible conserva su alto exacto", () => {
  for (const px of Object.values(PX)) {
    for (const minutes of [15, 30, 45, 60]) {
      const [p] = layoutDayItems([lesson("x", "12:00", minutes)], px);
      assert.ok(p.hitHeight >= MIN_TARGET_PX, `${px}px/h ${minutes} min`);
      assert.equal(p.height, Math.max(4, (minutes / 60) * px - 6), "la geometría visible NO se estira para alcanzar 44 px");
      assert.equal(p.hitHeight, Math.max(p.height, MIN_TARGET_PX));
    }
  }
});

test("consecutivas, simultáneas y superpuestas en las tres densidades: ninguna se oculta ni se pisan sus zonas de 44 px", () => {
  for (const px of Object.values(PX)) {
    const bottom = (END_HOUR - START_HOUR) * px;
    // consecutivas de 30 min: a 48/64/80 px/h miden menos de 44 px, así que se reparten en carriles (nunca una zona sobre otra)
    const consecutive = layoutDayItems([lesson("a", "10:00", 30), lesson("b", "10:30", 30), lesson("c", "11:00", 30)], px);
    assert.equal(consecutive.length, 3);
    assert.ok(consecutive.some((p) => p.laneCount >= 2), `${px}px/h: 30 min consecutivos comparten ancho en carriles`);
    assertNoCollisions(consecutive, bottom);
    // consecutivas de 60 min: caben en una sola columna
    const hourly = layoutDayItems([lesson("a", "10:00", 60), lesson("b", "11:00", 60)], px);
    assert.deepEqual(hourly.map((p) => p.laneCount), [1, 1], `${px}px/h`);
    // simultáneas (mismo inicio y fin)
    const simultaneous = layoutDayItems([lesson("a", "10:00", 60), lesson("b", "10:00", 60), lesson("c", "10:00", 60)], px);
    assert.deepEqual(simultaneous.map((p) => [p.lane, p.laneCount]), [[0, 3], [1, 3], [2, 3]]);
    assert.ok(simultaneous.every((p) => p.height === simultaneous[0].height), "mismo alto exacto");
    // superpuestas parcialmente
    const overlapped = layoutDayItems([lesson("a", "10:00", 90), lesson("b", "10:30", 90), lesson("z", "14:00", 60)], px);
    assert.deepEqual(overlapped.map((p) => p.item.id).sort(), ["a", "b", "z"]);
    assert.equal(overlapped.find((p) => p.item.id === "z")!.laneCount, 1, "una clase lejana vuelve al ancho completo");
    assertNoCollisions(overlapped, bottom);
  }
});

test("propiedad: conjuntos aleatorios deterministas en las tres densidades nunca ocultan una clase, nunca bajan de 44 px y nunca se pisan", () => {
  let seed = 20261014;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const px of Object.values(PX)) {
    for (let round = 0; round < 40; round++) {
      const count = 1 + Math.floor(rand() * 9);
      const items = Array.from({ length: count }, (_, i) => {
        const startMin = 8 * 60 + Math.floor(rand() * 13 * 4) * 15;
        const dur = [15, 30, 45, 60, 90, 120][Math.floor(rand() * 6)];
        const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
        const mm = String(startMin % 60).padStart(2, "0");
        return lesson(`id${i}`, `${hh}:${mm}`, dur);
      });
      const out = layoutDayItems(items, px);
      assert.equal(out.length, items.length, "ninguna clase desaparece");
      assertNoCollisions(out, (END_HOUR - START_HOUR) * px);
    }
  }
});

test("la línea de «ahora» sigue la misma escala", () => {
  const noon = new Date(Date.UTC(2026, 9, 14, 15, 0)); // 12:00 en Buenos Aires
  for (const px of Object.values(PX)) assert.equal(currentTimeTop(noon, px), 4 * px);
  assert.equal(currentTimeTop(new Date(Date.UTC(2026, 9, 14, 10, 0)), 64), null, "fuera del eje (07:00)");
});

test("cableado: selector segmentado con texto y aria-pressed, sólo en escritorio, persistencia sólo en localStorage y la grilla usa la escala elegida", () => {
  const picker = code("components/calendar/calendar-density-picker.tsx");
  assert.match(picker, /aria-pressed=\{selected\}/);
  assert.match(picker, /\{density\.label\}/, "texto visible, no sólo íconos");
  assert.match(picker, /role="group" aria-labelledby="densidad-etiqueta"/);
  assert.match(picker, /hidden items-center[^"]*nav:flex/, "oculto en móvil: la agenda por día no cambia con él");
  assert.match(picker, /min-h-11/);
  assert.doesNotMatch(picker, /animate|motion/);
  const grid = code("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /useState<CalendarDensityKey>\(DEFAULT_CALENDAR_DENSITY\)/, "Media al cargar: igual en servidor y navegador");
  assert.match(grid, /readStoredCalendarDensity\(storage\)/);
  assert.match(grid, /writeStoredCalendarDensity\(window\.localStorage, next\)/);
  assert.match(grid, /layoutDayItems\(itemsByDayKey\.get\(dayKey\) \?\? \[\], hourHeightPx\)/);
  assert.match(grid, /height: HOURS\.length \* hourHeightPx/);
  assert.match(grid, /<CalendarDensityPicker value=\{density\} onChange=\{chooseDensity\} \/>/);
  const density = code("lib/calendar/density.ts");
  assert.doesNotMatch(density, /fetch\(|document\.cookie|supabase|sessionStorage/, "la preferencia es sólo de este navegador");
  // La agenda móvil no se toca.
  const mobile = grid.slice(grid.indexOf("{/* Móvil: agenda agrupada por día */}"));
  assert.doesNotMatch(mobile, /hourHeightPx|density/);
});
