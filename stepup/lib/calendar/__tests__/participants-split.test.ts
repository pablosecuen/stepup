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
  assert.equal(result.length, 5, "los cuatro lunes entre el 1 y el 30 de septiembre y el lunes 31/8, ya pasado y todavía sin registrar");
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
  assert.equal(result.length, 4, "la ocurrencia materializada (semana 1) queda afuera — nunca se toca");
});

test("planParticipantFreeze: con fecha efectiva igual a 'ahora' se congelan las clases PASADAS sin registrar (nunca las futuras)", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");
  const result = planParticipantFreeze({ rule: rule({ weeks: MONDAY_18 }), now, effectiveDateIso: now.toISOString(), existingLessons: [] });
  assert.deepEqual(
    result.map((occurrence) => occurrence.start),
    ["2026-08-31T21:00:00.000Z", "2026-09-07T21:00:00.000Z", "2026-09-14T21:00:00.000Z"],
    "los lunes 31/8, 7/9 y 14/9 ya pasaron y no tienen registro: conservan el grupo de entonces; el 21/9 es futuro y sigue el grupo nuevo"
  );
});

test("planParticipantFreeze: una fecha efectiva anterior a la ventana de clases por registrar no congela nada", () => {
  const now = new Date("2027-03-01T00:00:00.000Z");
  assert.deepEqual(planParticipantFreeze({ rule: rule({ weeks: MONDAY_18 }), now, effectiveDateIso: "2026-09-15T00:00:00.000Z", existingLessons: [] }), []);
});

test("planParticipantFreeze: una ocurrencia con excepción (excluida, cancelada, reprogramada) nunca se congela", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const result = planParticipantFreeze({
    rule: rule({ weeks: MONDAY_18 }),
    now,
    effectiveDateIso: "2026-09-30T00:00:00.000Z",
    existingLessons: [],
    exceptionKeys: new Set(["qa_rule:w0:c0:d0:t1800:s0", "qa_rule:w2:c0:d0:t1800:s0"]),
  });
  assert.equal(result.length, 3, "se salvan las dos con excepción");
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
