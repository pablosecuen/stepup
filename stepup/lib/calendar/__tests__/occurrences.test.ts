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

// ── Misma regla que la app anterior: la clase real se ve en SU horario; las ocurrencias con excepción no se dibujan como virtuales ──
const SERIE = "11111111-1111-1111-1111-111111111111";
const regla = { recurrenceId: SERIE, studentId: "s1", participantIds: ["s1"], cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }], modality: "online" as const, timezone: "America/Argentina/Buenos_Aires", startDate: "2026-10-19", endDate: null, status: "active" as const, classTitle: null, activityKind: "class" as const };
// 20/10/2026 (martes) 18:00 hora de Argentina = 21:00Z: la ocurrencia de la serie de esa semana.
const OCCURRENCE_KEY = `${SERIE}:w0:c0:d1:t1800:s0`;
const baseLesson = (overrides: Partial<MaterializedLessonForMerge> & { id: string }): MaterializedLessonForMerge => ({
  recurrenceId: null, recurrenceOccurrenceKey: null, primaryStudentId: "s1", studentName: "Alumno", level: "", lessonType: "individual", startAt: "2026-10-20T21:00:00.000Z", endAt: "2026-10-20T22:00:00.000Z", modality: "online", status: "scheduled", isRecurring: false, classTitle: null, activityKind: "class", freedByLessonId: null, notes: null, participantIds: ["s1"], ...overrides,
});
const day = (iso: string) => ({ rangeStart: new Date(`${iso}T03:00:00.000Z`), rangeEnd: new Date(new Date(`${iso}T03:00:00.000Z`).getTime() + 24 * 3600_000 - 1) });

test("una clase de serie MOVIDA a otro horario se ve en su horario real (no en el de la serie) y la ocurrencia original no queda como virtual", () => {
  const moved = baseLesson({ id: "movida", recurrenceId: SERIE, recurrenceOccurrenceKey: OCCURRENCE_KEY, isRecurring: true, status: "completed", startAt: "2026-10-20T20:30:00.000Z", endAt: "2026-10-20T21:30:00.000Z" });
  const items = buildCalendarViewForRange({ ...day("2026-10-20"), rules: [regla], exceptions: [], lessons: [moved] });
  assert.deepEqual(items.map((i) => [i.id, i.start, i.isMaterialized]), [["movida", "2026-10-20T20:30:00.000Z", true]]);
  // Un día en el que la clase real NO cae (pero sí la ocurrencia de la serie, si hubiera): nada duplicado ni fantasma.
  const other = buildCalendarViewForRange({ ...day("2026-10-21"), rules: [regla], exceptions: [], lessons: [] });
  assert.equal(other.length, 0);
});

test("si la clase de una ocurrencia cae FUERA del rango consultado, la ocurrencia no reaparece como virtual (los marcadores traen todas las clases de la serie)", () => {
  const markers = [{ id: "fuera", recurrenceId: SERIE, recurrenceOccurrenceKey: OCCURRENCE_KEY, status: "completed" as const }];
  const withMarkers = buildCalendarViewForRange({ ...day("2026-10-20"), rules: [regla], exceptions: [], lessons: [], occurrenceMarkers: markers });
  assert.equal(withMarkers.length, 0);
  const without = buildCalendarViewForRange({ ...day("2026-10-20"), rules: [regla], exceptions: [], lessons: [] });
  assert.equal(without.length, 1, "sin marcadores (comportamiento anterior) la ocurrencia se dibujaría virtual");
});

test("una ocurrencia REPROGRAMADA no se dibuja en su horario original aunque su clase de reemplazo esté fuera del rango; la cancelada y la excluida tampoco como virtuales", () => {
  for (const type of ["rescheduled", "cancelled", "excluded"] as const) {
    const items = buildCalendarViewForRange({ ...day("2026-10-20"), rules: [regla], exceptions: [{ recurrenceId: SERIE, occurrenceKey: OCCURRENCE_KEY, type, replacementLessonId: type === "rescheduled" ? "reemplazo-futuro" : null }], lessons: [] });
    assert.equal(items.length, 0, type);
  }
  const original = baseLesson({id:"original-materializada",recurrenceId:SERIE,recurrenceOccurrenceKey:OCCURRENCE_KEY});
  const real = buildCalendarViewForRange({...day("2026-10-20"),rules:[regla],exceptions:[{recurrenceId:SERIE,occurrenceKey:OCCURRENCE_KEY,type:"rescheduled",replacementLessonId:"fuera-de-la-semana"}],lessons:[original]});
  assert.equal(real.length,1,"la fila histórica sigue disponible");
  assert.equal(real[0].status,"scheduled","no se reescribe el estado guardado");
  assert.equal(visibleCalendarItems(real).length,0,"la original materializada tampoco ocupa un segundo carril");
});

test("la clase de reemplazo de una reprogramación aparece por su cuenta en su nuevo horario", () => {
  const replacement = baseLesson({ id: "reemplazo", status: "rescheduled", startAt: "2026-10-24T19:30:00.000Z", endAt: "2026-10-24T20:30:00.000Z" });
  const items = buildCalendarViewForRange({ ...day("2026-10-24"), rules: [regla], exceptions: [{ recurrenceId: SERIE, occurrenceKey: OCCURRENCE_KEY, type: "rescheduled", replacementLessonId: "reemplazo" }], lessons: [replacement] });
  assert.deepEqual(items.map((i) => [i.id, i.status]), [["reemplazo", "rescheduled"]]);
});

test("el resultado de una clase cerrada sin dictar llega a la tarjeta (composeCalendarView no lo descarta)", async () => {
  const items = buildCalendarViewForRange({ rangeStart: new Date("2026-09-14T00:00:00Z"), rangeEnd: new Date("2026-09-15T00:00:00Z"), rules: [], exceptions: [], lessons: [lesson({ id: "l1", status: "completed", closedOutcome: "cancelada_tarde" }), lesson({ id: "l2", status: "completed" })] });
  assert.equal(items.find((item) => item.id === "l1")?.closedOutcome, "cancelada_tarde");
  assert.equal(items.find((item) => item.id === "l2")?.closedOutcome, undefined);
  // `composeCalendarView` copia las clases campo por campo: si no pasa `closedOutcome`, la tarjeta vuelve a decir «Completada».
  const { readFileSync } = await import("node:fs");
  const view = readFileSync(new URL("../view.ts", import.meta.url), "utf8");
  assert.match(view, /closedOutcome: lesson\.closedOutcome \?\? null/);
});
