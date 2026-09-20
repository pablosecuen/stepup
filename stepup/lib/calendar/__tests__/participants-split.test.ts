import { test } from "node:test";
import assert from "node:assert/strict";
import { planParticipantFreeze } from "../participants-split.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

const BA = "America/Argentina/Buenos_Aires";
const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

function rule(overrides: Partial<RecurrenceRuleForEngine> & { weeks: RecurrenceWeek[] }): RecurrenceRuleForEngine {
  return {
    recurrenceId: "qa_rule",
    studentId: "qa_student",
    participantIds: ["qa_student"],
    cycleLengthWeeks: 1,
    modality: "presencial",
    timezone: BA,
    startDate: "2026-08-31",
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

test("planParticipantFreeze: ocurrencias virtuales antes de la fecha efectiva y sin materializar se marcan para congelar", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const effectiveDateIso = "2026-09-30T00:00:00.000Z"; // cubre lunes 7, 14, 21, 28 de septiembre
  const result = planParticipantFreeze({ rule: rule({ weeks: MONDAY_18 }), now, effectiveDateIso, existingLessons: [] });
  assert.equal(result.length, 4, "cuatro lunes reales entre el 1 y el 30 de septiembre");
});

test("planParticipantFreeze: una ocurrencia ya materializada nunca se re-congela", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const effectiveDateIso = "2026-09-30T00:00:00.000Z";
  const result = planParticipantFreeze({
    rule: rule({ weeks: MONDAY_18 }),
    now,
    effectiveDateIso,
    existingLessons: [{ id: "real-1", recurrenceId: "qa_rule", recurrenceOccurrenceKey: "qa_rule:w1:c0:d0:t1800:s0", status: "completed" }],
  });
  assert.equal(result.length, 3, "la ocurrencia materializada (semana 1) queda afuera — nunca se toca");
});

test("planParticipantFreeze: fecha efectiva en el pasado o igual a 'ahora' nunca congela nada", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = planParticipantFreeze({ rule: rule({ weeks: MONDAY_18 }), now, effectiveDateIso: now.toISOString(), existingLessons: [] });
  assert.deepEqual(result, []);
});

test("planParticipantFreeze: regla pausada nunca genera ocurrencias para congelar (mismo criterio que generateOccurrences)", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const result = planParticipantFreeze({
    rule: rule({ weeks: MONDAY_18, status: "paused" }),
    now,
    effectiveDateIso: "2026-09-30T00:00:00.000Z",
    existingLessons: [],
  });
  assert.deepEqual(result, []);
});
