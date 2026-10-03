import { test } from "node:test";
import assert from "node:assert/strict";
import { recurrenceSeriesInputToPayload, validateNewRecurrenceSeriesInput, type NewRecurrenceSeriesInput } from "../recurrence-rules-mapping.ts";
import { validateNewSingleLessonInput, singleLessonInputToPayload, type NewSingleLessonInput } from "../calendar-lessons-mapping.ts";

const OPERATION_ID = "4f7c2f0e-9a3b-4c1d-8e55-0a1b2c3d4e5f";

function baseInput(overrides: Partial<NewRecurrenceSeriesInput> = {}): NewRecurrenceSeriesInput {
  return {
    operationId: OPERATION_ID,
    primaryStudentId: "s1",
    ruleType: "weekly",
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }],
    modality: "presencial",
    timezone: "America/Argentina/Buenos_Aires",
    startDate: "2026-10-01",
    endDate: null,
    classTitle: null,
    activityKind: "class",
    participantIds: ["s1"],
    ...overrides,
  };
}

test("validateNewRecurrenceSeriesInput: input válido con un solo alumno (principal automático) no produce errores de primaryStudentId", () => {
  const errors = validateNewRecurrenceSeriesInput(baseInput());
  assert.equal(
    errors.find((e) => e.field === "primaryStudentId"),
    undefined
  );
});

test("validateNewRecurrenceSeriesInput: primaryStudentId vacío se rechaza (nunca se infiere en silencio)", () => {
  const errors = validateNewRecurrenceSeriesInput(baseInput({ primaryStudentId: "" as unknown as string }));
  assert.ok(errors.some((e) => e.field === "primaryStudentId" && e.message === "Elegí quién es el alumno principal."));
});

test("validateNewRecurrenceSeriesInput: primaryStudentId fuera de participantIds se rechaza (payload contradictorio)", () => {
  const errors = validateNewRecurrenceSeriesInput(baseInput({ primaryStudentId: "s2", participantIds: ["s1", "s3"] }));
  assert.ok(errors.some((e) => e.field === "primaryStudentId" && e.message === "El alumno principal debe estar entre los participantes seleccionados."));
});

test("validateNewRecurrenceSeriesInput: primaryStudentId dentro de participantIds con varios alumnos no produce error", () => {
  const errors = validateNewRecurrenceSeriesInput(baseInput({ primaryStudentId: "s2", participantIds: ["s1", "s2", "s3"] }));
  assert.equal(
    errors.find((e) => e.field === "primaryStudentId"),
    undefined
  );
});

function singleLessonInput(overrides: Partial<NewSingleLessonInput> = {}): NewSingleLessonInput {
  return {
    operationId: OPERATION_ID,
    primaryStudentId: "s1",
    studentName: "Ana",
    level: "B1",
    lessonType: "individual",
    startAt: "2026-11-10T18:00:00.000Z",
    endAt: "2026-11-10T19:00:00.000Z",
    modality: "presencial",
    classTitle: null,
    activityKind: "class",
    notes: null,
    color: "#FCE4D2",
    participants: [{ studentId: "s1", studentName: "Ana", level: "B1" }],
    ...overrides,
  };
}

test("idempotencia de serie: sin operationId válido la validación temprana lo rechaza (nunca se inventa uno)", () => {
  for (const operationId of ["", "no-es-un-uuid", "123"]) {
    const errors = validateNewRecurrenceSeriesInput(baseInput({ operationId }));
    assert.ok(errors.some((e) => e.field === "operationId"), operationId);
  }
  assert.equal(validateNewRecurrenceSeriesInput(baseInput()).some((e) => e.field === "operationId"), false);
});

test("idempotencia de clase única: sin operationId válido la validación temprana lo rechaza", () => {
  for (const operationId of ["", "no-es-un-uuid"]) {
    const errors = validateNewSingleLessonInput(singleLessonInput({ operationId }));
    assert.ok(errors.some((e) => e.field === "operationId"), operationId);
  }
  assert.equal(validateNewSingleLessonInput(singleLessonInput()).length, 0);
});

test("el payload de ambos caminos lleva el operation_id del cliente tal cual (la acción nunca lo regenera)", () => {
  assert.equal(recurrenceSeriesInputToPayload(baseInput()).operation_id, OPERATION_ID);
  assert.equal(singleLessonInputToPayload(singleLessonInput()).operation_id, OPERATION_ID);
  // Dos envíos del MISMO borrador producen el MISMO payload de idempotencia; un borrador nuevo, otro.
  const other = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  assert.equal(singleLessonInputToPayload(singleLessonInput()).operation_id, singleLessonInputToPayload(singleLessonInput()).operation_id);
  assert.notEqual(singleLessonInputToPayload(singleLessonInput({ operationId: other })).operation_id, OPERATION_ID);
});
