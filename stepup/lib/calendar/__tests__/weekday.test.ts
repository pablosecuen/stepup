import { test } from "node:test";
import assert from "node:assert/strict";
import { appWeekdayToJsDay, jsDayToAppWeekday, mondayOfWeekContaining } from "../weekday.ts";
import { generateOccurrences } from "../recurrence-engine.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

// Pruebas de regresión para el hallazgo investigado (Fase 5, cierre): "la fecha
// seleccionada al crear una serie se guarda un día antes". La investigación
// exhaustiva de la cadena completa (input HTML → Server Action → conversión
// fecha↔Date↔texto → repositorio → RPC/columna `date` de Postgres → lectura)
// no encontró ningún paso que interprete un YYYY-MM-DD pasando por UTC de forma
// incorrecta — `recurrence_rules.start_date` SIEMPRE es (por invariante real,
// `assertRecurrenceRule`) el lunes de la semana 0, nunca la fecha exacta que
// la profesora tipeó, PERO la primera ocurrencia REAL generada por el motor
// (lo único visible/facturable) sigue cayendo exactamente en esa fecha. Estas
// pruebas blindan ese comportamiento contra una futura "corrección" accidental
// que rompería la invariante real del motor de recurrencia.

const BA = "America/Argentina/Buenos_Aires";

test("jsDayToAppWeekday / appWeekdayToJsDay: round-trip para los 7 días", () => {
  for (let jsDay = 0; jsDay <= 6; jsDay += 1) {
    const appDay = jsDayToAppWeekday(jsDay);
    assert.equal(appWeekdayToJsDay(appDay), jsDay);
  }
});

test("mondayOfWeekContaining: caso real reportado — martes 2026-09-15 -> lunes 2026-09-14", () => {
  assert.equal(mondayOfWeekContaining("2026-09-15"), "2026-09-14");
});

test("mondayOfWeekContaining: ya es lunes -> no se mueve (offset 0)", () => {
  assert.equal(mondayOfWeekContaining("2026-09-14"), "2026-09-14");
});

test("mondayOfWeekContaining: domingo -> retrocede 6 días (el offset máximo posible)", () => {
  assert.equal(mondayOfWeekContaining("2026-09-20"), "2026-09-14");
});

test("mondayOfWeekContaining: los 7 días de una misma semana resuelven al mismo lunes", () => {
  const week = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
  for (const day of week) {
    assert.equal(mondayOfWeekContaining(day), "2026-09-14", `día ${day} debería resolver a 2026-09-14`);
  }
});

test("mondayOfWeekContaining: cruza fin de mes (martes 2026-09-01 -> lunes 2026-08-31)", () => {
  assert.equal(mondayOfWeekContaining("2026-09-01"), "2026-08-31");
});

test("mondayOfWeekContaining: cruza fin de año (viernes 2027-01-01 -> lunes 2026-12-28)", () => {
  assert.equal(mondayOfWeekContaining("2027-01-01"), "2026-12-28");
});

test("mondayOfWeekContaining: cruza año bisiesto -> no bisiesto (lunes de la semana que contiene el 29/2/2028)", () => {
  // 2028 es bisiesto; 2028-02-29 es martes -> lunes real 2028-02-28.
  assert.equal(mondayOfWeekContaining("2028-02-29"), "2028-02-28");
});

test("mondayOfWeekContaining: estable sin importar la hora del día (fecha civil pura, sin componente horario)", () => {
  // La función sólo recibe YYYY-MM-DD — nunca un instante — así que llamarla
  // repetidas veces con la misma fecha civil siempre da el mismo resultado,
  // sin ninguna dependencia de "ahora" ni de la zona horaria del proceso Node.
  const results = new Set(Array.from({ length: 5 }, () => mondayOfWeekContaining("2026-09-15")));
  assert.equal(results.size, 1);
  assert.equal([...results][0], "2026-09-14");
});

