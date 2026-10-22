import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHORT_CLASS_MAX_HOUR_HEIGHT_PX, SHORT_CLASS_READABLE_BLOCK_PX, hourHeightForShortClasses, shortestShortClassMinutes } from "../density.ts";
import { DESKTOP_MIN_DAY_COLUMN_PX, cardGapPx, cardPresentation, cardWidthPx, desktopWeekColumns, layoutDayItems, mobileWeekColumns } from "../layout.ts";
import { INLINE_META_FONT_PX, LANE_MAX_WITH_META_PX, SINGLE_LINE_BELOW_HEIGHT_PX, desktopLaneNeedPx, inlineMetaNeedPx, mobileLaneNeedPx } from "../card-text.ts";
import type { CalendarViewItem } from "../occurrences.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString();
};
const lesson = (id: string, from: string, minutes: number): CalendarViewItem => {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
};

test("escala por clases cortas: sólo si hay una de 10 a 29 minutos; sube lo justo para una línea legible y tiene techo", () => {
  assert.equal(shortestShortClassMinutes([lesson("a", "10:00", 60), lesson("b", "11:00", 30)]), null, "sin clases cortas la escala es la de siempre");
  assert.equal(shortestShortClassMinutes([lesson("a", "10:00", 60), lesson("b", "11:00", 15), lesson("c", "12:00", 25)]), 15);
  assert.equal(shortestShortClassMinutes([lesson("a", "10:00", 5)]), null, "una de 5 minutos no agranda toda la jornada");
  assert.equal(hourHeightForShortClasses(null), null);
  assert.equal(hourHeightForShortClasses(15), 68);
  assert.equal(hourHeightForShortClasses(20), 51);
  assert.equal(hourHeightForShortClasses(10), SHORT_CLASS_MAX_HOUR_HEIGHT_PX, "techo: la escala de Amplia");
  for (const minutes of [13, 15, 20, 25]) {
    const px = hourHeightForShortClasses(minutes)!;
    const [p] = layoutDayItems([lesson("x", "12:00", minutes)], px);
    assert.ok(p.height >= SHORT_CLASS_READABLE_BLOCK_PX - 0.01, `${minutes} min a ${px} px/h mide ${p.height.toFixed(2)} px`);
    assert.equal(p.height, (minutes / 60) * px - cardGapPx(px, minutes), `${minutes} min: la duración sigue siendo exacta (no se estira)`);
    assert.equal(cardPresentation({ heightPx: p.height, widthPx: 100 }), "title", `${minutes} min: se lee como una línea de texto de 11 px`);
  }
});

test("una clase de 12 minutos (techo de la escala) conserva su duración y queda con letra chica en vez de sin texto", () => {
  const px = hourHeightForShortClasses(12)!;
  const [p] = layoutDayItems([lesson("x", "12:00", 12)], px);
  assert.equal(px, SHORT_CLASS_MAX_HOUR_HEIGHT_PX);
  assert.equal(cardPresentation({ heightPx: p.height, widthPx: 100 }), "micro");
});

test("clases cortas consecutivas y simultáneas a la escala ampliada: ninguna se pisa ni cambia de hora", () => {
  const px = hourHeightForShortClasses(15)!;
  const chain = layoutDayItems([lesson("a", "16:00", 15), lesson("b", "16:15", 15), lesson("c", "16:30", 15), lesson("d", "16:45", 15)], px);
  assert.ok(chain.every((p) => p.laneCount === 1), "consecutivas: un solo carril");
  for (let i = 0; i < chain.length - 1; i++) assert.ok(chain[i].top + chain[i].height <= chain[i + 1].top + 0.001, "el bloque termina donde empieza el siguiente (menos la separación)");
  assert.equal(chain[1].top - chain[0].top, px / 4, "cada una a su hora real");
  const triple = layoutDayItems([lesson("a", "09:00", 15), lesson("b", "09:00", 15), lesson("c", "09:00", 15)], px);
  assert.deepEqual(triple.map((p) => [p.lane, p.laneCount]), [[0, 3], [1, 3], [2, 3]]);
});

