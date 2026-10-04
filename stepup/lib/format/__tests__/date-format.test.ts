import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, relative } from "node:path";
import {
  formatCivilDate,
  formatCivilDateRange,
  formatDateValue,
  formatInstantDate,
  formatInstantDateTime,
  formatInstantDayLong,
  formatInstantDayLongTime,
  formatInstantDayShort,
  formatInstantTime,
  todayInArgentina,
} from "../date-format.ts";
import { billingPeriodOfDateKey, nextBillingPeriod } from "../../payments/dates.ts";

const AR = "America/Argentina/Buenos_Aires";

/**
 * Límites que importan: Argentina es UTC-3 (sin horario de verano), así que la medianoche argentina es 03:00 UTC y la
 * medianoche UTC es 21:00 del día anterior en Argentina. Un servidor en UTC que formatea sin zona se equivoca de día
 * entre las 21:00 y las 23:59 argentinas — justo el horario de las clases de la noche.
 */
const BOUNDARIES: { name: string; iso: string; date: string; time: string; dayShort: string; dayLong: string }[] = [
  { name: "medianoche UTC: en Argentina todavía es el día anterior (21:00)", iso: "2026-10-05T00:00:00Z", date: "04/10/2026", time: "21:00", dayShort: "dom, 4 oct", dayLong: "domingo, 4 de octubre" },
  { name: "un segundo antes de la medianoche UTC (20:59 en Argentina)", iso: "2026-10-04T23:59:59Z", date: "04/10/2026", time: "20:59", dayShort: "dom, 4 oct", dayLong: "domingo, 4 de octubre" },
  { name: "último segundo del día en Argentina (23:59:59 = 02:59:59 UTC)", iso: "2026-10-05T02:59:59Z", date: "04/10/2026", time: "23:59", dayShort: "dom, 4 oct", dayLong: "domingo, 4 de octubre" },
  { name: "medianoche de Argentina (00:00 = 03:00 UTC): cambia el día", iso: "2026-10-05T03:00:00Z", date: "05/10/2026", time: "00:00", dayShort: "lun, 5 oct", dayLong: "lunes, 5 de octubre" },
  { name: "clase de las 18:00 de Argentina (21:00 UTC)", iso: "2026-10-05T21:00:00Z", date: "05/10/2026", time: "18:00", dayShort: "lun, 5 oct", dayLong: "lunes, 5 de octubre" },
  { name: "cambio de año: 31/12 a las 23:59 en Argentina", iso: "2027-01-01T02:59:59Z", date: "31/12/2026", time: "23:59", dayShort: "jue, 31 dic", dayLong: "jueves, 31 de diciembre" },
  { name: "cambio de año: 01/01 a las 00:00 en Argentina", iso: "2027-01-01T03:00:00Z", date: "01/01/2027", time: "00:00", dayShort: "vie, 1 ene", dayLong: "viernes, 1 de enero" },
  { name: "29 de febrero (año bisiesto), antes y después de la medianoche argentina", iso: "2028-02-29T02:59:59Z", date: "28/02/2028", time: "23:59", dayShort: "lun, 28 feb", dayLong: "lunes, 28 de febrero" },
  { name: "29 de febrero a las 00:00 en Argentina", iso: "2028-02-29T03:00:00Z", date: "29/02/2028", time: "00:00", dayShort: "mar, 29 feb", dayLong: "martes, 29 de febrero" },
  { name: "septiembre usa la abreviatura de es-AR (\"sept\")", iso: "2026-09-30T15:00:00Z", date: "30/09/2026", time: "12:00", dayShort: "mié, 30 sept", dayLong: "miércoles, 30 de septiembre" },
  { name: "con milisegundos y desfase explícito (+00:00)", iso: "2026-10-05T00:00:00.500+00:00", date: "04/10/2026", time: "21:00", dayShort: "dom, 4 oct", dayLong: "domingo, 4 de octubre" },
  { name: "instante expresado en otra zona (-03:00): mismo día argentino", iso: "2026-10-04T22:30:00-03:00", date: "04/10/2026", time: "22:30", dayShort: "dom, 4 oct", dayLong: "domingo, 4 de octubre" },
];

