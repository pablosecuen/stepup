import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_TIMEZONE,
  dayRangeInstants,
  formatCivilDayLabel,
  formatCivilDayLabelShort,
  formatWeekRangeLabel,
  instantDateKey,
  instantMinutesOfDay,
  instantTimeLabel,
  mondayOfWeek,
  parseCivilDateKey,
  resolveCalendarWindow,
  todayDateKey,
  weekDateKeys,
  weekdayIndexMondayFirst,
} from "../civil-calendar.ts";
import { getLocalDateKey, getLocalTimeKey } from "../timezone.ts";
import { groupItemsByDayKey, layoutDayItems, currentTimeTop } from "../layout.ts";
import type { CalendarViewItem } from "../occurrences.ts";

const BA = CALENDAR_TIMEZONE;
// Sábado 3/oct/2026 17:07 en Buenos Aires (UTC-3) = 20:07Z
const SAT_AFTERNOON = new Date("2026-10-03T20:07:00.000Z");

test("semana 28-sep → 4-oct: siete claves civiles lunes→domingo, sin Date de por medio", () => {
  const win = resolveCalendarWindow({}, SAT_AFTERNOON);
  assert.deepEqual(win.dayKeys, ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(win.weekStartKey, "2026-09-28");
  assert.equal(win.todayKey, "2026-10-03");
  for (const key of win.dayKeys) assert.equal(typeof key, "string");
  assert.deepEqual(
    win.dayKeys.map((key) => weekdayIndexMondayFirst(key)),
    [0, 1, 2, 3, 4, 5, 6],
    "lunes=0 … domingo=6"
  );
});

test("lunes y domingo: el domingo pertenece a la semana que termina en él; el lunes abre la siguiente", () => {
  assert.equal(mondayOfWeek("2026-09-28"), "2026-09-28", "lunes → él mismo");
  assert.equal(mondayOfWeek("2026-10-04"), "2026-09-28", "domingo → lunes anterior (no el siguiente)");
  assert.equal(mondayOfWeek("2026-10-05"), "2026-10-05", "el lunes siguiente abre otra semana");
  assert.equal(mondayOfWeek("2026-10-03"), "2026-09-28", "sábado");
});

test("límites de mes y año: 28-dic-2026 → 3-ene-2027 y fin de febrero", () => {
  assert.deepEqual(weekDateKeys("2026-12-28"), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  assert.equal(formatWeekRangeLabel("2026-12-28"), "28 - 03-ene de enero de 2027");
  assert.deepEqual(weekDateKeys("2028-02-28"), ["2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03", "2028-03-04", "2028-03-05"], "2028 es bisiesto");
  assert.deepEqual(weekDateKeys("2026-02-23").slice(-2), ["2026-02-28", "2026-03-01"], "2026 no es bisiesto");
});

test("rótulos: mismo formato que antes (sin Intl, idénticos en cualquier locale/zona)", () => {
  assert.equal(formatWeekRangeLabel("2026-09-28"), "28 - 04-oct de octubre de 2026");
  assert.equal(formatWeekRangeLabel("2026-10-05"), "05 - 11 de octubre de 2026");
  assert.equal(formatWeekRangeLabel("2026-08-31"), "31 - 06-sept de septiembre de 2026");
  assert.equal(formatCivilDayLabel("2026-10-03"), "sábado, 3 de octubre de 2026");
  assert.equal(formatCivilDayLabel("2026-10-04"), "domingo, 4 de octubre de 2026");
  assert.equal(formatCivilDayLabelShort("2026-10-04"), "domingo, 4 de octubre");
});

test("navegación semanal: anterior/siguiente son lunes civiles exactos (±7 días), nunca domingos", () => {
  const win = resolveCalendarWindow({ week: "2026-09-28" }, SAT_AFTERNOON);
  assert.equal(win.previousKey, "2026-09-21");
  assert.equal(win.nextKey, "2026-10-05");
  const next = resolveCalendarWindow({ week: win.nextKey }, SAT_AFTERNOON);
  assert.equal(next.weekStartKey, "2026-10-05");
  assert.equal(next.dayKeys[0], "2026-10-05");
  assert.equal(next.dayKeys[6], "2026-10-11");
  assert.equal(resolveCalendarWindow({ week: "2026-12-28" }, SAT_AFTERNOON).nextKey, "2027-01-04", "cruza el año");
  const day = resolveCalendarWindow({ view: "day", day: "2026-10-31" }, SAT_AFTERNOON);
  assert.deepEqual([day.previousKey, day.nextKey], ["2026-10-30", "2026-11-01"], "vista de día cruza el mes");
  assert.deepEqual(day.dayKeys, ["2026-10-31"]);
});

test("un week que no es lunes (enlaces viejos con claves en domingo) se normaliza al lunes de su semana", () => {
  assert.equal(resolveCalendarWindow({ week: "2026-10-04" }, SAT_AFTERNOON).weekStartKey, "2026-09-28");
  assert.equal(resolveCalendarWindow({ week: "2026-09-27" }, SAT_AFTERNOON).weekStartKey, "2026-09-21");
});

test("parámetros inválidos caen a hoy: formato, fecha inexistente, vacío", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "abc", "", "2026-1-1", "2026-10-03T00:00:00Z", undefined]) {
    assert.equal(parseCivilDateKey(bad), null, String(bad));
    assert.equal(resolveCalendarWindow({ week: bad }, SAT_AFTERNOON).weekStartKey, "2026-09-28", `week=${bad}`);
    assert.equal(resolveCalendarWindow({ view: "day", day: bad }, SAT_AFTERNOON).dayKey, "2026-10-03", `day=${bad}`);
  }
  assert.equal(parseCivilDateKey("2028-02-29"), "2028-02-29");
});