function weeklyRule(overrides: Partial<RecurrenceRuleForEngine> = {}): RecurrenceRuleForEngine {
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }] }]; // martes 10:00
  return {
    recurrenceId: "r1",
    studentId: "s1",
    participantIds: ["s1"],
    cycleLengthWeeks: 1,
    weeks,
    modality: "online",
    timezone: BA,
    startDate: mondayOfWeekContaining("2026-09-15"), // lo que el Server Action real calcula a partir de la fecha ingresada
    endDate: null,
    status: "active",
    classTitle: "Serie",
    activityKind: "class",
    ...overrides,
  };
}

test("extremo a extremo: la PRIMERA ocurrencia real de una serie creada un martes cae exactamente en el martes elegido, nunca un día antes ni después", () => {
  const rule = weeklyRule();
  assert.equal(rule.startDate, "2026-09-14", "el ancla técnica de la regla es el lunes de esa semana (invariante real del motor)");

  const occurrences = generateOccurrences(rule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  assert.ok(occurrences.length > 0);
  const first = occurrences[0];
  // 10:00 Argentina (UTC-3) del 15/09 es 13:00 UTC.
  assert.equal(first.start, "2026-09-15T13:00:00.000Z", "la primera clase real cae en la fecha civil que la profesora eligió (15/09), nunca el 14/09");
});

test("extremo a extremo: serie que arranca un domingo — la primera ocurrencia real sigue siendo el domingo elegido", () => {
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 6, hour: 9, minute: 0, durationMinutes: 45 }] }]; // domingo 09:00
  const rule = weeklyRule({ startDate: mondayOfWeekContaining("2026-09-20"), weeks }); // 2026-09-20 es domingo
  assert.equal(rule.startDate, "2026-09-14");

  const occurrences = generateOccurrences(rule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  const first = occurrences[0];
  assert.equal(first.start, "2026-09-20T12:00:00.000Z", "09:00 Argentina del 20/09 es 12:00 UTC — la fecha civil elegida, no el 19/09");
});

test("extremo a extremo: serie que arranca cruzando fin de mes/año (jueves 2027-01-01) — primera ocurrencia real en la fecha exacta, sin corrimiento por el cruce de año", () => {
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 4, hour: 20, minute: 30, durationMinutes: 60 }] }]; // viernes 20:30
  const rule = weeklyRule({ startDate: mondayOfWeekContaining("2027-01-01"), weeks }); // 2027-01-01 es viernes
  assert.equal(rule.startDate, "2026-12-28");

  const occurrences = generateOccurrences(rule, new Date("2026-12-28T00:00:00.000Z"), new Date("2027-01-10T23:59:59.000Z"));
  const first = occurrences[0];
  // 20:30 Argentina (UTC-3) del 1/1/2027 es 23:30 UTC del mismo día.
  assert.equal(first.start, "2027-01-01T23:30:00.000Z", "la primera clase real cae el 1/1/2027 elegido, nunca el 31/12/2026");
});

test("extremo a extremo: horario cercano a medianoche Argentina — la fecha civil elegida nunca se confunde con el día siguiente/anterior en UTC", () => {
  // 23:45 Argentina (UTC-3) cae en el día siguiente en UTC (02:45Z) — el
  // riesgo real de un bug de "interpretar YYYY-MM-DD como UTC" es exactamente
  // este tipo de horario, donde el date key local y el date key UTC difieren.
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 23, minute: 45, durationMinutes: 30 }] }]; // martes 23:45
  const rule = weeklyRule({ startDate: mondayOfWeekContaining("2026-09-15"), weeks });
  assert.equal(rule.startDate, "2026-09-14");

  const occurrences = generateOccurrences(rule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  const first = occurrences[0];
  assert.equal(first.start, "2026-09-16T02:45:00.000Z", "23:45 del 15/09 en Argentina (UTC-3) es 02:45 UTC del 16/09 — la fecha CIVIL real de la clase sigue siendo el 15/09");
});
