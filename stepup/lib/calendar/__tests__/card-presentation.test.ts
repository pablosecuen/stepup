import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CalendarViewItem } from "../occurrences";
import {
  END_HOUR,
  FULL_CARD_MIN_HEIGHT_PX,
  FULL_CARD_MIN_WIDTH_PX,
  HOURS,
  MIN_DAY_COLUMN_WIDTH_PX,
  MIN_TARGET_PX,
  START_HOUR,
  TIME_COLUMN_WIDTH_PX,
  TITLE_CARD_MIN_HEIGHT_PX,
  TITLE_CARD_MIN_WIDTH_PX,
  cardInsetPx,
  cardPresentation,
  cardWidthPx,
  dayColumnWidthPx,
  gridFitsWidth,
  layoutDayItems,
  type PositionedItem,
} from "../layout.ts";
import { fitHourHeight } from "../density.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 14, h + 3, m)).toISOString(); // Buenos Aires = UTC-3
};
const lesson = (id: string, from: string, minutes: number): CalendarViewItem => {
  const start = at(from);
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
};

/** Pantallas del bloque: ancho de la ventana (CSS px, ya con el zoom aplicado) → ancho útil de la zona de agenda (barra de 236 + relleno 2×24 y máximo 1180). */
const areaWidth = (viewportCssPx: number) => Math.min(1180, viewportCssPx - 236) - 48;
const VIEWPORTS: Array<[string, number, number]> = [
  ["1366×768 al 100 %", 1366, 768],
  ["1366×768 al 125 %", 1366 / 1.25, 768 / 1.25],
  ["1440×900 al 100 %", 1440, 900],
  ["1440×900 al 125 %", 1440 / 1.25, 900 / 1.25],
  ["1920×1080 al 100 %", 1920, 1080],
];
/** Alto por hora de Compacta en esa pantalla: lo que arriba del eje ocupan el encabezado y los controles (≈ 209 px medidos) y 16 px de relleno inferior. */
const compactHourHeight = (viewportHeightCssPx: number) => fitHourHeight({ availablePx: viewportHeightCssPx - 209 - 16 + 47, fixedPx: 50, hours: HOURS.length }).hourHeightPx;

test("cardPresentation: tres modos según el tamaño real; los umbrales son exactos y nada depende del contenido", () => {
  assert.equal(cardPresentation({ heightPx: FULL_CARD_MIN_HEIGHT_PX, widthPx: FULL_CARD_MIN_WIDTH_PX }), "full");
  assert.equal(cardPresentation({ heightPx: FULL_CARD_MIN_HEIGHT_PX - 0.01, widthPx: 300 }), "title", "un poco bajo: sólo el título");
  assert.equal(cardPresentation({ heightPx: 300, widthPx: FULL_CARD_MIN_WIDTH_PX - 0.01 }), "title", "un poco angosto: sólo el título");
  assert.equal(cardPresentation({ heightPx: TITLE_CARD_MIN_HEIGHT_PX, widthPx: TITLE_CARD_MIN_WIDTH_PX }), "title");
  assert.equal(cardPresentation({ heightPx: TITLE_CARD_MIN_HEIGHT_PX - 0.01, widthPx: 300 }), "block", "muy bajo: bloque de color");
  assert.equal(cardPresentation({ heightPx: 300, widthPx: TITLE_CARD_MIN_WIDTH_PX - 0.01 }), "block", "muy angosto: bloque de color");
  for (const bad of [NaN, -1, 0]) {
    assert.equal(cardPresentation({ heightPx: bad, widthPx: 100 }), "block", String(bad));
    assert.equal(cardPresentation({ heightPx: 100, widthPx: bad }), "block", String(bad));
  }
  // La altura mínima del modo «título» deja entrar una línea de 11 px con el borde de 1,5 px por lado.
  assert.ok(TITLE_CARD_MIN_HEIGHT_PX >= 11 * 1 + 3, "una línea y el borde");
  // La del modo completo: relleno (4+4) + título 12 px y datos 11 px con interlineado 1,375 + separación 2 + borde 3.
  assert.ok(FULL_CARD_MIN_HEIGHT_PX >= 8 + 12 * 1.375 + 2 + 11 * 1.375 + 3, "título, datos y borde");
});

