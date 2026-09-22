import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLessonTiming, selectCurrentOrNextOccurrence } from "../next-class.ts";

const NOW = new Date("2026-09-22T15:00:00.000Z");

test("classifyLessonTiming: ahora antes del inicio -> upcoming", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T16:00:00.000Z", end: "2026-09-22T17:00:00.000Z" }, NOW), "upcoming");
});

test("classifyLessonTiming: ahora exactamente en el inicio -> in_progress (borde inclusive)", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T15:00:00.000Z", end: "2026-09-22T16:00:00.000Z" }, NOW), "in_progress");
});

test("classifyLessonTiming: ahora entre inicio y fin -> in_progress", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T14:30:00.000Z", end: "2026-09-22T15:30:00.000Z" }, NOW), "in_progress");
});

test("classifyLessonTiming: ahora exactamente en el fin -> finished (borde exclusivo del lado del fin)", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T14:00:00.000Z", end: "2026-09-22T15:00:00.000Z" }, NOW), "finished");
});

test("classifyLessonTiming: cancelada -> excluded sin importar el horario", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T14:30:00.000Z", end: "2026-09-22T15:30:00.000Z", status: "cancelled" }, NOW), "excluded");
});

test("classifyLessonTiming: reprogramada en curso -> in_progress (status válido)", () => {
  assert.equal(classifyLessonTiming({ start: "2026-09-22T14:30:00.000Z", end: "2026-09-22T15:30:00.000Z", status: "rescheduled" }, NOW), "in_progress");
});

test("selectCurrentOrNextOccurrence: prioriza la clase EN CURSO sobre una futura más próxima en el reloj", () => {
  const inProgress = { start: "2026-09-22T14:30:00.000Z", end: "2026-09-22T15:30:00.000Z" };
  const upcoming = { start: "2026-09-22T15:05:00.000Z", end: "2026-09-22T16:00:00.000Z" };
  const result = selectCurrentOrNextOccurrence([upcoming, inProgress], NOW);
  assert.equal(result?.timing, "in_progress");
  assert.equal(result?.occurrence, inProgress);
});

test("selectCurrentOrNextOccurrence: sin ninguna en curso, elige la futura más cercana", () => {
  const later = { start: "2026-09-22T18:00:00.000Z", end: "2026-09-22T19:00:00.000Z" };
  const sooner = { start: "2026-09-22T16:00:00.000Z", end: "2026-09-22T17:00:00.000Z" };
  const result = selectCurrentOrNextOccurrence([later, sooner], NOW);
  assert.equal(result?.timing, "upcoming");
  assert.equal(result?.occurrence, sooner);
});

test("selectCurrentOrNextOccurrence: ignora clases ya terminadas y canceladas", () => {
  const finished = { start: "2026-09-22T10:00:00.000Z", end: "2026-09-22T11:00:00.000Z" };
  const cancelledUpcoming = { start: "2026-09-22T16:00:00.000Z", end: "2026-09-22T17:00:00.000Z", status: "cancelled" };
  const result = selectCurrentOrNextOccurrence([finished, cancelledUpcoming], NOW);
  assert.equal(result, null);
});

test("selectCurrentOrNextOccurrence: sin candidatas válidas -> null", () => {
  assert.equal(selectCurrentOrNextOccurrence([], NOW), null);
});
