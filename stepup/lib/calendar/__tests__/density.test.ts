import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CalendarViewItem } from "../occurrences";
import { END_HOUR, HOURS, MIN_TARGET_PX, MIN_TEXT_HEIGHT_PX, START_HOUR, cardGapPx, currentTimeTop, layoutDayItems, type PositionedItem } from "../layout.ts";
import {
  CALENDAR_DENSITIES,
  CALENDAR_DENSITY_STORAGE_KEY,
  COMPACT_MIN_HOUR_HEIGHT_PX,
  DEFAULT_CALENDAR_DENSITY,
  calendarDensityLabel,
  fitHourHeight,
  hourHeightFor,
  moveActiveDensity,
  parseCalendarDensity,
  readStoredCalendarDensity,
  writeStoredCalendarDensity,
} from "../density.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Escalas con las que se prueba la geometría. «Compacta» no tiene un alto fijo: se prueba con alturas ajustadas de pantallas
 * reales (el piso de 24, 1366×768 ≈ 31, 1440×900 ≈ 40 y 1920×1080 ≈ 52,5 px/h) además de Media y Amplia.
 */
const PX = { compactFloor: 24, compact768: 31.25, compact900: 40, compact1080: 52.5, medium: 64, wide: 80 } as const;
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString(); // Buenos Aires = UTC-3
};
const lesson = (id: string, from: string, minutes: number): CalendarViewItem => {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
};

const strip = (p: PositionedItem) => [p.lane / p.laneCount, (p.lane + 1) / p.laneCount] as const;
const sameStrip = (a: PositionedItem, b: PositionedItem) => a.lane / a.laneCount < strip(b)[1] - 1e-9 && strip(b)[0] < strip(a)[1] - 1e-9;

/**
 * Zonas de toque: dentro de la grilla, cubren el bloque (salvo el píxel del piso de lectura), llegan a 44 px siempre que no haya otra clase pegada debajo en la misma franja, y nunca se pisan.
 */
function assertNoCollisions(positioned: PositionedItem[], gridBottom: number): void {
  for (const p of positioned) {
    assert.ok(p.hitTop >= 0 && p.hitTop + p.hitHeight <= gridBottom + 0.001, `${p.item.id}: dentro de la grilla`);
    // El piso de lectura (15 px, clases de 30 min o más) puede dejar el bloque dibujado unos 3 px más alto que el hueco hasta la clase siguiente, sólo con la escala más ajustada.
    assert.ok(p.blockOffset === 0 && p.hitHeight >= p.height - 4, `${p.item.id}: la zona cubre el bloque`);
    if (p.hitHeight < MIN_TARGET_PX - 0.001) {
      const bottom = p.hitTop + p.hitHeight;
      assert.ok(bottom >= gridBottom - 0.001 || positioned.some((o) => o !== p && sameStrip(p, o) && Math.abs(o.hitTop - bottom) < 0.001), `${p.item.id}: zona de ${p.hitHeight}px sin nada pegado debajo`);
    }
  }
  for (let i = 0; i < positioned.length; i++)
    for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i];
      const b = positioned[j];
      if (a.hitTop < b.hitTop + b.hitHeight - 0.001 && b.hitTop < a.hitTop + a.hitHeight - 0.001) assert.ok(!sameStrip(a, b), `${a.item.id} y ${b.item.id} se pisan`);
    }
}

test("tres densidades: Compacta sin alto fijo (se ajusta al espacio), Media 64 y Amplia 80 px por hora; la de partida es Compacta", () => {
  assert.deepEqual(CALENDAR_DENSITIES.map((d) => [d.key, d.label, d.hourHeightPx]), [["compact", "Compacta", null], ["medium", "Media", 64], ["wide", "Amplia", 80]]);
  assert.equal(DEFAULT_CALENDAR_DENSITY, "compact");
  assert.equal(hourHeightFor("compact"), null, "Compacta no usa una cantidad fija de píxeles por hora");
  assert.equal(hourHeightFor("medium"), 64);
  assert.equal(hourHeightFor("wide"), 80);
  assert.equal(calendarDensityLabel("compact"), "Compacta");
  assert.equal(calendarDensityLabel("medium"), "Media");
  assert.equal(calendarDensityLabel("wide"), "Amplia");
  assert.equal(HOURS.length * 64, 896);
});