for (const boundary of BOUNDARIES) {
  test(`límite: ${boundary.name}`, () => {
    assert.equal(formatInstantDate(boundary.iso), boundary.date);
    assert.equal(formatInstantTime(boundary.iso), boundary.time);
    assert.equal(formatInstantDateTime(boundary.iso), `${boundary.date} ${boundary.time}`);
    assert.equal(formatInstantDayShort(boundary.iso), boundary.dayShort);
    assert.equal(formatInstantDayLong(boundary.iso), boundary.dayLong);
    assert.equal(formatInstantDayLongTime(boundary.iso), `${boundary.dayLong}, ${boundary.time}`);
    // También con un `Date` (los repositorios a veces ya los traen como Date).
    assert.equal(formatInstantDate(new Date(boundary.iso)), boundary.date);
  });
}

test("el día de 'hoy' en Argentina cambia a las 03:00 UTC, no a las 00:00 UTC", () => {
  assert.equal(todayInArgentina(new Date("2026-10-05T00:00:00Z")), "2026-10-04", "00:00 UTC todavía es el 4 en Argentina (el bug de toISOString().slice(0, 10))");
  assert.equal(todayInArgentina(new Date("2026-10-05T02:59:59Z")), "2026-10-04");
  assert.equal(todayInArgentina(new Date("2026-10-05T03:00:00Z")), "2026-10-05");
  assert.equal(new Date("2026-10-05T00:00:00Z").toISOString().slice(0, 10), "2026-10-05", "lo que daba el código viejo: un día de más");
});

test("los días civiles (vencimientos, altas, períodos) se reordenan como texto: ninguna zona los corre", () => {
  assert.equal(formatCivilDate("2026-10-05"), "05/10/2026");
  assert.equal(formatCivilDate("2026-01-01"), "01/01/2026");
  assert.equal(formatCivilDate("2028-02-29"), "29/02/2028");
  assert.equal(formatCivilDateRange("2026-10-01", "2026-10-31"), "01/10/2026 a 31/10/2026");
  assert.equal(formatDateValue("2026-10-05"), "05/10/2026", "una clave civil no pasa por Date");
  assert.equal(formatDateValue("2026-10-05T00:00:00Z"), "04/10/2026", "un instante sí se convierte a su día argentino");
});

test("valores ausentes o inválidos devuelven el texto de reemplazo, nunca 'Invalid Date' ni una fecha inventada", () => {
  for (const bad of [null, undefined, "", "no es una fecha", "2026-13-45T99:99:99Z"]) {
    assert.equal(formatInstantDate(bad), "—", String(bad));
    assert.equal(formatInstantTime(bad), "—", String(bad));
    assert.equal(formatInstantDateTime(bad), "—", String(bad));
    assert.equal(formatInstantDayShort(bad), "—", String(bad));
    assert.equal(formatInstantDayLong(bad), "—", String(bad));
    assert.equal(formatInstantDayLongTime(bad), "—", String(bad));
  }
  assert.equal(formatInstantDate("basura", "Sin fecha"), "Sin fecha");
  for (const bad of [null, undefined, "", "2026-02-30", "2026-1-5", "05/10/2026", "2026-10-05T10:00"]) {
    assert.equal(formatCivilDate(bad), "—", String(bad));
  }
  assert.equal(formatCivilDateRange("2026-10-01", null), "—");
  assert.equal(formatCivilDateRange("2026-02-30", "2026-03-01"), "—");
  assert.equal(formatDateValue(null, "Sin fecha"), "Sin fecha");
});

