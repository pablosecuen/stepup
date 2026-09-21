import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleForPendingRegistration, buildPendingLessons, PENDING_REGISTRATION_LEAD_TIME_MS } from "../pending.ts";
import type { CalendarViewItem } from "../../calendar/occurrences.ts";

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
    status: "scheduled",
    activityKind: "class",
    isRecurring: false,
    freedByLessonId: null,
    notes: null,
    ...overrides,
  };
}

test("isEligibleForPendingRegistration: una clase futura (antes de fin - 10min) todavía no es elegible", () => {
  const lesson = item({ id: "l1", start: "2026-09-21T21:00:00.000Z", end: "2026-09-21T22:00:00.000Z" });
  const now = new Date("2026-09-21T20:00:00.000Z"); // antes de empezar
  assert.equal(isEligibleForPendingRegistration(lesson, now), false);
});

test("isEligibleForPendingRegistration: se habilita desde 10 minutos antes de terminar", () => {
  const lesson = item({ id: "l1", start: "2026-09-21T21:00:00.000Z", end: "2026-09-21T22:00:00.000Z" });
  const exactlyAtLead = new Date(new Date(lesson.end).getTime() - PENDING_REGISTRATION_LEAD_TIME_MS);
  assert.equal(isEligibleForPendingRegistration(lesson, exactlyAtLead), true);
});

test("isEligibleForPendingRegistration: una clase cancelada nunca es elegible", () => {
  const lesson = item({ id: "l1", status: "cancelled", start: "2019-12-31T23:00:00.000Z", end: "2020-01-01T00:00:00.000Z" });
  assert.equal(isEligibleForPendingRegistration(lesson, new Date("2026-01-01T00:00:00.000Z")), false);
});

test("isEligibleForPendingRegistration: una reprogramada (destino real) SÍ es elegible, igual que 'scheduled'", () => {
  const lesson = item({ id: "l1", status: "rescheduled", start: "2019-12-31T23:00:00.000Z", end: "2020-01-01T00:00:00.000Z" });
  assert.equal(isEligibleForPendingRegistration(lesson, new Date("2026-01-01T00:00:00.000Z")), true);
});

test("isEligibleForPendingRegistration: una ya finalizada ('completed') nunca vuelve a aparecer como pendiente", () => {
  const lesson = item({ id: "l1", status: "completed", start: "2019-12-31T23:00:00.000Z", end: "2020-01-01T00:00:00.000Z" });
  assert.equal(isEligibleForPendingRegistration(lesson, new Date("2026-01-01T00:00:00.000Z")), false);
});

test("buildPendingLessons: una clase sin registro todavía aparece 'not_started'", () => {
  const lesson = item({ id: "l1", start: "2019-12-31T23:00:00.000Z", end: "2020-01-01T00:00:00.000Z" });
  const result = buildPendingLessons({ calendarItems: [lesson], now: new Date("2026-01-01"), registrations: [] });
  assert.equal(result.length, 1);
  assert.equal(result[0].registrationState, "not_started");
});

test("buildPendingLessons: una grupal parcialmente completada muestra progreso real, no desaparece", () => {
  const lesson = item({ id: "l1", start: "2019-12-31T23:00:00.000Z", end: "2020-01-01T00:00:00.000Z", participantIds: ["a", "b", "c"] });
  const result = buildPendingLessons({
    calendarItems: [lesson],
    now: new Date("2026-01-01"),
    registrations: [{ registrationId: "reg_1", calendarLessonId: "l1", status: "in_progress", completedParticipants: 2, totalParticipants: 3 }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].registrationState, "in_progress");
  assert.equal(result[0].completedParticipants, 2);
  assert.equal(result[0].totalParticipants, 3);
});

test("buildPendingLessons: orden cronológico (más antigua primero)", () => {
  const later = item({ id: "l1", end: "2020-01-02T00:00:00.000Z", start: "2020-01-01T23:00:00.000Z" });
  const earlier = item({ id: "l2", end: "2020-01-01T00:00:00.000Z", start: "2019-12-31T23:00:00.000Z" });
  const result = buildPendingLessons({ calendarItems: [later, earlier], now: new Date("2026-01-01"), registrations: [] });
  assert.deepEqual(
    result.map((r) => r.item.id),
    ["l2", "l1"]
  );
});