test("fitHourHeight: reparte el espacio medido entre las horas, nunca de más y con piso de legibilidad", () => {
  const hours = HOURS.length;
  // 1366×768, 1440×900 y 1920×1080 (alturas disponibles típicas de la zona de agenda y encabezado de 47 px + bordes de 3 px)
  for (const available of [500, 592, 700, 804, 958]) {
    const fixed = 50;
    const fit = fitHourHeight({ availablePx: available, fixedPx: fixed, hours });
    assert.equal(fit.overflows, false, `${available}px`);
    assert.ok(fit.hourHeightPx * hours + fixed <= available + 1e-9, `${available}px: el eje entra completo sin desplazarse`);
    assert.ok(fit.hourHeightPx * hours + fixed > available - hours * 0.25 - 1e-9, `${available}px: aprovecha el espacio (sobra menos de un cuarto de píxel por hora)`);
    assert.equal(fit.hourHeightPx * 4, Math.floor(fit.hourHeightPx * 4), "múltiplo de un cuarto de píxel");
  }
  // más espacio ⇒ más alto por hora (proporcional, sin offsets atados a una resolución)
  const small = fitHourHeight({ availablePx: 600, fixedPx: 50, hours }).hourHeightPx;
  const large = fitHourHeight({ availablePx: 900, fixedPx: 50, hours }).hourHeightPx;
  assert.ok(large > small);
  // el encabezado más alto (zoom, texto grande) deja menos a las horas
  assert.ok(fitHourHeight({ availablePx: 600, fixedPx: 80, hours }).hourHeightPx < small);
  // piso: por debajo la zona se desplaza por dentro en vez de apretar las tarjetas hasta volverlas ilegibles
  const tiny = fitHourHeight({ availablePx: 300, fixedPx: 50, hours });
  assert.deepEqual(tiny, { hourHeightPx: COMPACT_MIN_HOUR_HEIGHT_PX, overflows: true });
  for (const bad of [{ availablePx: NaN, fixedPx: 50 }, { availablePx: 600, fixedPx: Infinity }, { availablePx: 0, fixedPx: 0 }, { availablePx: -5, fixedPx: 10 }]) {
    assert.equal(fitHourHeight({ ...bad, hours }).overflows, true, JSON.stringify(bad));
  }
  assert.equal(fitHourHeight({ availablePx: 600, fixedPx: 50, hours: 0 }).overflows, true);
});

test("un valor guardado inválido, ausente o ilegible vuelve a la densidad por defecto; uno válido se respeta (incluidas las claves anteriores)", () => {
  for (const bad of [null, undefined, "", " medium", "MEDIUM", "ancha", "compacta", 64, {}, [], "wide ", "0", "null"]) assert.equal(parseCalendarDensity(bad), DEFAULT_CALENDAR_DENSITY, String(bad));
  for (const key of ["compact", "medium", "wide"] as const) assert.equal(parseCalendarDensity(key), key);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(CALENDAR_DENSITY_STORAGE_KEY, "teacherflow.calendar.density.v1", "misma clave: la preferencia ya guardada se conserva");
  assert.equal(readStoredCalendarDensity(storage), DEFAULT_CALENDAR_DENSITY, "nada guardado → por defecto");
  assert.equal(writeStoredCalendarDensity(storage, "wide"), true);
  assert.equal(store.get(CALENDAR_DENSITY_STORAGE_KEY), "wide");
  assert.equal(readStoredCalendarDensity(storage), "wide");
  store.set(CALENDAR_DENSITY_STORAGE_KEY, "medium");
  assert.equal(readStoredCalendarDensity(storage), "medium", "la elección anterior (Media) se respeta");
  store.set(CALENDAR_DENSITY_STORAGE_KEY, "{\"x\":1}");
  assert.equal(readStoredCalendarDensity(storage), DEFAULT_CALENDAR_DENSITY, "valor corrupto → por defecto");
  const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
  assert.equal(readStoredCalendarDensity(broken), DEFAULT_CALENDAR_DENSITY, "almacenamiento bloqueado → por defecto, sin lanzar");
  assert.equal(writeStoredCalendarDensity(broken, "wide"), false, "no se puede guardar: no lanza");
  assert.equal(readStoredCalendarDensity(null), DEFAULT_CALENDAR_DENSITY);
  assert.equal(writeStoredCalendarDensity(undefined, "wide"), false);
});