test("instantes: sólo se interpretan con zona explícita (incluido el formato de Postgres); sin zona o con otro formato se rechazan en vez de leerse en la zona del proceso", () => {
  // Formatos que entrega la base (timestamptz) y el motor del calendario: todos son el MISMO instante.
  for (const iso of ["2026-10-04T12:52:26.584Z", "2026-10-04T12:52:26.584+00:00", "2026-10-04 12:52:26.584+00", "2026-10-04 12:52:26.584+0000", "2026-10-04T09:52:26.584-03:00", "2026-10-04T09:52:26.584-03"]) {
    assert.equal(formatInstantDateTime(iso), "04/10/2026 09:52", iso);
  }
  assert.equal(formatInstantDateTime("2026-10-04T12:52:26Z"), "04/10/2026 09:52");
  assert.equal(formatInstantDateTime("2026-10-04T12:52Z"), "04/10/2026 09:52");
  // Sin zona (ambiguo: \`new Date\` lo leería en la zona del servidor) o fuera de formato: nunca se adivina.
  for (const ambiguous of ["2026-10-04T12:52:26", "2026-10-04T12:52", "2026-10-04 12:52:26", "2026-10-4", "2026-10-5", "04/10/2026", "Oct 4 2026 12:52 UTC", "1791118346000"]) {
    assert.equal(formatInstantDateTime(ambiguous), "—", ambiguous);
    assert.equal(formatInstantDate(ambiguous), "—", ambiguous);
  }
  assert.equal(formatDateValue("2026-10-5"), "—");
  assert.equal(formatDateValue("2026-10-04"), "04/10/2026", "una clave civil sigue siendo una clave civil");
});

test("equivale a Intl es-AR con zona Argentina (las mismas abreviaturas y el mismo formato que mostraba la web antes)", () => {
  const dayShort = new Intl.DateTimeFormat("es-AR", { timeZone: AR, weekday: "short", day: "numeric", month: "short" });
  const dayLong = new Intl.DateTimeFormat("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long" });
  const date = new Intl.DateTimeFormat("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  // Un instante cada 7 h 13 min durante dos años: recorre todas las horas, días, meses, el cambio de año y el bisiesto.
  let checked = 0;
  for (let ms = Date.UTC(2027, 11, 1); ms < Date.UTC(2029, 11, 1); ms += (7 * 60 + 13) * 60_000) {
    const instant = new Date(ms);
    assert.equal(formatInstantDayShort(instant), dayShort.format(instant), instant.toISOString());
    assert.equal(formatInstantDayLong(instant), dayLong.format(instant), instant.toISOString());
    assert.equal(formatInstantDate(instant), date.format(instant), instant.toISOString());
    assert.equal(formatInstantTime(instant), time.format(instant), instant.toISOString());
    checked += 1;
  }
  assert.ok(checked > 2000);
});

// Instantes alrededor de las dos medianoches que importan (UTC y Argentina) y de fin de mes/año.
const TODAY_INSTANTS = [
  "2026-10-04T20:59:59Z", "2026-10-04T21:00:00Z", "2026-10-04T23:59:59Z", "2026-10-05T00:00:00Z", "2026-10-05T00:00:01Z",
  "2026-10-05T02:59:59Z", "2026-10-05T03:00:00Z", "2026-10-31T23:30:00Z", "2026-11-01T02:59:59Z", "2026-11-01T03:00:00Z",
  "2026-12-31T23:59:59Z", "2027-01-01T02:59:59Z", "2027-01-01T03:00:00Z", "2028-02-29T02:59:59Z", "2028-02-29T03:00:00Z",
];
const TODAY_EXPECTED = [
  "2026-10-04", "2026-10-04", "2026-10-04", "2026-10-04", "2026-10-04",
  "2026-10-04", "2026-10-05", "2026-10-31", "2026-10-31", "2026-11-01",
  "2026-12-31", "2026-12-31", "2027-01-01", "2028-02-28", "2028-02-29",
];