test("duraciones de 15, 30, 45 y 60 minutos en cada pantalla: el modo sólo depende del alto y del ancho reales, y el bloque nunca se agranda ni se mueve", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const px = compactHourHeight(vh);
    const column = dayColumnWidthPx(areaWidth(vw), 7);
    for (const minutes of [15, 30, 45, 60, 90]) {
      const item = lesson("x", "12:00", minutes);
      const [p] = layoutDayItems([item], px);
      const mode = cardPresentation({ heightPx: p.height, widthPx: cardWidthPx(column, p.laneCount) });
      // posición y alto son los exactos de la duración, pase lo que pase con el texto
      assert.equal(p.top, ((12 - START_HOUR) * px), `${name} ${minutes} min: misma hora`);
      assert.equal(p.height, Math.max(4, (minutes / 60) * px - 6), `${name} ${minutes} min: misma duración`);
      assert.ok(p.hitHeight >= MIN_TARGET_PX, `${name} ${minutes} min: zona de 44 px`);
      assert.equal(p.hitHeight, Math.max(p.height, MIN_TARGET_PX));
      if (mode === "full") assert.ok(p.height >= FULL_CARD_MIN_HEIGHT_PX && cardWidthPx(column, 1) >= FULL_CARD_MIN_WIDTH_PX, `${name} ${minutes}: completo sólo si cabe`);
      if (mode === "title") assert.ok(p.height >= TITLE_CARD_MIN_HEIGHT_PX, `${name} ${minutes}: título sólo si cabe una línea`);
      if (minutes === 15) assert.equal(mode, "block", `${name}: 15 min es un bloque de color sin texto`);
    }
    // Compacta en pantallas bajas: 30 min no puede mostrar texto; 60 min a lo sumo el título
    const thirty = Math.max(4, 0.5 * px - 6);
    assert.equal(cardPresentation({ heightPx: thirty, widthPx: cardWidthPx(column, 1) }), thirty < TITLE_CARD_MIN_HEIGHT_PX ? "block" : "title", `${name}: 30 min`);
    if (px <= 48) assert.equal(cardPresentation({ heightPx: thirty, widthPx: 500 }), "block", `${name}: en pantallas bajas 30 min no muestra texto`);
  }
});

test("consecutivas, simultáneas y superpuestas: cada una elige su modo por su carril real; ninguna se oculta ni cambia de hora", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const px = compactHourHeight(vh);
    const column = dayColumnWidthPx(areaWidth(vw), 7);
    const sets: Record<string, CalendarViewItem[]> = {
      consecutivas: [lesson("a", "10:00", 30), lesson("b", "10:30", 30), lesson("c", "11:00", 30), lesson("d", "11:30", 60)],
      simultaneas: [lesson("a", "10:00", 60), lesson("b", "10:00", 60), lesson("c", "10:00", 60), lesson("d", "10:00", 60)],
      superpuestas: [lesson("a", "10:00", 90), lesson("b", "10:30", 90), lesson("c", "11:00", 90)],
      inicio: [lesson("a", "08:00", 60), lesson("b", "08:00", 15)],
      final: [lesson("a", "21:00", 60), lesson("b", "21:30", 30)],
    };
    for (const [kind, items] of Object.entries(sets)) {
      const out = layoutDayItems(items, px);
      assert.equal(out.length, items.length, `${name} ${kind}: ninguna se oculta`);
      const bottom = (END_HOUR - START_HOUR) * px;
      for (const p of out as PositionedItem[]) {
        const width = cardWidthPx(column, p.laneCount);
        const mode = cardPresentation({ heightPx: p.height, widthPx: width });
        assert.ok(["full", "title", "block"].includes(mode));
        if (mode !== "block") assert.ok(width >= TITLE_CARD_MIN_WIDTH_PX && p.height >= TITLE_CARD_MIN_HEIGHT_PX, `${name} ${kind}: ${p.item.id} muestra texto sólo si le cabe`);
        assert.equal(p.item.start, items.find((i) => i.id === p.item.id)!.start, "la clase no se mueve");
        assert.ok(p.hitHeight >= MIN_TARGET_PX && p.hitTop >= 0 && p.hitTop + p.hitHeight <= bottom + 0.001, `${name} ${kind}: zona de 44 px dentro de la grilla`);
      }
      // las zonas que se tocan quedan en carriles distintos
      for (let i = 0; i < out.length; i++)
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i];
          const b = out[j];
          if (a.hitTop < b.hitTop + b.hitHeight - 0.001 && b.hitTop < a.hitTop + a.hitHeight - 0.001) assert.notEqual(a.lane, b.lane, `${name} ${kind}: ${a.item.id} y ${b.item.id}`);
        }
    }
  }
});

