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
  MIN_TEXT_HEIGHT_PX,
  START_HOUR,
  STACK_CARD_MIN_HEIGHT_PX,
  STACK_CARD_MIN_WIDTH_PX,
  TIME_COLUMN_WIDTH_PX,
  TITLE_CARD_MIN_HEIGHT_PX,
  TITLE_CARD_MIN_WIDTH_PX,
  cardGapPx,
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

/** Pantallas del bloque: ancho de la ventana (CSS px, ya con el zoom aplicado) → ancho útil de la zona de agenda (barra de 236 + relleno 2×24 y máximo 1360). */
const areaWidth = (viewportCssPx: number) => Math.min(1360, viewportCssPx - 236) - 48;
const VIEWPORTS: Array<[string, number, number]> = [
  ["1366×768 al 100 %", 1366, 768],
  ["1366×768 al 125 %", 1366 / 1.25, 768 / 1.25],
  ["1440×900 al 100 %", 1440, 900],
  ["1440×900 al 125 %", 1440 / 1.25, 900 / 1.25],
  ["1920×1080 al 100 %", 1920, 1080],
];
/** Alto por hora de Compacta en esa pantalla: lo que arriba del eje ocupan el encabezado y los controles (≈ 209 px medidos) y 16 px de relleno inferior. */
const compactHourHeight = (viewportHeightCssPx: number) => fitHourHeight({ availablePx: viewportHeightCssPx - 209 - 16 + 47, fixedPx: 50, hours: HOURS.length }).hourHeightPx;

test("cardPresentation: cuatro modos según el tamaño real; los umbrales son exactos y nada depende del contenido", () => {
  assert.equal(cardPresentation({ heightPx: FULL_CARD_MIN_HEIGHT_PX, widthPx: FULL_CARD_MIN_WIDTH_PX }), "full");
  assert.equal(cardPresentation({ heightPx: FULL_CARD_MIN_HEIGHT_PX - 0.01, widthPx: 300 }), "stack", "un poco bajo para el modo completo: dos líneas apretadas");
  assert.equal(cardPresentation({ heightPx: 300, widthPx: FULL_CARD_MIN_WIDTH_PX - 0.01 }), "stack", "angosta pero alta: nombre y hora, una debajo de otra");
  assert.equal(cardPresentation({ heightPx: STACK_CARD_MIN_HEIGHT_PX, widthPx: STACK_CARD_MIN_WIDTH_PX }), "stack");
  assert.equal(cardPresentation({ heightPx: STACK_CARD_MIN_HEIGHT_PX - 0.01, widthPx: 300 }), "title", "no entran dos líneas: una sola línea");
  assert.equal(cardPresentation({ heightPx: 300, widthPx: STACK_CARD_MIN_WIDTH_PX - 0.01 }), "title", "demasiado angosta para la hora: una sola línea con las iniciales");
  assert.equal(cardPresentation({ heightPx: TITLE_CARD_MIN_HEIGHT_PX, widthPx: TITLE_CARD_MIN_WIDTH_PX }), "title");
  assert.equal(cardPresentation({ heightPx: TITLE_CARD_MIN_HEIGHT_PX - 0.01, widthPx: 300 }), "block", "muy bajo: bloque de color");
  assert.equal(cardPresentation({ heightPx: 300, widthPx: TITLE_CARD_MIN_WIDTH_PX - 0.01 }), "block", "muy angosto: bloque de color");
  for (const bad of [NaN, -1, 0]) {
    assert.equal(cardPresentation({ heightPx: bad, widthPx: 100 }), "block", String(bad));
    assert.equal(cardPresentation({ heightPx: 100, widthPx: bad }), "block", String(bad));
  }
  // Los umbrales salen de las líneas reales: una línea (11 px de letra, interlineado 13) + borde de 1 px; dos líneas (11/13 y 10/12) + borde; completa (12/14 y 11/13) + borde de 1,5 px y 2 px de aire.
  assert.ok(TITLE_CARD_MIN_HEIGHT_PX >= 13 + 2, "una línea y el borde");
  assert.ok(STACK_CARD_MIN_HEIGHT_PX >= 13 + 12 + 2, "dos líneas y el borde");
  assert.ok(FULL_CARD_MIN_HEIGHT_PX >= 14 + 13 + 3 + 2, "título, datos, borde y aire");
  assert.equal(MIN_TEXT_HEIGHT_PX, TITLE_CARD_MIN_HEIGHT_PX, "el piso de lectura de una clase de 30 minutos es exactamente el de una línea de texto");
});

