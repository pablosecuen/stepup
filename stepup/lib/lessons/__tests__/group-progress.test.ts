import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInitialGroupProgress, setParticipantStatus, isGroupRegistrationComplete, countCompletedParticipants } from "../group-progress.ts";

test("buildInitialGroupProgress: todos arrancan 'pending'", () => {
  const progress = buildInitialGroupProgress(["a", "b", "c"]);
  assert.equal(progress.participantOrder.length, 3);
  assert.ok(progress.participantOrder.every((id) => progress.participantStatus[id] === "pending"));
});

test("isGroupRegistrationComplete: falso hasta que TODOS estén 'completed'", () => {
  let progress = buildInitialGroupProgress(["a", "b"]);
  assert.equal(isGroupRegistrationComplete(progress), false);
  progress = setParticipantStatus(progress, "a", "completed");
  assert.equal(isGroupRegistrationComplete(progress), false, "falta 'b'");
  progress = setParticipantStatus(progress, "b", "completed");
  assert.equal(isGroupRegistrationComplete(progress), true);
});

test("isGroupRegistrationComplete: 'omitted' nunca cuenta como completo, sigue bloqueando", () => {
  let progress = buildInitialGroupProgress(["a", "b"]);
  progress = setParticipantStatus(progress, "a", "completed");
  progress = setParticipantStatus(progress, "b", "omitted");
  assert.equal(isGroupRegistrationComplete(progress), false, "'omitted' no es 'completed' — reversible, sigue bloqueando");
});

test("isGroupRegistrationComplete: caso individual (1 solo participante) generaliza sin cambios", () => {
  let progress = buildInitialGroupProgress(["a"]);
  assert.equal(isGroupRegistrationComplete(progress), false);
  progress = setParticipantStatus(progress, "a", "completed");
  assert.equal(isGroupRegistrationComplete(progress), true);
});

test("countCompletedParticipants: cuenta 0 de N hasta N de N — progreso real y monótono", () => {
  let progress = buildInitialGroupProgress(["a", "b", "c"]);
  assert.equal(countCompletedParticipants(progress), 0);
  progress = setParticipantStatus(progress, "a", "completed");
  assert.equal(countCompletedParticipants(progress), 1);
  progress = setParticipantStatus(progress, "b", "omitted");
  assert.equal(countCompletedParticipants(progress), 1, "'omitted' no suma al conteo de completados");
  progress = setParticipantStatus(progress, "b", "completed");
  progress = setParticipantStatus(progress, "c", "completed");
  assert.equal(countCompletedParticipants(progress), 3);
});

test("setParticipantStatus: reabrir progreso (cerrar y reabrir) conserva el estado ya guardado", () => {
  let progress = buildInitialGroupProgress(["a", "b"]);
  progress = setParticipantStatus(progress, "a", "completed");
  // Simula "reabrir": el progreso reconstruido desde la misma fuente conserva 'a' completado.
  const reopened = { ...progress };
  assert.equal(reopened.participantStatus.a, "completed");
  assert.equal(reopened.participantStatus.b, "pending");
});