test("hoy cerca del cambio de día: se calcula en Buenos Aires, no en UTC", () => {
  // 23:30 del sábado en BA ya es domingo 02:30Z — en UTC "hoy" sería el domingo.
  assert.equal(todayDateKey(new Date("2026-10-04T02:30:00.000Z")), "2026-10-03");
  assert.equal(todayDateKey(new Date("2026-10-04T02:59:59.999Z")), "2026-10-03", "último milisegundo del sábado");
  assert.equal(todayDateKey(new Date("2026-10-04T03:00:00.000Z")), "2026-10-04", "medianoche en BA: domingo");
  assert.equal(todayDateKey(new Date("2026-10-05T02:59:59.999Z")), "2026-10-04", "último milisegundo del domingo");
  assert.equal(todayDateKey(new Date("2026-10-05T03:00:00.000Z")), "2026-10-05", "lunes");
  assert.equal(resolveCalendarWindow({}, new Date("2026-10-05T02:59:59.999Z")).weekStartKey, "2026-09-28", "domingo 23:59 sigue en la semana 28-sep");
  assert.equal(resolveCalendarWindow({}, new Date("2026-10-05T03:00:00.000Z")).weekStartKey, "2026-10-05", "lunes 00:00 abre la semana siguiente");
  assert.equal(todayDateKey(new Date("2027-01-01T02:59:59.999Z")), "2026-12-31", "cruce de año");
});

test("rango consultado: incluye todo el domingo y nada del lunes siguiente ni del domingo anterior", () => {
  const win = resolveCalendarWindow({}, SAT_AFTERNOON);
  assert.equal(win.rangeStartIso, "2026-09-28T03:00:00.000Z", "lunes 00:00 en BA");
  assert.equal(win.rangeEndIso, "2026-10-05T02:59:59.999Z", "domingo 23:59:59.999 en BA (incluye el último segundo)");
  const inRange = (iso: string) => iso >= win.rangeStartIso && iso <= win.rangeEndIso;
  assert.equal(inRange("2026-10-05T02:30:00.000Z"), true, "domingo 4/oct 23:30 en BA entra");
  assert.equal(inRange("2026-10-04T15:00:00.000Z"), true, "domingo 12:00 entra");
  assert.equal(inRange("2026-10-05T03:00:00.000Z"), false, "lunes 5/oct 00:00 en BA NO entra");
  assert.equal(inRange("2026-09-28T02:59:59.999Z"), false, "domingo 27/sep 23:59 NO entra");
  assert.equal(inRange("2026-09-28T03:00:00.000Z"), true, "lunes 28/sep 00:00 entra");
  // Antes (rango armado en UTC) el rango real en BA era dom 27 21:00 → dom 4 20:59: dejaba afuera el domingo tarde.
  assert.equal(getLocalDateKey(win.rangeStartIso, BA), "2026-09-28");
  assert.equal(getLocalTimeKey(win.rangeStartIso, BA), "00:00");
  assert.equal(getLocalDateKey(win.rangeEndIso, BA), "2026-10-04");
  assert.equal(getLocalTimeKey(win.rangeEndIso, BA), "23:59");
});

test("vista de día: el rango cubre exactamente ese día civil", () => {
  const win = resolveCalendarWindow({ view: "day", day: "2026-10-04" }, SAT_AFTERNOON);
  assert.deepEqual(win.dayKeys, ["2026-10-04"]);
  assert.equal(win.rangeStartIso, "2026-10-04T03:00:00.000Z");
  assert.equal(win.rangeEndIso, "2026-10-05T02:59:59.999Z");
});

