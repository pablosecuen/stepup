import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleForPendingRegistration, buildPendingLessons, PENDING_REGISTRATION_LEAD_TIME_MS } from "../pending.ts";
import type { CalendarViewItem } from "../../calendar/occurrences.ts";
import { buildCalendarViewForRange, type MaterializedLessonForMerge } from "../../calendar/occurrences.ts";
import { applyReplacementVisibility } from "../../calendar/replacement-visibility.ts";
import { readFileSync } from "node:fs";

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

test("un registro COMPLETADO excluye la clase aunque el calendario la tenga «programada» (clase importada); uno en curso la sigue mostrando", () => {
  const now = new Date("2026-09-21T23:00:00.000Z");
  const registered = item({ id: "ya" });
  const inProgress = item({ id: "en-curso", start: "2026-09-20T18:00:00.000Z", end: "2026-09-20T19:00:00.000Z" });
  const open = item({ id: "abierta", start: "2026-09-19T18:00:00.000Z", end: "2026-09-19T19:00:00.000Z" });
  const result = buildPendingLessons({
    calendarItems: [registered, inProgress, open],
    now,
    registrations: [
      { registrationId: "r1", calendarLessonId: "ya", status: "completed", completedParticipants: 1, totalParticipants: 1 },
      { registrationId: "r2", calendarLessonId: "en-curso", status: "in_progress", completedParticipants: 1, totalParticipants: 2 },
    ],
  });
  assert.deepEqual(result.map((r) => r.item.id).sort(), ["abierta", "en-curso"], "la completada no vuelve; la en curso y la sin tocar sí");
  assert.equal(result.find((r) => r.item.id === "en-curso")?.registrationState, "in_progress");
  assert.equal(result.find((r) => r.item.id === "abierta")?.registrationState, "not_started");
});

test("una ocurrencia que TeacherFlow anterior ya registró (clase de calendario ausente del respaldo) no está pendiente; las demás de la serie sí, y nada se marca ni se oculta de otra forma", () => {
  const now = new Date("2026-09-21T23:00:00.000Z");
  const virtual = (key: string, start: string, end: string) => item({ id: `virtual:${key}`, recurrenceId: "serie-1", occurrenceKey: key, materializedLessonId: null, isMaterialized: false, isRecurring: true, start, end });
  const registered = virtual("serie-1:w3:c0:d1:t1800:s0", "2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z");
  const pending = virtual("serie-1:w4:c0:d1:t1800:s0", "2026-09-21T21:00:00.000Z", "2026-09-21T22:00:00.000Z");
  const otherSeries = item({ id: "virtual:otra", recurrenceId: "serie-2", occurrenceKey: "serie-2:w3:c0:d1:t1800:s0", materializedLessonId: null, isMaterialized: false, isRecurring: true, start: "2026-09-14T21:00:00.000Z", end: "2026-09-14T22:00:00.000Z" });
  const legacy = new Set(["serie-1|serie-1:w3:c0:d1:t1800:s0"]);
  const withSet = buildPendingLessons({ calendarItems: [registered, pending, otherSeries], now, registrations: [], legacyRegisteredOccurrences: legacy });
  assert.deepEqual(withSet.map((r) => r.item.id).sort(), ["virtual:otra", `virtual:${pending.occurrenceKey}`].sort());
  const without = buildPendingLessons({ calendarItems: [registered, pending, otherSeries], now, registrations: [] });
  assert.equal(without.length, 3, "sin el conjunto, el comportamiento anterior no cambia");
});

test("una ocurrencia virtual REPROGRAMADA (la clase vive en su reemplazo) no se pide registrar; la clase real «reprogramada» sí", () => {
  const now = new Date("2026-09-21T23:00:00.000Z");
  const virtualMoved = item({ id: "virtual:movida", recurrenceId: "serie-1", occurrenceKey: "serie-1:w3:c0:d1:t1800:s0", materializedLessonId: null, isMaterialized: false, isRecurring: true, status: "rescheduled", start: "2026-09-14T21:00:00.000Z", end: "2026-09-14T22:00:00.000Z" });
  const realMoved = item({ id: "reemplazo", status: "rescheduled", start: "2026-09-18T21:00:00.000Z", end: "2026-09-18T22:00:00.000Z" });
  const virtualScheduled = item({ id: "virtual:normal", recurrenceId: "serie-1", occurrenceKey: "serie-1:w4:c0:d1:t1800:s0", materializedLessonId: null, isMaterialized: false, isRecurring: true, status: "scheduled", start: "2026-09-15T21:00:00.000Z", end: "2026-09-15T22:00:00.000Z" });
  assert.equal(isEligibleForPendingRegistration(virtualMoved, now), false);
  assert.equal(isEligibleForPendingRegistration(realMoved, now), true);
  assert.equal(isEligibleForPendingRegistration(virtualScheduled, now), true);
  assert.deepEqual(buildPendingLessons({ calendarItems: [virtualMoved, realMoved, virtualScheduled], now, registrations: [] }).map((p) => p.item.id).sort(), ["reemplazo", "virtual:normal"]);
});

