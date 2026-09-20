import { test } from "node:test";
import assert from "node:assert/strict";
import { getCancelledSlotReuseDecision } from "../mutations.ts";
import type { CalendarViewItem } from "../occurrences.ts";

function item(overrides: Partial<CalendarViewItem> & { id: string }): CalendarViewItem {
  return {
    recurrenceId: null,
    occurrenceKey: null,
    materializedLessonId: overrides.id,
    isMaterialized: true,
    studentId: "qa_student",
    participantIds: ["qa_student"],
    studentName: "Alumno QA",
    level: "B1",
    lessonType: "individual",
    title: null,
    start: "2026-09-20T21:00:00.000Z",
    end: "2026-09-20T22:00:00.000Z",
    modality: "presencial",
    status: "cancelled",
    activityKind: "class",
    isRecurring: false,
    freedByLessonId: null,
    notes: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-15T00:00:00.000Z");

test("getCancelledSlotReuseDecision: elegible cuando está cancelada, es futura y sin reemplazo activo", () => {
  const cancelled = item({ id: "c1" });
  const decision = getCancelledSlotReuseDecision(cancelled, [cancelled], NOW);
  assert.equal(decision.eligible, true);
});

test("getCancelledSlotReuseDecision: NO elegible si no está cancelada", () => {
  const scheduled = item({ id: "s1", status: "scheduled" });
  const decision = getCancelledSlotReuseDecision(scheduled, [scheduled], NOW);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "not_cancelled");
});

test("getCancelledSlotReuseDecision: NO elegible si el horario ya pasó", () => {
  const cancelled = item({ id: "c1", start: "2026-09-01T21:00:00.000Z", end: "2026-09-01T22:00:00.000Z" });
  const decision = getCancelledSlotReuseDecision(cancelled, [cancelled], NOW);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "not_future");
});

test("getCancelledSlotReuseDecision: NO elegible si YA tiene un reemplazo activo", () => {
  const cancelled = item({ id: "c1" });
  const activeReplacement = item({ id: "r1", status: "scheduled", freedByLessonId: "c1" });
  const decision = getCancelledSlotReuseDecision(cancelled, [cancelled, activeReplacement], NOW);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "already_has_active_replacement");
});

test("getCancelledSlotReuseDecision: SÍ elegible si el reemplazo anterior fue cancelado a su vez", () => {
  const cancelled = item({ id: "c1" });
  const cancelledReplacement = item({ id: "r1", status: "cancelled", freedByLessonId: "c1" });
  const decision = getCancelledSlotReuseDecision(cancelled, [cancelled, cancelledReplacement], NOW);
  assert.equal(decision.eligible, true, "un reemplazo que también se canceló no cuenta como reemplazo activo");
});