test("teclado del selector: flechas con vuelta, Inicio y Fin", () => {
  assert.equal(moveActiveDensity(0, "ArrowDown"), 1);
  assert.equal(moveActiveDensity(2, "ArrowDown"), 0, "vuelve al principio");
  assert.equal(moveActiveDensity(0, "ArrowUp"), 2, "vuelve al final");
  assert.equal(moveActiveDensity(1, "ArrowUp"), 0);
  assert.equal(moveActiveDensity(2, "Home"), 0);
  assert.equal(moveActiveDensity(0, "End"), 2);
  assert.equal(moveActiveDensity(5, "ArrowDown", 0), 0, "sin opciones no lanza");
});

test("la densidad sólo cambia la escala: la posición temporal y la duración de cada clase son proporcionales y exactas en todas", () => {
  const cases: Array<[string, number]> = [["08:00", 60], ["09:15", 45], ["12:00", 30], ["14:30", 90], ["19:45", 15], ["21:00", 60]];
  for (const [key, px] of Object.entries(PX)) {
    for (const [from, minutes] of cases) {
      const item = lesson("x", from, minutes);
      const [p] = layoutDayItems([item], px);
      const [h, m] = from.split(":").map(Number);
      const minutesFromStart = (h - START_HOUR) * 60 + m;
      assert.equal(p.top, (minutesFromStart / 60) * px, `${key} ${from}: la posición es minutos × px/hora`);
      assert.ok(Math.abs(p.top / px - minutesFromStart / 60) < 1e-9, "misma posición en horas en cualquier densidad");
      const exactHeight = Math.max(4, Math.min((minutes / 60) * px - cardGapPx(px), (END_HOUR - START_HOUR) * px - p.top));
      const expectedHeight = minutes >= 30 ? Math.max(MIN_TEXT_HEIGHT_PX, exactHeight) : exactHeight;
      assert.equal(p.height, expectedHeight, `${key} ${from}+${minutes}: el alto del bloque sigue la duración (piso de una línea de texto desde 30 min)`);
      assert.equal(p.item, item, "la clase no se modifica: mismas fechas, horas y duración");
      assert.equal(p.item.start, item.start);
      assert.equal(p.item.end, item.end);
      assertNoCollisions([p], (END_HOUR - START_HOUR) * px);
    }
  }
});

test("clases al inicio y al final de la jornada: la primera (08:00) y la última (hasta las 22:00) quedan dentro de la grilla en todas las escalas", () => {
  for (const px of Object.values(PX)) {
    const bottom = (END_HOUR - START_HOUR) * px;
    const [first] = layoutDayItems([lesson("first", "08:00", 60)], px);
    assert.equal(first.top, 0);
    assert.ok(first.hitTop >= 0);
    const [last] = layoutDayItems([lesson("last", "21:00", 60)], px);
    assert.equal(last.top, 13 * px);
    assert.ok(last.hitTop + last.hitHeight <= bottom + 0.001, `${px}px/h: la zona de la última clase no se sale de la grilla`);
    assertNoCollisions([first, last], bottom);
  }
});