test("reprogramar una clase con borrador libera el pendiente original y habilita sólo el destino en su nueva fecha", () => {
  const original: MaterializedLessonForMerge = {
    id: "original", recurrenceId: "serie", recurrenceOccurrenceKey: "ocurrencia",
    primaryStudentId: "qa_student", studentName: "Alumno QA", level: "B1", lessonType: "individual",
    startAt: "2026-10-28T23:30:00Z", endAt: "2026-10-29T00:30:00Z", status: "rescheduled",
    recurrenceOriginalStart: null, modality: "online", isRecurring: true, classTitle: null,
    activityKind: "class", freedByLessonId: null, notes: null, participantIds: ["qa_student"],
  };
  const destination: MaterializedLessonForMerge = {
    ...original, id: "destino", recurrenceOccurrenceKey: null,
    startAt: "2026-11-07T23:30:00Z", endAt: "2026-11-08T00:30:00Z",
    recurrenceOriginalStart: original.startAt,
  };
  const registrations: Parameters<typeof buildPendingLessons>[0]["registrations"] = [
    { registrationId: "borrador", calendarLessonId: "original", status: "in_progress", completedParticipants: 0, totalParticipants: 1 },
  ];
  const calendarItems = buildCalendarViewForRange({
    rangeStart: new Date("2026-10-28"), rangeEnd: new Date("2026-11-09"), rules: [],
    exceptions: [{ recurrenceId: "serie", occurrenceKey: "ocurrencia", type: "rescheduled", replacementLessonId: "destino" }],
    lessons: [original, destination],
  });
  assert.equal(calendarItems.find(i => i.id === "original")?.occupiesSlot, false);
  assert.deepEqual(buildPendingLessons({ calendarItems, registrations, now: new Date("2026-11-02") }), []);
  const due = buildPendingLessons({ calendarItems, registrations, now: new Date("2026-11-08T00:20:00Z") });
  assert.deepEqual(due.map(p => [p.item.id, p.registrationState]), [["destino", "not_started"]]);
  assert.equal(registrations[0].status, "in_progress", "el borrador anterior se conserva, sin finalizarlo ni borrarlo");
});

test("una sustitución persistida no vuelve como pendiente por conservar un borrador; clases ajenas y destino siguen independientes", () => {
  const original = item({ id: "original", status: "scheduled" });
  const destination = item({ id: "destino" });
  const unrelated = item({ id: "otra", participantIds: ["a", "b"] });
  const calendarItems = applyReplacementVisibility([original, destination, unrelated], {
    lessons: [{ originalLessonId: "original", replacementLessonId: "destino", kind: "moved", replacementActive: true }], series: [],
  });
  const result = buildPendingLessons({ calendarItems, now: new Date("2026-11-02"), registrations: [
    { registrationId: "viejo", calendarLessonId: "original", status: "in_progress", completedParticipants: 0, totalParticipants: 1 },
    { registrationId: "grupal", calendarLessonId: "otra", status: "in_progress", completedParticipants: 1, totalParticipants: 2 },
  ] });
  assert.deepEqual(result.map(p => [p.item.id, p.registrationState, p.completedParticipants]), [
    ["destino", "not_started", 0], ["otra", "in_progress", 1],
  ]);
});

test("Inicio conserva los enlaces de reemplazo y reprogramar actualiza todos los destinos de pendientes", () => {
  const home = readFileSync(new URL("../../dashboard/load-home-data.ts", import.meta.url), "utf8");
  assert.match(home, /const \[calendarBase, todayLessonRows/);
  assert.match(home, /composeCalendarView\(calendarBase, pendingLessonRows/);
  assert.doesNotMatch(home, /const calendarBase = \{/, "no reconstruir una base parcial que pierde replacementLinks");
  const actions = readFileSync(new URL("../../actions/calendar.ts", import.meta.url), "utf8");
  const reschedule = actions.slice(actions.indexOf("export async function rescheduleOccurrenceAction"), actions.indexOf("// Series: pausar"));
  for (const path of ["/calendario", "/registro", "/inicio", "/recordatorios"]) {
    assert.ok(reschedule.includes(`revalidatePath("${path}")`), path);
  }
  const registration = readFileSync(new URL("../../actions/lesson-registrations.ts", import.meta.url), "utf8");
  const start = registration.slice(registration.indexOf("export async function startRegistrationAction"), registration.indexOf("export interface StartAdhocRegistrationActionInput"));
  assert.match(start, /calendarItem\.occupiesSlot === false \|\| calendarItem\.hiddenByReplacement/);
  assert.ok(start.indexOf("calendarItem.occupiesSlot") < start.indexOf("await startLessonRegistration("), "un enlace viejo no puede retomar el registro del origen liberado");
});
