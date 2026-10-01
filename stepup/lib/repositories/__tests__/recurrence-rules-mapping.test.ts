import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewRecurrenceSeriesInput, type NewRecurrenceSeriesInput } from "../recurrence-rules-mapping.ts";

function baseInput(overrides: Partial<NewRecurrenceSeriesInput> = {}): NewRecurrenceSeriesInput {
  return {
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
