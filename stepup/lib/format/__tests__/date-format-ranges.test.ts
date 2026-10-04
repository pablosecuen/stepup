import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatCivilDayRange, formatCivilMonth, formatCivilWeek } from "../date-format.ts";

/**
 * Seguimiento de B1: encabezado semanal del Calendario ("28 sept – 4 oct 2026") y mes civil del Resumen financiero
 * ("septiembre de 2026"). Ambos son claves civiles: nunca pasan por `Date` ni por la zona del proceso.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (relative: string) => readFileSync(ROOT + relative, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("semana dentro de un mismo mes: no repite mes ni año", () => {
  assert.equal(formatCivilWeek("2026-10-05"), "5 – 11 oct 2026");
  assert.equal(formatCivilWeek("2026-10-12"), "12 – 18 oct 2026");
  assert.equal(formatCivilWeek("2026-09-07"), "7 – 13 sept 2026", "septiembre se abrevia 'sept' (como es-AR)");
  assert.equal(formatCivilWeek("2026-10-26"), "26 oct – 1 nov 2026", "la semana 26/10 cruza de mes aunque empiece en el mismo mes que casi termina");
  assert.equal(formatCivilDayRange("2026-10-05", "2026-10-05"), "5 oct 2026", "un rango de un solo día se muestra como ese día");
});

test("semana que cruza de mes: muestra los dos meses y un solo año", () => {
  assert.equal(formatCivilWeek("2026-09-28"), "28 sept – 4 oct 2026", "el caso reportado");
  assert.equal(formatCivilWeek("2026-08-31"), "31 ago – 6 sept 2026");
  assert.equal(formatCivilWeek("2026-06-29"), "29 jun – 5 jul 2026");
  assert.equal(formatCivilWeek("2026-04-27"), "27 abr – 3 may 2026");
});

test("semana que cruza de año: muestra el año en los dos extremos", () => {
  assert.equal(formatCivilWeek("2026-12-28"), "28 dic 2026 – 3 ene 2027");
  assert.equal(formatCivilWeek("2025-12-29"), "29 dic 2025 – 4 ene 2026");
  assert.equal(formatCivilWeek("2027-12-27"), "27 dic 2027 – 2 ene 2028");
  assert.equal(formatCivilWeek("2028-12-25"), "25 – 31 dic 2028", "una semana que termina el 31/12 NO cruza de año");
});

test("febrero bisiesto (2028) y no bisiesto (2026): el 29/02 existe sólo en el bisiesto", () => {
  assert.equal(formatCivilWeek("2028-02-21"), "21 – 27 feb 2028");
  assert.equal(formatCivilWeek("2028-02-28"), "28 feb – 5 mar 2028", "bisiesto: 28, 29/02, 1, 2, 3, 4 y 5/03");
  assert.equal(formatCivilWeek("2028-02-26"), "26 feb – 3 mar 2028", "bisiesto: 26, 27, 28, 29/02, 1, 2 y 3/03");
  assert.equal(formatCivilWeek("2026-02-23"), "23 feb – 1 mar 2026", "no bisiesto: 28/02 es el último día");
  assert.equal(formatCivilWeek("2026-02-26"), "26 feb – 4 mar 2026");
  assert.equal(formatCivilDayRange("2028-02-29", "2028-03-01"), "29 feb – 1 mar 2028");
  assert.equal(formatCivilWeek("2026-02-29"), "—", "el 29/02/2026 no existe");
  assert.equal(formatCivilWeek("2027-02-29"), "—", "el 29/02/2027 no existe");
});

test("barrido: 4 años de lunes coinciden con un cálculo independiente (aritmética de días en UTC puro)", () => {
  const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  let checked = 0;
  for (let ms = Date.UTC(2025, 0, 6); ms < Date.UTC(2029, 0, 1); ms += 7 * 86_400_000) {
    const start = new Date(ms);
    const end = new Date(ms + 6 * 86_400_000);
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
    let expected: string;
    if (start.getUTCFullYear() !== end.getUTCFullYear()) expected = `${start.getUTCDate()} ${SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${end.getUTCDate()} ${SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    else if (start.getUTCMonth() !== end.getUTCMonth()) expected = `${start.getUTCDate()} ${SHORT[start.getUTCMonth()]} – ${end.getUTCDate()} ${SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    else expected = `${start.getUTCDate()} – ${end.getUTCDate()} ${SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    assert.equal(formatCivilWeek(key), expected, key);
    checked += 1;
  }
  assert.ok(checked > 200);
});

test("rango y semana inválidos: '—', nunca 'Invalid Date' ni una fecha inventada", () => {
  for (const bad of [null, undefined, "", "2026-13-01", "2026-00-10", "2026-10-32", "2026-9-28", "28/09/2026", "2026-09-28T00:00:00Z", "no es una fecha"]) {
    assert.equal(formatCivilWeek(bad), "—", String(bad));
  }
  assert.equal(formatCivilDayRange("2026-10-05", null), "—");
  assert.equal(formatCivilDayRange(undefined, "2026-10-05"), "—");
  assert.equal(formatCivilDayRange("2026-10-11", "2026-10-05"), "—", "el fin anterior al inicio no es un rango");
  assert.equal(formatCivilWeek("2026-13-01", "s/d"), "s/d", "texto de reemplazo propio");
});

test("mes civil: 'YYYY-MM' → 'septiembre de 2026', los 12 meses, sin Date", () => {
  assert.equal(formatCivilMonth("2026-09"), "septiembre de 2026", "el caso reportado");
  const LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  LONG.forEach((name, index) => assert.equal(formatCivilMonth(`2027-${String(index + 1).padStart(2, "0")}`), `${name} de 2027`));
  assert.equal(formatCivilMonth("2028-02"), "febrero de 2028", "febrero (bisiesto) es un mes más");
  assert.equal(formatCivilMonth("2026-12"), "diciembre de 2026");
  assert.equal(formatCivilMonth("2027-01"), "enero de 2027");
});

test("mes inválido: '—' (y el texto de reemplazo propio, si se pide)", () => {
  for (const bad of [null, undefined, "", "2026-00", "2026-13", "2026-9", "2026-009", "26-09", "20260-09", "2026/09", "2026-09-15", "2026-09-01T00:00:00Z", " 2026-09", "2026-09 ", "septiembre", "2026-aa", "NaN-NaN"]) {
    assert.equal(formatCivilMonth(bad), "—", JSON.stringify(bad));
  }
  assert.equal(formatCivilMonth("2026-13", "sin dato"), "sin dato");
});

test("empates de 'mes con más altas': cada mes se formatea por separado y uno inválido no rompe a los otros", () => {
  assert.equal(["2026-03", "2026-07"].map((month) => formatCivilMonth(month)).join(", "), "marzo de 2026, julio de 2026");
  assert.equal(["2026-03", "2026-99"].map((month) => formatCivilMonth(month)).join(", "), "marzo de 2026, —");
});

test("consistencia: el servidor (UTC) y el navegador (Argentina y otras zonas) producen EXACTAMENTE los mismos textos", () => {
  const modulePath = pathToFileURL(fileURLToPath(new URL("../date-format.ts", import.meta.url))).href;
  const script = `
    const m = await import(${JSON.stringify(modulePath)});
    const out = { weeks: [], months: [], ranges: [] };
    // Todos los lunes de 2026-2029 (cruces de mes, de año y febrero bisiesto) y las 12 mensualidades de 2026-2028.
    for (let ms = Date.UTC(2026, 0, 5); ms < Date.UTC(2030, 0, 1); ms += 7 * 86400000) {
      const d = new Date(ms);
      out.weeks.push(m.formatCivilWeek(d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0")));
    }
    for (const y of [2026, 2027, 2028]) for (let mo = 1; mo <= 13; mo += 1) out.months.push(m.formatCivilMonth(y + "-" + String(mo).padStart(2, "0")));
    out.ranges.push(m.formatCivilDayRange("2028-02-28", "2028-03-01"), m.formatCivilDayRange("2026-12-31", "2027-01-01"), m.formatCivilWeek("2026-02-30"));
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (timeZone: string) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timeZone }, encoding: "utf8" });
  const expected = run("UTC");
  for (const timeZone of ["America/Argentina/Buenos_Aires", "Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
    assert.equal(run(timeZone), expected, `TZ=${timeZone}`);
  }
  const parsed = JSON.parse(expected) as { weeks: string[]; months: string[]; ranges: string[] };
  assert.ok(parsed.weeks.includes("28 sept – 4 oct 2026"));
  assert.ok(parsed.weeks.includes("28 dic 2026 – 3 ene 2027"));
  assert.ok(parsed.weeks.includes("28 feb – 5 mar 2028"));
  assert.equal(parsed.months[8], "septiembre de 2026");
  assert.equal(parsed.months[12], "—", "el mes 13 no existe");
  assert.deepEqual(parsed.ranges, ["28 feb – 1 mar 2028", "31 dic 2026 – 1 ene 2027", "—"]);
});

test("cableado: el Calendario y el Resumen financiero usan el formateador único y la UI ya no capitaliza el texto", () => {
  const toolbar = source("components/calendar/real-calendar-toolbar.tsx");
  assert.match(toolbar, /formatCivilWeek\(weekStartKey\)/, "el encabezado semanal sale de formatCivilWeek");
  assert.doesNotMatch(toolbar, /\bcapitalize\b/, "text-transform: capitalize convertía 'de' en 'De' y 'oct' en 'Oct'");
  assert.match(toolbar, /first-letter:uppercase/, "sólo la primera letra del rótulo del día va en mayúscula");

  const civil = source("lib/calendar/civil-calendar.ts");
  assert.doesNotMatch(civil, /formatWeekRangeLabel/, "ya no existe un segundo formateador semanal");

  const summary = source("app/(app)/resumen-financiero/page.tsx");
  assert.match(summary, /formatCivilMonth\(month\)/, "cada mes pico se formatea");
  assert.doesNotMatch(summary, /peakMonths\.join\(/, "nunca se muestra 'YYYY-MM' en crudo");

  const formatter = source("lib/format/date-format.ts");
  const monthFn = /export function formatCivilMonth[\s\S]*?\n}\n/.exec(formatter)?.[0] ?? "";
  assert.ok(monthFn.length > 0);
  assert.doesNotMatch(monthFn, /new Date|Intl|toLocale/, "el mes civil no pasa por Date ni por la zona");
});