test("no depende de la zona del proceso: el servidor (UTC) y el navegador (Argentina, Nueva Zelanda…) producen EXACTAMENTE los mismos textos", () => {
  const modulePath = pathToFileURL(fileURLToPath(new URL("../date-format.ts", import.meta.url))).href;
  const script = `
    const m = await import(${JSON.stringify(modulePath)});
    const out = {};
    for (const iso of ${JSON.stringify(BOUNDARIES.map((b) => b.iso))}) {
      out[iso] = [m.formatInstantDate(iso), m.formatInstantTime(iso), m.formatInstantDateTime(iso), m.formatInstantDayShort(iso), m.formatInstantDayLong(iso), m.formatInstantDayLongTime(iso)];
    }
    out.today = m.todayInArgentina(new Date("2026-10-05T00:30:00Z"));
    out.todayMatrix = ${JSON.stringify(TODAY_INSTANTS)}.map((iso) => m.todayInArgentina(new Date(iso)));
    out.civil = [m.formatCivilDate("2026-10-05"), m.formatDateValue("2026-10-05"), m.formatCivilDateRange("2026-10-01", "2026-10-31")];
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (timeZone: string) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timeZone }, encoding: "utf8" });

  const expected = run("UTC");
  for (const timeZone of ["America/Argentina/Buenos_Aires", "Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
    assert.equal(run(timeZone), expected, `TZ=${timeZone}`);
  }
  const parsed = JSON.parse(expected) as Record<string, unknown>;
  assert.deepEqual(parsed["2026-10-05T00:00:00Z"], ["04/10/2026", "21:00", "04/10/2026 21:00", "dom, 4 oct", "domingo, 4 de octubre", "domingo, 4 de octubre, 21:00"]);
  assert.equal(parsed.today, "2026-10-04");
  assert.deepEqual(parsed.todayMatrix, TODAY_EXPECTED, "el día de hoy en Argentina es el mismo en el servidor (UTC) y en cualquier navegador");
});

test("los 'hoy' de cobros, alta de alumno y cambio de estado (cliente Y servidor) dan el día argentino; el recorte UTC de antes se adelantaba un día entre las 21:00 y las 23:59", () => {
  const sites = [
    "components/payments/charge-actions.tsx (fecha de pago por defecto)",
    "components/payments/charge-actions.tsx (máximo del input de fecha)",
    "components/students/student-form-fields.tsx (fecha de alta por defecto)",
    "components/students/change-status-form.tsx (fecha del cambio de estado)",
    "lib/actions/students.ts (fecha del cambio de estado en la acción del servidor)",
  ];
  const NIGHT_IN_ARGENTINA = new Date("2026-10-05T00:30:00Z"); // 21:30 del 4/10 en Argentina
  const oldUtcSlice = NIGHT_IN_ARGENTINA.toISOString().slice(0, 10);
  assert.equal(oldUtcSlice, "2026-10-05", "lo que daba el código anterior: el día SIGUIENTE (en el servidor y en el navegador por igual, porque toISOString() siempre es UTC)");
  for (const site of sites) assert.equal(todayInArgentina(NIGHT_IN_ARGENTINA), "2026-10-04", site);
  // Formato: sigue siendo YYYY-MM-DD, el valor que espera <input type="date"> y la base (columnas `date`).
  assert.match(todayInArgentina(NIGHT_IN_ARGENTINA), /^\d{4}-\d{2}-\d{2}$/);
});

test("mes de vigencia de la cuota de entrenamiento: sigue siendo 'YYYY-MM' (el valor que recibe la base) y ahora es el mes siguiente de Argentina, sin el desborde de fin de mes", () => {
  const nextMonthOf = (iso: string) => nextBillingPeriod(billingPeriodOfDateKey(todayInArgentina(new Date(iso))));
  assert.equal(nextMonthOf("2026-10-05T00:30:00Z"), "2026-11", "21:30 del 4/10 en Argentina → noviembre");
  assert.equal(nextMonthOf("2026-10-31T23:30:00Z"), "2026-11", "20:30 del 31/10 → noviembre");
  assert.equal(nextMonthOf("2026-11-01T02:59:59Z"), "2026-11", "23:59 del 31/10 en Argentina todavía es octubre → noviembre");
  assert.equal(nextMonthOf("2026-11-01T03:00:00Z"), "2026-12", "00:00 del 1/11 → diciembre");
  assert.equal(nextMonthOf("2026-12-31T23:59:59Z"), "2027-01", "cruce de año");
  // El código anterior: setMonth(+1) desbordaba (31 de enero + 1 mes = 3 de marzo, saltando febrero).
  const viejo = new Date(2026, 0, 31);
  viejo.setMonth(viejo.getMonth() + 1);
  assert.equal(viejo.getMonth(), 2, "antes: 31/01 + 1 mes caía en marzo");
  assert.equal(nextMonthOf("2026-01-31T15:00:00Z"), "2026-02", "ahora: febrero");
  for (const iso of ["2026-01-31T15:00:00Z", "2026-10-05T00:30:00Z"]) assert.match(nextMonthOf(iso), /^\d{4}-\d{2}$/);
});

test("tablas propias de días y meses: cubren los 7 días y los 12 meses en es-AR, en minúsculas, con 'sept' y sin fechas inventadas", () => {
  const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // El 12 de cada mes de 2026, al mediodía de Argentina (15:00 UTC): los 12 meses; y 7 días seguidos para los 7 días.
  for (let month = 0; month < 12; month += 1) {
    const iso = new Date(Date.UTC(2026, month, 12, 15, 0, 0)).toISOString();
    assert.match(formatInstantDayShort(iso), new RegExp(`^[a-zéáñ]+, 12 ${MONTHS_SHORT[month]}$`), iso);
    assert.ok(formatInstantDayLong(iso).endsWith(`, 12 de ${MONTHS_LONG[month]}`), iso);
  }
  const seenShort = new Set<string>();
  const seenLong = new Set<string>();
  for (let day = 4; day <= 10; day += 1) {
    const iso = new Date(Date.UTC(2026, 9, day, 15, 0, 0)).toISOString(); // 4/10/2026 es domingo
    seenShort.add(formatInstantDayShort(iso).split(",")[0]);
    seenLong.add(formatInstantDayLong(iso).split(",")[0]);
  }
  assert.deepEqual([...seenShort], WEEKDAYS_SHORT);
  assert.deepEqual([...seenLong], WEEKDAYS_LONG);

  // Todo el texto de nombres sale en minúsculas (como es-AR); la UI no capitaliza nada.
  for (const iso of ["2026-01-05T15:00:00Z", "2026-09-30T15:00:00Z", "2026-12-25T15:00:00Z"]) {
    const labels = [formatInstantDayShort(iso), formatInstantDayLong(iso), formatInstantDayLongTime(iso)];
    for (const label of labels) assert.equal(label, label.toLowerCase(), label);
  }
  // Valores inválidos: nunca un nombre de mes/día inventado ni "undefined"/"NaN".
  for (const bad of ["2026-00-10", "2026-13-10", "2026-02-30", "0000-00-00", "abc", "2026-10-5"]) {
    assert.equal(formatCivilDate(bad), "—", bad);
    assert.equal(formatDateValue(bad), "—", bad);
  }
  for (const bad of ["2026-13-10T10:00:00Z", "no-es-una-fecha", "2026-10-05T25:00:00Z"]) {
    for (const label of [formatInstantDayShort(bad), formatInstantDayLong(bad), formatInstantDayLongTime(bad), formatInstantDate(bad), formatInstantTime(bad)]) {
      assert.equal(label, "—", bad);
      assert.doesNotMatch(label, /undefined|NaN|Invalid/);
    }
  }
});

// ----------------------------------------------------------------------------------------------------------------
// Guarda estructural: nadie vuelve a formatear con la zona del proceso
// ----------------------------------------------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "__tests__" || entry === ".next") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
  });
}

const PRODUCTION_FILES = ["app", "components", "lib"].flatMap((dir) => sourceFiles(join(ROOT, dir)));

/** Argumentos (texto) de la llamada cuyo paréntesis de apertura está en `openIndex`. */
function callArguments(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1);
}

const DATE_TIME_OPTION = /\b(weekday|era|year|month|day|hour|minute|second|fractionalSecondDigits|dayPeriod|dateStyle|timeStyle|timeZoneName|hour12|hourCycle)\s*:/;

/**
 * Formatos de FECHA/HORA que usan la zona del proceso. Deliberadamente acotada: `toLocaleString` con números o moneda
 * (`(1500).toLocaleString("es-AR")`, `{ style: "currency" }`) y `Intl.NumberFormat` NO se tocan.
 *  - `.toLocaleDateString(` / `.toLocaleTimeString(`: siempre (sólo existen para fechas).
 *  - `.toLocaleString(` sólo si lleva opciones de fecha/hora, o si el receptor es un `Date(...)`.
 *  - `Intl.DateTimeFormat(` sólo si no fija `timeZone`.
 */
export function findProcessZoneDateFormats(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\.toLocale(Date|Time)String\(/g)) found.push(match[0]);
  for (const match of source.matchAll(/\.toLocaleString\(/g)) {
    const index = match.index ?? 0;
    const open = index + match[0].length - 1;
    const receiver = source.slice(Math.max(0, index - 80), index);
    if (DATE_TIME_OPTION.test(callArguments(source, open)) || /\bDate\([^()]*\)\s*$/.test(receiver)) found.push(".toLocaleString( con fecha/hora");
  }
  for (const match of source.matchAll(/Intl\.DateTimeFormat\(/g)) {
    const index = match.index ?? 0;
    const open = index + match[0].length - 1;
    if (!/\btimeZone\b/.test(callArguments(source, open))) found.push("Intl.DateTimeFormat( sin timeZone");
  }
  return found;
}

test("guarda: ningún archivo de producción formatea FECHAS u HORAS con la zona del proceso — todo pasa por lib/format/date-format.ts", () => {
  const offenders = PRODUCTION_FILES.filter((file) => findProcessZoneDateFormats(readFileSync(file, "utf8")).length > 0).map((file) => relative(ROOT, file));
  assert.deepEqual(offenders, []);
});

test("la guarda detecta los formatos de fecha/hora sin zona y deja pasar los usos legítimos (números, moneda, Intl con timeZone)", () => {
  const BAD = [
    'new Date(x).toLocaleDateString("es-AR")',
    "d.toLocaleTimeString()",
    'new Date(x).toLocaleString("es-AR")',
    'item.when.toLocaleString("es-AR", { weekday: "long", hour: "2-digit" })',
    'new Intl.DateTimeFormat("es-AR", { hour: "2-digit" }).format(d)',
    'new Intl.DateTimeFormat("es-AR").format(d)',
    'x.toLocaleString(undefined, { dateStyle: "short" })',
  ];
  const GOOD = [
    '(1234.5).toLocaleString("es-AR")',
    'amount.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })',
    'count.toLocaleString("es-AR", { minimumFractionDigits: 2 })',
    'new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n)',
    'new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(d)',
    'new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit" }).format(d)',
    'name.toLocaleLowerCase("es")',
    'const label = "toLocaleDateString";',
  ];
  for (const snippet of BAD) assert.ok(findProcessZoneDateFormats(snippet).length > 0, `debería detectarse: ${snippet}`);
  for (const snippet of GOOD) assert.deepEqual(findProcessZoneDateFormats(snippet), [], `no debería detectarse: ${snippet}`);
});

test("guarda: ningún archivo de producción calcula 'hoy' con toISOString().slice(0, 10) (es el día en UTC)", () => {
  const offenders = PRODUCTION_FILES.filter((file) => /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file));
  assert.deepEqual(offenders, []);
});

test("guarda: las fechas civiles de cobros, recordatorios, perfil y disponibilidad no se muestran como texto crudo YYYY-MM-DD", () => {
  const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
  assert.doesNotMatch(read("app/(app)/cobros/page.tsx"), /vence \{entry\.dueDate\}/);
  assert.doesNotMatch(read("components/students/profile/cobros-tab.tsx"), /Vence \{charge\.dueDate\}|\{payment\.paidAt\}/);
  assert.doesNotMatch(read("components/payments/training-billing-config.tsx"), /vence \{c\.dueDate\}/);
  assert.doesNotMatch(read("lib/dashboard/reminders-center.ts"), /vence \$\{entry\.dueDate\}/);
  assert.doesNotMatch(read("components/students/profile/reportes-tab.tsx"), /\{record\.periodStart\} a \{record\.periodEnd\}|\{preview\.periodStart\} a \{preview\.periodEnd\}/);
  assert.doesNotMatch(read("app/(app)/calendario/disponibilidad/availability-editor.tsx"), /\{exception\.date\}\s*\n?\s*\{exception\.endDate \? ` – \$\{exception\.endDate\}`/);
});