test("los carriles dividen el ancho de la columna y NUNCA la ensanchan: la grilla mide exactamente el ancho disponible en cada pantalla, también con siete días y varios carriles", () => {
  for (const [name, vw] of VIEWPORTS) {
    const area = areaWidth(vw);
    const column = dayColumnWidthPx(area, 7);
    assert.ok(Math.abs(TIME_COLUMN_WIDTH_PX + 7 * column + 3 + 7 - area) < 1e-9, `${name}: horas + 7 columnas + bordes = ancho disponible (sin desplazamiento horizontal)`);
    assert.ok(gridFitsWidth(area, 7), `${name}: la grilla de siete días entra con columnas legibles`);
    assert.ok(column >= MIN_DAY_COLUMN_WIDTH_PX, `${name}: columna de ${column.toFixed(1)} px`);
    for (let lanes = 1; lanes <= 6; lanes++) {
      const card = cardWidthPx(column, lanes);
      assert.ok(card >= 0);
      // lanes tarjetas + sus márgenes ocupan exactamente la columna: el ancho nunca crece con los carriles
      assert.ok(Math.abs(lanes * (card + 2 * cardInsetPx(lanes)) - column) < 1e-9 || card === 0, `${name} ${lanes} carriles`);
    }
  }
  // la misma columna con 1 o con 6 carriles: no hay función que devuelva un ancho de columna mayor por tener carriles
  const layoutSource = code("lib/calendar/layout.ts");
  assert.doesNotMatch(layoutSource, /dayColumnMinWidth|LANE_MIN_WIDTH_PX|DAY_COLUMN_MIN_WIDTH_PX/);
});

test("si el ancho efectivo no alcanza para siete columnas legibles se usa la agenda por día; el día suelto siempre entra", () => {
  assert.equal(gridFitsWidth(areaWidth(820), 7), false, "820 px: agenda");
  assert.equal(gridFitsWidth(areaWidth(1000), 7), false, "1000 px: agenda");
  assert.equal(gridFitsWidth(TIME_COLUMN_WIDTH_PX + 7 * MIN_DAY_COLUMN_WIDTH_PX, 7), true, "justo en el umbral");
  assert.equal(gridFitsWidth(TIME_COLUMN_WIDTH_PX + 7 * MIN_DAY_COLUMN_WIDTH_PX - 1, 7), false);
  assert.equal(gridFitsWidth(areaWidth(820), 1), true, "la vista de un día entra en cualquier escritorio");
  assert.equal(gridFitsWidth(0, 7), false);
  assert.equal(dayColumnWidthPx(0, 7), 0);
  assert.equal(dayColumnWidthPx(-50, 0), 0);
});

