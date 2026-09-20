import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  getDateKeyJsDay,
  getLocalDateKey,
  localDateTimeToInstantIso,
} from "../timezone.ts";

const BA = "America/Argentina/Buenos_Aires";

test("localDateTimeToInstantIso + getLocalDateKey: round-trip nunca interpreta YYYY-MM-DD como UTC", () => {
  // 2026-01-15 00:00 en Buenos Aires (UTC-3) es 2026-01-15T03:00:00Z — si se
  // interpretara como UTC directo, el date key resultante sería el mismo
  // por casualidad a las 00:00, pero una hora tardía revela el bug real.
  const iso = localDateTimeToInstantIso({ date: "2026-01-15", hour: 23, minute: 30, timeZone: BA });
  assert.equal(iso, "2026-01-16T02:30:00.000Z", "23:30 en Bs. As. (UTC-3) es 02:30 UTC del día siguiente");
  assert.equal(getLocalDateKey(iso, BA), "2026-01-15", "el date key local sigue siendo el 15, no el 16 (UTC)");
});

test("localDateTimeToInstantIso: mediodía en Bs. As. es 15:00 UTC (UTC-3 todo el año, sin horario de verano)", () => {
  const iso = localDateTimeToInstantIso({ date: "2026-06-10", hour: 12, minute: 0, timeZone: BA });
  assert.equal(iso, "2026-06-10T15:00:00.000Z");
});

test("addDaysToDateKey: cruza fin de mes y de año correctamente", () => {
  assert.equal(addDaysToDateKey("2026-01-31", 1), "2026-02-01");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateKey("2026-02-28", 1), "2026-03-01", "2026 no es bisiesto");
});

test("daysBetweenDateKeys: cruza diciembre->enero sin romperse", () => {
  assert.equal(daysBetweenDateKeys("2026-12-28", "2027-01-03"), 6);
});

test("getDateKeyJsDay: 2026-09-14 es lunes (jsDay 1)", () => {
  assert.equal(getDateKeyJsDay("2026-09-14"), 1);
});

test("localDateTimeToInstantIso: rechaza una fecha inválida (31 de febrero)", () => {
  assert.throws(() => localDateTimeToInstantIso({ date: "2026-02-31", hour: 10, minute: 0, timeZone: BA }));
});

test("localDateTimeToInstantIso: rechaza hora/minuto fuera de rango", () => {
  assert.throws(() => localDateTimeToInstantIso({ date: "2026-06-10", hour: 24, minute: 0, timeZone: BA }));
  assert.throws(() => localDateTimeToInstantIso({ date: "2026-06-10", hour: 10, minute: 60, timeZone: BA }));
});
