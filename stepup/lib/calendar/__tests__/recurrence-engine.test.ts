import { test } from "node:test";
import assert from "node:assert/strict";
import { applyExceptionsToOccurrences, generateOccurrences } from "../recurrence-engine.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

const BA = "America/Argentina/Buenos_Aires";

function rule(overrides: Partial<RecurrenceRuleForEngine> & { weeks: RecurrenceWeek[] }): RecurrenceRuleForEngine {
  return {
    recurrenceId: "qa_rule",
    studentId: "qa_student",
    participantIds: ["qa_student"],
    cycleLengthWeeks: 1,
    modality: "presencial",
    timezone: BA,
    startDate: "2026-08-31", // lunes real
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

test("generateOccurrences: una serie semanal produce exactamente los lunes reales del rango, en zona horaria Argentina", () => {
  const weeklyRule = rule({ weeks: MONDAY_18 });
  const occurrences = generateOccurrences(
    weeklyRule,
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-09-30T23:59:59.000Z")
  );
  // Septiembre 2026: lunes 7, 14, 21, 28 (el 31/8 es el inicio, antes de septiembre).
  assert.equal(occurrences.length, 4);
  assert.deepEqual(
    occurrences.map((o) => o.start),
    ["2026-09-07T21:00:00.000Z", "2026-09-14T21:00:00.000Z", "2026-09-21T21:00:00.000Z", "2026-09-28T21:00:00.000Z"],
    "18:00 en Bs. As. (UTC-3) es 21:00 UTC"
  );
});

test("generateOccurrences: rango que cruza fin de mes y de año no se rompe", () => {
  const weeklyRule = rule({ startDate: "2026-12-28", weeks: MONDAY_18 }); // lunes real
  const occurrences = generateOccurrences(weeklyRule, new Date("2026-12-01T00:00:00.000Z"), new Date("2027-01-31T23:59:59.000Z"));
  assert.ok(occurrences.length >= 4, "genera ocurrencias reales cruzando diciembre->enero");
  assert.ok(occurrences.every((o) => new Date(o.start).getUTCFullYear() >= 2026));
});

test("generateOccurrences: regla no activa (paused/ended) nunca genera ocurrencias", () => {
  const pausedRule = rule({ weeks: MONDAY_18, status: "paused" });
  const occurrences = generateOccurrences(pausedRule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  assert.deepEqual(occurrences, []);
});

test("generateOccurrences: dos sesiones semanales (martes y jueves) nunca se confunden de día", () => {
  const twiceWeekly = rule({
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }, // martes
          { weekday: 3, hour: 16, minute: 0, durationMinutes: 60 }, // jueves
        ],
      },
    ],
  });
  const occurrences = generateOccurrences(twiceWeekly, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-07T23:59:59.000Z"));
  assert.equal(occurrences.length, 2);
  const hours = occurrences.map((o) => new Date(o.start).getUTCHours());
  assert.deepEqual(hours.sort(), [13, 19], "10:00 y 16:00 Bs. As. = 13:00 y 19:00 UTC");
});

test("generateOccurrences: startDate que no es lunes lanza (regla estructural del móvil)", () => {
  const invalidRule = rule({ startDate: "2026-09-15", weeks: MONDAY_18 }); // martes
  assert.throws(() => generateOccurrences(invalidRule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z")));
});

test("applyExceptionsToOccurrences: una excepción 'cancelled' marca la ocurrencia sin borrarla", () => {
  const weeklyRule = rule({ weeks: MONDAY_18 });
  const occurrences = generateOccurrences(weeklyRule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  const target = occurrences[0];
  const withExceptions = applyExceptionsToOccurrences(
    occurrences,
    [{ recurrenceId: weeklyRule.recurrenceId, occurrenceKey: target.occurrenceKey, type: "cancelled" }],
    []
  );
  assert.equal(withExceptions.length, occurrences.length, "nunca desaparece — sólo cambia su estado");
  const found = withExceptions.find((o) => o.occurrenceKey === target.occurrenceKey)!;
  assert.equal(found.materializationStatus, "cancelled");
});

test("applyExceptionsToOccurrences: una excepción 'excluded' sí quita la ocurrencia del resultado", () => {
  const weeklyRule = rule({ weeks: MONDAY_18 });
  const occurrences = generateOccurrences(weeklyRule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T23:59:59.000Z"));
  const target = occurrences[0];
  const withExceptions = applyExceptionsToOccurrences(
    occurrences,
    [{ recurrenceId: weeklyRule.recurrenceId, occurrenceKey: target.occurrenceKey, type: "excluded" }],
    []
  );
  assert.equal(withExceptions.length, occurrences.length - 1);
});

test("applyExceptionsToOccurrences: una clase ya materializada (no cancelada) se marca 'materialized', nunca se duplica", () => {
  const weeklyRule = rule({ weeks: MONDAY_18 });
  const occurrences = generateOccurrences(weeklyRule, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-07T23:59:59.000Z"));
  const target = occurrences[0];
  const withMaterialized = applyExceptionsToOccurrences(occurrences, [], [
    { id: "real-lesson-1", recurrenceId: weeklyRule.recurrenceId, recurrenceOccurrenceKey: target.occurrenceKey, status: "scheduled" },
  ]);
  assert.equal(withMaterialized.length, 1);
  assert.equal(withMaterialized[0].materializationStatus, "materialized");
  assert.equal(withMaterialized[0].materializedLessonId, "real-lesson-1");
});

test("generateOccurrences: clases consecutivas (fin de una = inicio de otra) son ambas ocurrencias reales, nunca se fusionan ni se pierden", () => {
  const backToBack = rule({
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
          { weekday: 0, hour: 19, minute: 0, durationMinutes: 60 },
        ],
      },
    ],
  });
  const occurrences = generateOccurrences(backToBack, new Date("2026-09-07T00:00:00.000Z"), new Date("2026-09-07T23:59:59.000Z"));
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].end, occurrences[1].start, "la primera termina exactamente cuando empieza la segunda");
});