test("Compacta en cada pantalla: TODA clase de 30 minutos o más muestra su nombre; la de 15 minutos conserva su alto exacto; la hora y la duración nunca se mueven", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const px = compactHourHeight(vh);
    const column = dayColumnWidthPx(areaWidth(vw), 7);
    for (const minutes of [15, 30, 45, 60, 90]) {
      const [p] = layoutDayItems([lesson("x", "12:00", minutes)], px);
      const mode = cardPresentation({ heightPx: p.height, widthPx: cardWidthPx(column, p.laneCount) });
      assert.equal(p.top, (12 - START_HOUR) * px, `${name} ${minutes} min: misma hora`);
      const exact = Math.max(4, (minutes / 60) * px - cardGapPx(px));
      assert.equal(p.height, minutes >= 30 ? Math.max(MIN_TEXT_HEIGHT_PX, exact) : exact, `${name} ${minutes} min: misma duración (con el piso de lectura desde 30 min)`);
      assert.ok(p.hitHeight >= p.height - 0.001 && p.hitHeight >= 44 - 0.001, `${name} ${minutes} min: sin vecinos la zona llega a 44 px`);
      if (minutes >= 30) assert.notEqual(mode, "block", `${name}: ${minutes} min se lee (modo ${mode})`);
      if (minutes >= 60 && px >= 35) assert.ok(mode === "full" || mode === "stack", `${name}: 60 min muestra nombre y hora`);
      if (minutes === 15) assert.equal(p.height, exact, `${name}: 15 min no se estira`);
    }
  }
});

test("consecutivas, simultáneas y superpuestas: ninguna se oculta ni cambia de hora; las consecutivas comparten ancho completo y todas muestran su nombre", () => {
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
        assert.equal(p.item.start, items.find((i) => i.id === p.item.id)!.start, "la clase no se mueve");
        assert.ok(p.hitTop >= 0 && p.hitTop + p.hitHeight <= bottom + 0.001, `${name} ${kind}: zona dentro de la grilla`);
        const minutes = (Date.parse(p.item.end) - Date.parse(p.item.start)) / 60_000;
        if (minutes >= 30) assert.notEqual(mode, "block", `${name} ${kind}: ${p.item.id} (${minutes} min, ${p.laneCount} carriles, ${width.toFixed(0)} px) muestra su nombre`);
      }
      if (kind === "consecutivas") assert.ok(out.every((p) => p.laneCount === 1), `${name}: las consecutivas no se reparten carriles`);
      // las zonas que se tocan no se pisan: o están en franjas distintas o una termina donde empieza la otra
      for (let i = 0; i < out.length; i++)
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i];
          const b = out[j];
          const sameStrip = a.lane / a.laneCount < (b.lane + 1) / b.laneCount - 1e-9 && b.lane / b.laneCount < (a.lane + 1) / a.laneCount - 1e-9;
          const overlap = a.hitTop < b.hitTop + b.hitHeight - 1.001 && b.hitTop < a.hitTop + a.hitHeight - 1.001;
          if (sameStrip && overlap) assert.fail(`${name} ${kind}: ${a.item.id} y ${b.item.id} se pisan`);
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
  assert.match(grid, /presentation === "stack"/);
  assert.match(grid, /presentation === "title"/);
  assert.doesNotMatch(grid, /presentation === "block"/, "el modo bloque no dibuja texto");
  // todo el texto vive dentro del bloque (overflow-hidden), cada línea se trunca y los contenedores pueden encogerse
  const block = grid.slice(grid.indexOf('aria-hidden="true"'));
  assert.match(block, /overflow-hidden rounded-md/);
  assert.equal((block.match(/truncate/g) ?? []).length >= 4, true, "nombre y datos de cada modo: todos con elipsis");
  assert.equal((block.match(/min-w-0/g) ?? []).length >= 5, true);
  assert.doesNotMatch(block, /overflow-visible|whitespace-nowrap(?! )|\[overflow-wrap/, "sin desbordes visibles");
  // el nombre se escribe según el ancho (completo, primera palabra, iniciales) y el estado importante nunca depende sólo del color
  assert.match(grid, /nameForWidth\(title, cardWidth\)/);
  assert.match(grid, /narrowMeta\(\{ timeLabel, facts: stateFacts \}\)/);
  assert.match(grid, /wideMeta\(\{ timeLabel, groupSize, tags: stateTexts \}\)/);
  assert.match(grid, /<UserGroupIcon/, "las clases grupales llevan su ícono");
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
  // Compacta sigue siendo la densidad por defecto: la corrección no cambia la escala ni obliga a usar Media.
  const density = code("lib/calendar/density.ts");
  assert.match(density, /DEFAULT_CALENDAR_DENSITY: CalendarDensityKey = "compact"/);
});