test("cableado de la tarjeta: texto sólo dentro del bloque, líneas truncadas, nunca debajo; nombre accesible completo; tooltip con puntero y teclado; clic abre el detalle", () => {
  const card = code("components/calendar/real-lesson-card.tsx");
  const grid = card.slice(card.indexOf("export function RealLessonCard"), card.indexOf("export function RealLessonAgendaRow"));
  assert.doesNotMatch(grid, /"below"|blockOffset \+ height|\btop: blockOffset \+/, "ningún texto fuera del bloque visual");
  assert.match(grid, /presentation === "full"/);
  assert.match(grid, /presentation === "title"/);
  assert.doesNotMatch(grid, /presentation === "block"/, "el modo bloque no dibuja texto");
  // todo el texto vive dentro del bloque (overflow-hidden), cada línea se trunca y los contenedores pueden encogerse
  const block = grid.slice(grid.indexOf('aria-hidden="true"'));
  assert.match(block, /overflow-hidden rounded-md/);
  assert.equal((block.match(/truncate/g) ?? []).length >= 3, true, "título, datos y título en una línea: todos con elipsis");
  assert.equal((block.match(/min-w-0/g) ?? []).length >= 5, true);
  assert.doesNotMatch(block, /overflow-visible|whitespace-nowrap(?! )|\[overflow-wrap/, "sin desbordes visibles");
  // accesibilidad: nombre completo siempre, descripción sólo con el tooltip visible
  assert.match(grid, /aria-label=\{ariaLabelOf\(/);
  assert.match(grid, /aria-describedby=\{describedBy\}/);
  assert.doesNotMatch(grid, /title=\{fullInfo\}/, "un solo mecanismo de tooltip (el accesible), sin duplicar con title");
  assert.match(grid, /onMouseEnter=\{\(event\) => showTip\(event\.currentTarget\)\}/);
  assert.match(grid, /event\.currentTarget\.matches\(":focus-visible"\)/, "con el teclado (foco visible) también se muestra");
  assert.match(grid, /onMouseLeave=\{\(\) => onTip\?\.\(null\)\}/);
  assert.match(grid, /onBlur=\{\(\) => onTip\?\.\(null\)\}/);
  assert.match(grid, /onSelect\(\);/, "el clic sigue abriendo el detalle");
  // la zona interactiva y la geometría siguen siendo las de siempre
  assert.match(grid, /top: hitTop,\s*height: hitHeight,/);
  assert.match(grid, /top: blockOffset, height, boxSizing/);
  // tooltip de la grilla: único, con rol, se cierra con Escape y no captura el puntero
  const gridSource = code("components/calendar/real-calendar-grid.tsx");
  assert.match(gridSource, /role="tooltip"/);
  assert.match(gridSource, /pointer-events-none fixed/);
  assert.match(gridSource, /event\.key === "Escape"/);
  assert.match(gridSource, /columnWidthPx=\{columnWidthPx\}/);
  assert.match(gridSource, /dayColumnWidthPx\(areaWidthPx, dayKeys\.length\)/);
});

test("zona de agenda: sin desplazamiento horizontal en ningún modo, la grilla cede el lugar a la agenda por día cuando no entra y Densidad se oculta", () => {
  const grid = code("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /overflow-x-hidden rounded-lg/, "ni Compacta ni Media ni Amplia desplazan en horizontal");
  assert.doesNotMatch(grid, /overflow-x-auto|overflow-x-scroll|minWidth/);
  assert.match(grid, /gridFitsWidth\(areaWidthPx, dayKeys\.length\)/);
  assert.match(grid, /gridFits \? "nav:block" : ""/);
  assert.match(grid, /gridFits \? "nav:hidden" : "nav:min-h-0 nav:flex-1 nav:overflow-y-auto"/);
  assert.match(grid, /observer\.observe\(wrap\)/);
  assert.match(grid, /minmax\(0, 1fr\)/);
  assert.match(grid, /relative z-0 min-w-0 border-l/);
  const workspace = code("components/calendar/calendar-workspace.tsx");
  assert.match(workspace, /\{gridFits && <CalendarDensityPicker/);
  assert.match(workspace, /onGridFitChange=\{setGridFits\}/);
});
