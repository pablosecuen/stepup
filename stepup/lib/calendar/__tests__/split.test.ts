import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExcludedOccurrenceKeys, planRecurrenceSplit } from "../split.ts";
import type { RecurrenceWeek } from "../types.ts";

const BA = "America/Argentina/Buenos_Aires";
const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

test("planRecurrenceSplit: corte a mitad de semana trunca la original al día anterior y arranca la sucesora el lunes de esa semana", () => {
  // 2026-09-16 es un miércoles; la semana de esa fecha empieza el lunes 2026-09-14.
  const plan = planRecurrenceSplit({
    originalRecurrenceId: "r-original",
    originalStartDate: "2026-08-31",
    originalEndDate: null,
    effectiveDate: "2026-09-16",
    todayDate: "2026-09-16",
  });
  assert.deepEqual(plan.originalPatch, { status: "active", endDate: "2026-09-15" });
  assert.equal(plan.successorStartDate, "2026-09-14");
  assert.equal(plan.effectiveFromDate, "2026-09-16");
});

test("planRecurrenceSplit: cambiar desde el propio startDate de la serie CIERRA la original (status ended), nunca le inventa un endDate anterior a su propio inicio", () => {
  const plan = planRecurrenceSplit({
    originalRecurrenceId: "r-original",
    originalStartDate: "2026-09-14",
    originalEndDate: null,
    effectiveDate: "2026-09-14",
    todayDate: "2026-09-14",
  });
  assert.deepEqual(plan.originalPatch, { status: "ended", endDate: null });
  assert.equal(plan.successorStartDate, "2026-09-14");
});

test("planRecurrenceSplit: rechaza una fecha efectiva anterior a hoy (nunca cambia el pasado)", () => {
  assert.throws(() =>
    planRecurrenceSplit({
      originalRecurrenceId: "r1",
      originalStartDate: "2026-08-31",
      originalEndDate: null,
      effectiveDate: "2026-09-10",
      todayDate: "2026-09-16",
    })
  );
});

test("planRecurrenceSplit: rechaza una fecha efectiva anterior al inicio real de la serie", () => {
  assert.throws(() =>
    planRecurrenceSplit({
      originalRecurrenceId: "r1",
      originalStartDate: "2026-09-14",
      originalEndDate: null,
      effectiveDate: "2026-09-07",
      todayDate: "2026-09-07",
    })
  );
});

test("planRecurrenceSplit: rechaza una fecha efectiva posterior al fin ya configurado de la serie", () => {
  assert.throws(() =>
    planRecurrenceSplit({
      originalRecurrenceId: "r1",
      originalStartDate: "2026-08-31",
      originalEndDate: "2026-09-10",
      effectiveDate: "2026-09-16",
      todayDate: "2026-09-16",
    })
  );
});

test("planRecurrenceSplit: la sucesora hereda el endDate de la original", () => {
  const plan = planRecurrenceSplit({
    originalRecurrenceId: "r1",
    originalStartDate: "2026-08-31",
    originalEndDate: "2026-12-31",
    effectiveDate: "2026-09-16",
    todayDate: "2026-09-16",
  });
  assert.equal(plan.successorEndDate, "2026-12-31");
});

test("buildExcludedOccurrenceKeys: excluye la sesión del lunes de arranque cuando el corte es a mitad de semana (miércoles)", () => {
  const keys = buildExcludedOccurrenceKeys({
    successorRecurrenceId: "r-successor",
    successorStartDate: "2026-09-14", // lunes
    effectiveDate: "2026-09-16", // miércoles
    cycleLengthWeeks: 1,
    weeks: MONDAY_18,
    modality: "presencial",
    timezone: BA,
    classTitle: null,
    activityKind: "class",
  });
  assert.equal(keys.length, 1, "el lunes 14/09 (antes del corte del miércoles) debe excluirse");
});

test("buildExcludedOccurrenceKeys: sin nada que excluir cuando la fecha efectiva YA es el lunes de arranque", () => {
  const keys = buildExcludedOccurrenceKeys({
    successorRecurrenceId: "r-successor",
    successorStartDate: "2026-09-14",
    effectiveDate: "2026-09-14",
    cycleLengthWeeks: 1,
    weeks: MONDAY_18,
    modality: "presencial",
    timezone: BA,
    classTitle: null,
    activityKind: "class",
  });
  assert.deepEqual(keys, []);
});

test("buildExcludedOccurrenceKeys es determinístico: dos llamadas con el mismo input producen exactamente las mismas claves (idempotencia)", () => {
  const args = {
    successorRecurrenceId: "r-successor",
    successorStartDate: "2026-09-14",
    effectiveDate: "2026-09-16",
    cycleLengthWeeks: 1,
    weeks: MONDAY_18,
    modality: "presencial" as const,
    timezone: BA,
    classTitle: null,
    activityKind: "class" as const,
  };
  assert.deepEqual(buildExcludedOccurrenceKeys(args), buildExcludedOccurrenceKeys(args));
});
