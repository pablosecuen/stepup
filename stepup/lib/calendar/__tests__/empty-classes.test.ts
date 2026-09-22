import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmptyClassesSummary, type EmptyClassLessonForEngine } from "../empty-classes.ts";
import type { RecurrenceRuleForEngine } from "../types.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z"); // martes

function rule(overrides: Partial<RecurrenceRuleForEngine> = {}): RecurrenceRuleForEngine {
  return {
    recurrenceId: "r1",
    studentId: null,
    participantIds: [],
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }] }], // martes 10:00
    modality: "online",
    timezone: "America/Argentina/Buenos_Aires",
    startDate: "2026-09-21", // lunes
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

function lesson(overrides: Partial<EmptyClassLessonForEngine> = {}): EmptyClassLessonForEngine {
  return {
    id: "l1",
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    status: "scheduled",
    startAt: "2026-09-23T13:00:00.000Z",
    isRecurring: false,
    participantIds: [],
    classTitle: null,
    ...overrides,
  };
}

test("buildEmptyClassesSummary: serie activa sin participantes cuenta como vacía, con la próxima ocurrencia real como target", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule()], lessons: [], exceptions: [], now: NOW });
  assert.equal(summary.emptySeriesCount, 1);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].kind, "series");
  assert.equal(summary.items[0].title, "Serie recurrente sin alumnos");
});

test("buildEmptyClassesSummary: serie CON participantes nunca cuenta como vacía", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule({ participantIds: ["s1"] })], lessons: [], exceptions: [], now: NOW });
  assert.equal(summary.emptySeriesCount, 0);
  assert.equal(summary.items.length, 0);
});

test("buildEmptyClassesSummary: serie PAUSADA nunca cuenta como vacía (sólo status active)", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule({ status: "paused" })], lessons: [], exceptions: [], now: NOW });
  assert.equal(summary.emptySeriesCount, 0);
});

test("buildEmptyClassesSummary: título propio de la serie reemplaza el genérico", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule({ classTitle: "Grupo de conversación" })], lessons: [], exceptions: [], now: NOW });
  assert.equal(summary.items[0].title, "Grupo de conversación");
});

test("buildEmptyClassesSummary: clase suelta futura sin alumnos cuenta como vacía", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [], lessons: [lesson()], exceptions: [], now: NOW });
  assert.equal(summary.standaloneEmptyLessonCount, 1);
  assert.equal(summary.items[0].kind, "standalone");
});

test("buildEmptyClassesSummary: clase suelta YA PASADA nunca cuenta (nada que hacer con el pasado)", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [], lessons: [lesson({ startAt: "2026-09-20T13:00:00.000Z" })], exceptions: [], now: NOW });
  assert.equal(summary.standaloneEmptyLessonCount, 0);
});

test("buildEmptyClassesSummary: clase suelta CON participantes nunca cuenta como vacía", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [], lessons: [lesson({ participantIds: ["s1"] })], exceptions: [], now: NOW });
  assert.equal(summary.standaloneEmptyLessonCount, 0);
});

test("buildEmptyClassesSummary: una ocurrencia MATERIALIZADA de una serie vacía nunca se cuenta dos veces (a nivel de serie, no de clase suelta)", () => {
  const materialized = lesson({ id: "m1", recurrenceId: "r1", recurrenceOccurrenceKey: "r1:w0:c0:d1:t1000:s0", isRecurring: true, startAt: "2026-09-22T13:00:00.000Z" });
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule()], lessons: [materialized], exceptions: [], now: NOW });
  assert.equal(summary.emptySeriesCount, 1);
  assert.equal(summary.standaloneEmptyLessonCount, 0, "isRecurring=true nunca cuenta como clase suelta");
  assert.equal(summary.items.length, 1);
});

test("buildEmptyClassesSummary: sin ninguna ocurrencia futura real dentro del horizonte, la serie vacía no se muestra", () => {
  const summary = buildEmptyClassesSummary({ recurrenceRules: [rule({ endDate: "2026-09-21" })], lessons: [], exceptions: [], now: NOW });
  assert.equal(summary.items.length, 0, "la serie ya terminó el mismo día que empezó, sin ocurrencias reales");
});
