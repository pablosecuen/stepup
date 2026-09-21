import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdhocClassHeld, validateAdhocRegistrationInput, type AdhocRegistrationInput } from "../adhoc.ts";

test("isAdhocClassHeld: 'clase_dictada' siempre se dictó", () => {
  assert.equal(isAdhocClassHeld("clase_dictada", false), true);
  assert.equal(isAdhocClassHeld("clase_dictada", true), true);
});

test("isAdhocClassHeld: 'profesora_ausente' nunca se dictó", () => {
  assert.equal(isAdhocClassHeld("profesora_ausente", false), false);
  assert.equal(isAdhocClassHeld("profesora_ausente", true), false);
});

test("isAdhocClassHeld: 'feriado' sólo se dictó con la excepción marcada", () => {
  assert.equal(isAdhocClassHeld("feriado", false), false);
  assert.equal(isAdhocClassHeld("feriado", true), true);
});

function input(overrides: Partial<AdhocRegistrationInput> = {}): AdhocRegistrationInput {
  return { studentIds: ["st_1"], date: "2026-09-22", time: "10:00", durationMinutes: 60, modality: "presencial", ...overrides };
}

test("validateAdhocRegistrationInput: formulario completo no tiene errores", () => {
  assert.deepEqual(validateAdhocRegistrationInput(input()), []);
});

test("validateAdhocRegistrationInput: exige al menos un alumno", () => {
  assert.deepEqual(validateAdhocRegistrationInput(input({ studentIds: [] })), ["Elegí al menos un alumno."]);
});

test("validateAdhocRegistrationInput: exige fecha, hora y modalidad", () => {
  const errors = validateAdhocRegistrationInput(input({ date: "", time: "", modality: "" }));
  assert.deepEqual(errors, ["Falta la fecha.", "Falta la hora.", "Falta la modalidad."]);
});

test("validateAdhocRegistrationInput: duración 0 o negativa es inválida", () => {
  assert.deepEqual(validateAdhocRegistrationInput(input({ durationMinutes: 0 })), ["La duración tiene que ser mayor a 0."]);
  assert.deepEqual(validateAdhocRegistrationInput(input({ durationMinutes: -5 })), ["La duración tiene que ser mayor a 0."]);
});

test("validateAdhocRegistrationInput: acumula todos los errores reales a la vez", () => {
  const errors = validateAdhocRegistrationInput({ studentIds: [], date: "", time: "", durationMinutes: 0, modality: "" });
  assert.equal(errors.length, 5);
});
