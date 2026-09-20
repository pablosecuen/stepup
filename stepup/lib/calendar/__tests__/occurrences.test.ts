import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarViewForRange, isActiveReplacement, visibleCalendarItems, type MaterializedLessonForMerge } from "../occurrences.ts";
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

function lesson(overrides: Partial<MaterializedLessonForMerge> & { id: string }): MaterializedLessonForMerge {
  return {
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    primaryStudentId: "qa_student",
    studentName: "Alumno QA",
    level: "B1",
    lessonType: "individual",
    startAt: "2026-09-14T21:00:00.000Z",
    endAt: "2026-09-14T22:00:00.000Z",
    modality: "presencial",
    status: "scheduled",
    isRecurring: false,
    classTitle: null,
    activityKind: "class",
    freedByLessonId: null,
    notes: null,
    participantIds: ["qa_student"],
    ...overrides,
  };
}

test("buildCalendarViewForRange: una serie sin ninguna clase materializada produce ocurrencias virtuales reales", () => {
  const items = buildCalendarViewForRange({
    rangeStart: new Date("2026-09-01T00:00:00.000Z"),
    rangeEnd: new Date("2026-09-30T23:59:59.000Z"),
    rules: [rule({ weeks: MONDAY_18 })],
    exceptions: [],
    lessons: [],
  });
  assert.equal(items.length, 4, "cuatro lunes reales de septiembre");
  assert.ok(items.every((i) => !i.isMaterialized));
});

test("buildCalendarViewForRange: una clase suelta (recurrenceId null) dentro del rango se incluye tal cual", () => {
  const standalone = lesson({ id: "l1", startAt: "2026-09-16T21:00:00.000Z", endAt: "2026-09-16T22:00:00.000Z" });
  const items = buildCalendarViewForRange({
    rangeStart: new Date("2026-09-01T00:00:00.000Z"),
    rangeEnd: new Date("2026-09-30T23:59:59.000Z"),
    rules: [],
    exceptions: [],
    lessons: [standalone],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "l1");
  assert.equal(items[0].isRecurring, false);
});

test("buildCalendarViewForRange: una clase suelta FUERA del rango nunca aparece", () => {
  const standalone = lesson({ id: "l1", startAt: "2026-10-05T21:00:00.000Z", endAt: "2026-10-05T22:00:00.000Z" });
  const items = buildCalendarViewForRange({
    rangeStart: new Date("2026-09-01T00:00:00.000Z"),
    rangeEnd: new Date("2026-09-30T23:59:59.000Z"),
    rules: [],
    exceptions: [],
    lessons: [standalone],
  });
  assert.deepEqual(items, []);
});

test("buildCalendarViewForRange: una ocurrencia de serie ya materializada usa los datos REALES de la clase, no los de la ocurrencia virtual", () => {
  const seriesRule = rule({ weeks: MONDAY_18 });
  const materialized = lesson({
    id: "real-1",
    recurrenceId: seriesRule.recurrenceId,
    recurrenceOccurrenceKey: "qa_rule:w2:c0:d0:t1800:s0",
    classTitle: "Título editado a mano",
    status: "completed",
  });
  const items = buildCalendarViewForRange({
    rangeStart: new Date("2026-09-01T00:00:00.000Z"),
    rangeEnd: new Date("2026-09-30T23:59:59.000Z"),
    rules: [seriesRule],
    exceptions: [],
    lessons: [materialized],
  });
  const found = items.find((i) => i.id === "real-1");
  assert.ok(found, "la ocurrencia materializada se encuentra por su id real");
  assert.equal(found!.title, "Título editado a mano");
  assert.equal(found!.status, "completed");
  assert.equal(items.length, 4, "sigue habiendo 4 ocurrencias en septiembre, nunca 5 (nunca se duplica)");
});

test("isActiveReplacement / visibleCalendarItems: una cancelada con reemplazo activo se oculta, sólo se ve el reemplazo", () => {
  const cancelled = { ...toItem(lesson({ id: "cancelled-1", status: "cancelled" })) };
  const replacement = { ...toItem(lesson({ id: "replacement-1", freedByLessonId: "cancelled-1", startAt: "2026-09-14T21:00:00.000Z", endAt: "2026-09-14T22:00:00.000Z" })) };
  const all = [cancelled, replacement];
  assert.equal(isActiveReplacement(replacement, all), true);
  const visible = visibleCalendarItems(all);
  assert.deepEqual(
    visible.map((i) => i.id),
    ["replacement-1"]
  );
});

test("visibleCalendarItems: una cancelada SIN reemplazo sigue siendo visible (se muestra gris/tachada)", () => {
  const cancelled = toItem(lesson({ id: "cancelled-1", status: "cancelled" }));
  const visible = visibleCalendarItems([cancelled]);
  assert.deepEqual(
    visible.map((i) => i.id),
    ["cancelled-1"]
  );
});

// Ayuda mínima para construir un CalendarViewItem directo desde un MaterializedLessonForMerge, sin pasar por buildCalendarViewForRange.
function toItem(l: MaterializedLessonForMerge) {
  return {
    id: l.id,
    recurrenceId: l.recurrenceId,
    occurrenceKey: l.recurrenceOccurrenceKey,
    materializedLessonId: l.id,
    isMaterialized: true,
    studentId: l.primaryStudentId,
    participantIds: l.participantIds,
    studentName: l.studentName,
    level: l.level,
    lessonType: l.lessonType,
    title: l.classTitle,
    start: l.startAt,
    end: l.endAt,
    modality: l.modality,
    status: l.status,
    activityKind: l.activityKind,
    isRecurring: l.isRecurring,
    freedByLessonId: l.freedByLessonId,
    notes: l.notes,
  };
}
