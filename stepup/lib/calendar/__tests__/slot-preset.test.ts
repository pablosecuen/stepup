import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeWeeklySessions, parseSlotPreset, seriesWeeksFromSlot, weekdayIndexOfDate } from "../slot-preset.ts";
import { generateOccurrences } from "../recurrence-engine.ts";
import { instantDateKey, instantTimeLabel } from "../civil-calendar.ts";
import { newLessonSlotHref } from "../slot-link.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("el horario elegido se lee de la URL del espacio tocado; sin fecha y hora válidas rige la selección manual", () => {
  assert.deepEqual(parseSlotPreset({ date: "2026-10-21", hour: "22", minute: "0" }), { date: "2026-10-21", hour: 22, minute: 0, durationMinutes: 60 });
  assert.deepEqual(parseSlotPreset({ date: "2026-10-21", hour: "0" }), { date: "2026-10-21", hour: 0, minute: 0, durationMinutes: 60 }, "medianoche es una hora válida");
  assert.deepEqual(parseSlotPreset({ date: "2026-10-21", hour: "9", minute: "30", duration: "45" }), { date: "2026-10-21", hour: 9, minute: 30, durationMinutes: 45 });
  for (const bad of [{}, { date: "2026-10-21" }, { hour: "10" }, { date: "2026-02-31", hour: "10" }, { date: "21/10/2026", hour: "10" }, { date: "2026-10-21", hour: "24" }, { date: "2026-10-21", hour: "x" }]) {
    assert.equal(parseSlotPreset(bad), null, JSON.stringify(bad));
  }
  // El enlace del Calendario y su lectura son inversos.
  const href = newLessonSlotHref({ dayKey: "2026-10-21", hour: 22, returnPath: "/calendario?vista=semana" });
  const params = new URL(href, "https://x.test").searchParams;
  assert.deepEqual(parseSlotPreset({ date: params.get("date") ?? "", hour: params.get("hour") ?? "", minute: params.get("minute") ?? "" }), { date: "2026-10-21", hour: 22, minute: 0, durationMinutes: 60 });
});

test("el día de la semana sale de la fecha civil (0 = lunes) sin tocar zonas horarias: el miércoles 21/10/2026 es 2", () => {
  assert.equal(weekdayIndexOfDate("2026-10-19"), 0);
  assert.equal(weekdayIndexOfDate("2026-10-21"), 2);
  assert.equal(weekdayIndexOfDate("2026-10-25"), 6);
  assert.equal(weekdayIndexOfDate("2026-12-31"), 3);
});

test("serie desde un miércoles por la noche: el patrón trae ese día y esa hora, y la PRIMERA ocurrencia es ese mismo miércoles a esa hora (zona de la cuenta, sin correr el día)", () => {
  const slot = parseSlotPreset({ date: "2026-10-21", hour: "22", minute: "0" })!;
  const weeks = seriesWeeksFromSlot(slot);
  assert.deepEqual(weeks, [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 22, minute: 0, durationMinutes: 60 }] }]);
  assert.equal(describeWeeklySessions(weeks), "los miércoles a las 22:00");
  const start = new Date("2026-10-21T00:00:00-03:00");
  const occurrences = generateOccurrences(
    { recurrenceId: "r", studentId: null, participantIds: [], cycleLengthWeeks: 1, weeks, modality: "online", timezone: "America/Argentina/Buenos_Aires", startDate: "2026-10-19", endDate: null, status: "active", classTitle: null, activityKind: "class" },
    start,
    new Date(start.getTime() + 21 * 86_400_000)
  );
  assert.deepEqual(occurrences.slice(0, 3).map((o) => `${instantDateKey(o.start)} ${instantTimeLabel(o.start)}`), ["2026-10-21 22:00", "2026-10-28 22:00", "2026-11-04 22:00"], "22:00 de Buenos Aires = 01:00 UTC del día siguiente: no corre el día civil");
});

test("cableado: el formulario de Nueva clase lleva el horario elegido a la clase única Y a la serie, lo muestra, lo conserva al cambiar de modo o corregir un error y deja restaurarlo", () => {
  const form = read("app/(app)/calendario/nueva/new-lesson-form.tsx");
  assert.match(form, /const slot = isReplacement \? null : parseSlotPreset\(presetFromReplacement \?\? \{\}\);/);
  assert.match(form, /useState\(\(\) => slot\?\.date \?\? ""\)/, "fecha de inicio de la serie precargada");
  assert.match(form, /defaultWeekCycles\(1, slot \? seriesWeeksFromSlot\(slot\) : undefined\)/, "día y hora de la serie precargados");
  assert.match(form, /Horario elegido en el Calendario/);
  assert.match(form, /Volver a lo elegido/);
  assert.match(form, /if \(values\.mode\) setMode\(values\.mode\);/, "tras un error de validación se vuelve al mismo modo (clase única o serie)");
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /mode: "single",/);
  assert.match(actions, /mode: "series",/);
  // Volver/cancelar: misma vista, mismo período y misma posición de desplazamiento de la grilla.
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /saveGridScroll\(returnPath, scrollerRef\.current\)/);
  assert.match(grid, /restoreGridScroll\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`, scroller\)/);
});
