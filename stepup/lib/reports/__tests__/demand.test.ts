import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarDemandSummary } from "../demand.ts";

const BA = "America/Argentina/Buenos_Aires";

test("buildCalendarDemandSummary: agrupa por día de semana y slot de 30 minutos en la zona horaria real", () => {
  // 2026-09-08 es martes; 13:00 UTC = 10:00 Argentina (UTC-3).
  const summary = buildCalendarDemandSummary([
    { startAt: "2026-09-08T13:00:00.000Z", timeZone: BA },
    { startAt: "2026-09-08T13:15:00.000Z", timeZone: BA }, // mismo slot de 30' (10:00-10:30)
  ]);
  assert.equal(summary.totalOccurrences, 2);
  const slot = summary.slotCounts.find((s) => s.weekday === 2 && s.slotStartMinuteOfDay === 600); // 10:00 = 600min
  assert.equal(slot?.count, 2);
});

test("buildCalendarDemandSummary: topWeekdays/topSlots soportan empates", () => {
  const summary = buildCalendarDemandSummary([
    { startAt: "2026-09-08T13:00:00.000Z", timeZone: BA }, // martes 10:00
    { startAt: "2026-09-10T13:00:00.000Z", timeZone: BA }, // jueves 10:00
  ]);
  assert.equal(summary.topWeekdays.length, 2);
});

test("buildCalendarDemandSummary: sin ocurrencias -> vacío, nunca inventa un top", () => {
  const summary = buildCalendarDemandSummary([]);
  assert.equal(summary.totalOccurrences, 0);
  assert.deepEqual(summary.topWeekdays, []);
  assert.deepEqual(summary.topSlots, []);
});