test("clases de 15, 30, 45 y 60 minutos: sin vecinos la zona interactiva llega a 44 px y el bloque visible conserva su alto exacto (con el piso de una línea de texto desde 30 min)", () => {
  for (const px of Object.values(PX)) {
    for (const minutes of [15, 30, 45, 60]) {
      const [p] = layoutDayItems([lesson("x", "12:00", minutes)], px);
      assert.ok(p.hitHeight >= MIN_TARGET_PX, `${px}px/h ${minutes} min`);
      const exact = Math.max(4, (minutes / 60) * px - cardGapPx(px));
      assert.equal(p.height, minutes >= 30 ? Math.max(MIN_TEXT_HEIGHT_PX, exact) : exact, "la geometría visible NO se estira para alcanzar 44 px");
      assert.equal(p.hitHeight, Math.max(p.height, MIN_TARGET_PX));
    }
  }
});

test("consecutivas, simultáneas y superpuestas en todas las escalas: ninguna se oculta ni se pisan sus zonas", () => {
  for (const px of Object.values(PX)) {
    const bottom = (END_HOUR - START_HOUR) * px;
    // consecutivas (de 30 o de 60 min): una termina donde empieza la otra, así que comparten carril y ancho completo a cualquier escala; la zona de cada una llega hasta la siguiente
    const consecutive = layoutDayItems([lesson("a", "10:00", 30), lesson("b", "10:30", 30), lesson("c", "11:00", 30)], px);
    assert.equal(consecutive.length, 3);
    assert.ok(consecutive.every((p) => p.laneCount === 1), `${px}px/h: 30 min consecutivos conservan el ancho completo`);
    assertNoCollisions(consecutive, bottom);
    const hourly = layoutDayItems([lesson("a", "10:00", 60), lesson("b", "11:00", 60)], px);
    assert.equal(hourly.length, 2);
    assert.deepEqual(hourly.map((p) => p.laneCount), [1, 1], `${px}px/h`);
    assertNoCollisions(hourly, bottom);
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

test("propiedad: conjuntos aleatorios deterministas en todas las escalas nunca ocultan una clase, nunca bajan de 44 px y nunca se pisan", () => {
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

test("cableado de la grilla: Compacta se mide con ResizeObserver (sin altura fija), Media y Amplia se desplazan dentro de la zona, la página no", () => {
  const grid = code("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /new ResizeObserver\(measure\)/);
  assert.match(grid, /observer\.observe\(region\);\s+observer\.observe\(scroller\);\s+observer\.observe\(header\);/, "zona de agenda, grilla y encabezado de los días");
  assert.match(grid, /window\.addEventListener\("resize", measure\)/);
  assert.match(grid, /observer\.disconnect\(\)/, "se limpia al desmontar");
  assert.match(grid, /fitHourHeight\(\{ availablePx, fixedPx, hours: HOURS\.length \}\)/);
  assert.match(grid, /fixedHourHeight \?\? fit\?\.hourHeightPx \?\? COMPACT_INITIAL_HOUR_HEIGHT_PX;/);
  assert.match(grid, /\}, \[density, dayKeys\.length\]\);/, "se vuelve a medir al cambiar de densidad o de Semana a Día");
  assert.match(grid, /scrollsVertically = isMobile \|\| fixedHourHeight !== null \|\| fit\?\.overflows === true/);
  assert.match(grid, /layoutDayItems\(itemsByDayKey\.get\(dayKey\) \?\? \[\], hourHeightPx\)/);
  assert.match(grid, /height: HOURS\.length \* hourHeightPx/);
  // encabezado de los días y escala horaria fijos dentro de la zona que se desplaza
  assert.match(grid, /sticky top-0 z-20 grid/);
  assert.match(grid, /sticky left-0 z-10 bg-surface/);
  assert.doesNotMatch(grid, /\b(?:48|64|80)\b\s*(?:px|\))/, "ninguna altura fija por hora en la grilla");
  const density = code("lib/calendar/density.ts");
  assert.doesNotMatch(density, /fetch\(|document\.cookie|supabase|sessionStorage/, "la preferencia es sólo de este navegador");
  assert.doesNotMatch(density, /hourHeightPx: 48/);
  // La agenda móvil no se toca.
  const mobile = grid.slice(grid.indexOf("{/* Móvil: agenda agrupada por día */}"));
  assert.doesNotMatch(mobile, /hourHeightPx|density|fit\b/);
});