test("escritorio: el día con carriles apretados toma el ancho de los demás (sin desplazar); sin carriles apretados todas las columnas son iguales", () => {
  const area = 1080;
  const equal = desktopWeekColumns({ areaWidthPx: area, timeColumnPx: 48, needPx: [0, 0, 0, 0, 0, 0, 0] });
  assert.equal(equal.custom, false);
  assert.equal(equal.expanded, false);
  const crowded = desktopWeekColumns({ areaWidthPx: area, timeColumnPx: 48, needPx: [0, 200, 0, 0, 0, 0, 0] });
  assert.equal(crowded.custom, true);
  assert.equal(crowded.expanded, false, "alcanza repartiendo: sin barra horizontal");
  assert.ok(crowded.trackPx[1] >= 201 - 0.001);
  assert.ok(crowded.trackPx.every((w, i) => i === 1 || w >= DESKTOP_MIN_DAY_COLUMN_PX));
  assert.ok(Math.abs(crowded.trackPx.reduce((a, b) => a + b, 0) - (area - 48 - 3)) < 0.01, "la suma sigue siendo el ancho disponible");
  const impossible = desktopWeekColumns({ areaWidthPx: area, timeColumnPx: 48, needPx: [330, 330, 330, 0, 0, 0, 0] });
  assert.equal(impossible.expanded, true, "si ni repartiendo alcanza, la grilla se desplaza");
  assert.ok(impossible.trackPx.every((w) => w >= DESKTOP_MIN_DAY_COLUMN_PX - 0.001), "ningún día baja del mínimo");
});

test("la tarjeta de una línea lleva la hora o el estado delante del nombre cuando entra; el teléfono ensancha la columna para eso (con tope) y la palabra del nombre nunca se corta", () => {
  assert.equal(SINGLE_LINE_BELOW_HEIGHT_PX, 27);
  const need = mobileLaneNeedPx("Tomás Villalba", 15, "10:15");
  assert.ok(need > mobileLaneNeedPx("Tomás Villalba", 15), "con la hora necesita más ancho que sólo el nombre");
  assert.ok(need <= LANE_MAX_WITH_META_PX);
  assert.equal(mobileLaneNeedPx("Tomás Villalba", 15, "10:15"), inlineMetaNeedPx(["Tomás"], 10.5, "10:15"));
  assert.equal(mobileLaneNeedPx("Anticonstitucionalmente", 15, "10:15"), mobileLaneNeedPx("Anticonstitucionalmente", 15), "si con la hora pasa del tope, manda el nombre");
  assert.equal(mobileLaneNeedPx("Tomás Villalba", 40, "10:15"), mobileLaneNeedPx("Tomás Villalba", 40), "una tarjeta de dos líneas ya tiene la hora en su segunda línea");
  assert.ok(INLINE_META_FONT_PX >= 9);
  assert.ok(desktopLaneNeedPx("Benjamín Ledesma", false) < desktopLaneNeedPx("Benjamín Ledesma", true), "el ícono de grupo gasta ancho");
  assert.ok(cardWidthPx(desktopWeekColumns({ areaWidthPx: 1080, timeColumnPx: 48, needPx: [3 * desktopLaneNeedPx("Valentina", false), 0, 0, 0, 0, 0, 0] }).trackPx[0] - 1, 3) >= desktopLaneNeedPx("Valentina", false) - 6);
  void mobileWeekColumns;
});

test("cableado: la grilla sube la escala de la semana con clases cortas (teléfono y Compacta), abre en la primera clase y reparte el ancho en escritorio", () => {
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /hourHeightForShortClasses\(shortestShortClassMinutes\(visible\)\)/);
  assert.match(grid, /isMobile \|\| fixedHourHeight === null/, "Media y Amplia conservan su escala fija");
  assert.match(grid, /scroller\.scrollTop = Number\.isFinite\(firstClassTopPx\)/);
  assert.match(grid, /desktopWeekColumns\(\{/);
  assert.match(grid, /minmax\(0, \$\{px\}fr\)/, "al sólo repartirse el ancho, fr proporcionales");
  const card = read("components/calendar/real-lesson-card.tsx");
  assert.match(card, /const showInlineMeta = mobileWeek \?/);
  assert.equal((card.match(/\{showInlineMeta && \(/g) ?? []).length, 2, "la tarjeta de una línea y la `micro` usan la misma regla");
});
