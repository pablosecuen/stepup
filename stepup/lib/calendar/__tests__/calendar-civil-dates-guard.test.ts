import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guarda estructural del Calendario: la cadena que decide QUÉ DÍA es cada
 * columna/tarjeta (página → barra → grilla → tarjeta/modal → layout) no puede
 * usar getters de la zona del proceso, `toLocale*String` sin zona, ni
 * construir una fecha civil con `new Date(año, mes, día)`. En producción el
 * servidor corre en UTC y el navegador en Argentina: cualquiera de esos
 * patrones vuelve a correr todo un día y provoca hydration mismatch (#418).
 * La verificación de comportamiento está en civil-calendar*.test.ts; esto
 * sólo impide reintroducir el patrón por descuido.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const GUARDED = [
  "app/(app)/calendario/page.tsx",
  "components/calendar/real-calendar-grid.tsx",
  "components/calendar/real-calendar-toolbar.tsx",
  "components/calendar/real-lesson-card.tsx",
  "components/calendar/real-lesson-detail-modal.tsx",
  "lib/calendar/layout.ts",
  "lib/calendar/civil-calendar.ts",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: "getter local de Date (getDate/getDay/getMonth/getFullYear/getHours/getMinutes/getSeconds)", pattern: /\.get(Date|Day|Month|FullYear|Hours|Minutes|Seconds)\(/ },
  { name: "setter local de Date", pattern: /\.set(Date|Month|FullYear|Hours|Minutes|Seconds)\(/ },
  { name: "toLocaleDateString/toLocaleTimeString/toLocaleString (dependen de la zona y del ICU del entorno)", pattern: /\.toLocale(Date|Time)?String\(/ },
  { name: "new Date(año, mes, día) para transportar una fecha civil", pattern: /new Date\(\s*[^()),]+,\s*[^()),]+/ },
  { name: "new Date('YYYY-MM-DDT…') / new Date(`…T00:00:00`)", pattern: /new Date\(\s*[`'"][^`'"]*\d{4}-|new Date\(\s*`\$\{[^}]+\}T/ },
  { name: "date.slice(0, 10) de un instante (es la fecha UTC)", pattern: /\.slice\(\s*0\s*,\s*10\s*\)/ },
  { name: "86_400_000 / 86400000 (aritmética de días con milisegundos)", pattern: /86_?400_?000/ },
];

for (const relative of GUARDED) {
  test(`${relative}: no usa getters/formatos locales ni fechas civiles como Date`, () => {
    const source = stripComments(readFileSync(ROOT + relative, "utf8"));
    for (const { name, pattern } of FORBIDDEN) {
      assert.equal(pattern.test(source), false, `${relative} contiene: ${name}`);
    }
  });
}

test("grilla y barra reciben claves civiles (strings), no Date", () => {
  const grid = stripComments(readFileSync(ROOT + "components/calendar/real-calendar-grid.tsx", "utf8"));
  const gridProps = /interface RealCalendarGridProps \{([\s\S]*?)\}/.exec(grid)?.[1] ?? "";
  assert.match(gridProps, /dayKeys:\s*string\[\]/);
  assert.doesNotMatch(gridProps, /\bDate\b/, "las props de la grilla no pueden ser Date");

  const toolbar = stripComments(readFileSync(ROOT + "components/calendar/real-calendar-toolbar.tsx", "utf8"));
  const toolbarProps = /interface RealCalendarToolbarProps \{([\s\S]*?)\n\}/.exec(toolbar)?.[1] ?? "";
  assert.match(toolbarProps, /weekStartKey:\s*string/);
  assert.match(toolbarProps, /dayKey:\s*string/);
  assert.doesNotMatch(toolbarProps, /\bDate\b/, "las props de la barra no pueden ser Date");
});

test("la página resuelve la ventana con resolveCalendarWindow y consulta con instantes de la zona explícita", () => {
  const page = stripComments(readFileSync(ROOT + "app/(app)/calendario/page.tsx", "utf8"));
  assert.match(page, /resolveCalendarWindow\(params, new Date\(\)\)/);
  assert.match(page, /loadCalendarViewForRange\(ctx, new Date\(rangeStartIso\), new Date\(rangeEndIso\)\)/);
  assert.match(page, /<RealCalendarGrid dayKeys=\{dayKeys\}/);
});

test("el primer render de la grilla no depende de la hora actual (estado `now` nace en null: sin diferencia servidor/cliente)", () => {
  const grid = readFileSync(ROOT + "components/calendar/real-calendar-grid.tsx", "utf8");
  assert.match(grid, /useState<Date \| null>\(null\)/);
  assert.match(grid, /const todayKey = now \? todayDateKey\(now\) : null;/);
});