test("zonas horarias negativas (y positivas): las claves y el rango siguen siendo el día civil de ESA zona", () => {
  const cases: Array<{ zone: string; now: string; today: string }> = [
    { zone: "America/Argentina/Buenos_Aires", now: "2026-10-04T02:30:00.000Z", today: "2026-10-03" },
    { zone: "America/Los_Angeles", now: "2026-10-04T05:30:00.000Z", today: "2026-10-03" }, // UTC-7
    { zone: "Pacific/Honolulu", now: "2026-10-04T09:30:00.000Z", today: "2026-10-03" }, // UTC-10
    { zone: "Asia/Tokyo", now: "2026-10-03T15:30:00.000Z", today: "2026-10-04" }, // UTC+9
    { zone: "Pacific/Kiritimati", now: "2026-10-03T10:30:00.000Z", today: "2026-10-04" }, // UTC+14
  ];
  for (const { zone, now, today } of cases) {
    const win = resolveCalendarWindow({}, new Date(now), zone);
    assert.equal(win.todayKey, today, `${zone}: hoy`);
    assert.equal(win.dayKeys.length, 7, zone);
    assert.equal(win.dayKeys[0], "2026-09-28", `${zone}: semana del 28-sep`);
    assert.equal(win.dayKeys[6], "2026-10-04", zone);
    assert.equal(getLocalDateKey(win.rangeStartIso, zone), "2026-09-28", `${zone}: inicio del rango`);
    assert.equal(getLocalTimeKey(win.rangeStartIso, zone), "00:00", zone);
    assert.equal(getLocalDateKey(win.rangeEndIso, zone), "2026-10-04", `${zone}: fin del rango`);
    assert.equal(getLocalTimeKey(win.rangeEndIso, zone), "23:59", zone);
  }
});

test("dayRangeInstants con horario de verano (semana del cambio en Los Ángeles): sigue arrancando y terminando a medianoche civil", () => {
  // 1/nov/2026 termina el horario de verano en EE. UU.: la semana tiene 7 días civiles pero 169 horas.
  const { startIso, endIso } = dayRangeInstants("2026-10-26", "2026-11-01", "America/Los_Angeles");
  assert.equal(getLocalTimeKey(startIso, "America/Los_Angeles"), "00:00");
  assert.equal(getLocalDateKey(endIso, "America/Los_Angeles"), "2026-11-01");
  assert.equal(getLocalTimeKey(endIso, "America/Los_Angeles"), "23:59");
  assert.equal((Date.parse(endIso) + 1 - Date.parse(startIso)) / 3_600_000, 169);
});

test("instantes cerca del cambio de día: el día de una tarjeta es el civil de BA, no el UTC (regresión de `start.slice(0, 10)`)", () => {
  assert.equal(instantDateKey("2026-10-04T00:00:00.000Z"), "2026-10-03", "sábado 21:00 en BA, aunque en UTC ya sea domingo");
  assert.equal(instantDateKey("2026-10-05T02:30:00.000Z"), "2026-10-04", "domingo 23:30 en BA");
  assert.equal(instantMinutesOfDay("2026-10-05T02:30:00.000Z"), 23 * 60 + 30);
  assert.equal(instantTimeLabel("2026-10-05T02:30:00.000Z"), "23:30");
  assert.equal(instantTimeLabel("2026-09-28T11:00:00.000Z"), "08:00");
});

function viewItem(id: string, start: string, minutes: number): CalendarViewItem {
  return { id, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), status: "scheduled", freedByLessonId: null } as unknown as CalendarViewItem;
}

test("agrupado por día y posición de tarjetas: domingo tarde cae en la columna del domingo, a la hora correcta", () => {
  const items = [
    viewItem("lun", "2026-09-28T11:00:00.000Z", 60), // lun 08:00
    viewItem("sab-tarde", "2026-10-03T23:59:00.000Z", 30), // sáb 20:59
    viewItem("sab-noche", "2026-10-04T00:00:00.000Z", 60), // sáb 21:00 (domingo en UTC)
    viewItem("dom", "2026-10-05T02:30:00.000Z", 30), // dom 23:30
  ];
  const byDay = groupItemsByDayKey(items);
  assert.deepEqual([...byDay.keys()].sort(), ["2026-09-28", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(byDay.get("2026-10-03")?.map((i) => i.id), ["sab-tarde", "sab-noche"], "las dos del sábado, aunque una sea UTC-domingo");
  assert.deepEqual(byDay.get("2026-10-04")?.map((i) => i.id), ["dom"]);
  const lunes = layoutDayItems(byDay.get("2026-09-28") ?? []);
  assert.equal(lunes[0].top, 0, "08:00 = tope de la grilla");
  const domingo = layoutDayItems(byDay.get("2026-10-04") ?? []);
  assert.equal(domingo[0].top, ((23 * 60 + 30 - 8 * 60) / 60) * 80, "23:30 medido desde las 08:00 con 80 px/h");
});

test("resaltado de hoy y línea de hora actual usan la hora civil de BA", () => {
  assert.equal(currentTimeTop(new Date("2026-10-03T11:00:00.000Z")), 0, "08:00 en BA");
  assert.equal(currentTimeTop(new Date("2026-10-03T10:59:00.000Z")), null, "07:59 en BA: antes del eje");
  assert.equal(currentTimeTop(new Date("2026-10-03T20:07:00.000Z")), ((17 * 60 + 7 - 8 * 60) / 60) * 80, "17:07 en BA");
  assert.equal(currentTimeTop(new Date("2026-10-04T01:00:00.000Z")), null, "22:00 en BA: fuera del eje (22 no incluido)");
  assert.equal(todayDateKey(new Date("2026-10-03T20:07:00.000Z")), resolveCalendarWindow({}, new Date("2026-10-03T20:07:00.000Z")).dayKeys[5], "hoy = la sexta columna (sábado)");
});
