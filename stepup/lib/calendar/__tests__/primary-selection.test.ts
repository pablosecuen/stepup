import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExplicitPrimaryStudentId, nextPrimaryAfterToggle } from "../primary-selection.ts";

test("resolveExplicitPrimaryStudentId: un solo alumno seleccionado se asigna automáticamente", () => {
  const result = resolveExplicitPrimaryStudentId(["s1"], null);
  assert.deepEqual(result, { primaryStudentId: "s1" });
});

test("resolveExplicitPrimaryStudentId: un solo alumno seleccionado ignora cualquier valor enviado (sigue siendo el único posible)", () => {
  const result = resolveExplicitPrimaryStudentId(["s1"], "otro-id-cualquiera");
  assert.deepEqual(result, { primaryStudentId: "s1" });
});

test("resolveExplicitPrimaryStudentId: dos o más seleccionados exige una elección explícita presente", () => {
  const result = resolveExplicitPrimaryStudentId(["s1", "s2"], "s2");
  assert.deepEqual(result, { primaryStudentId: "s2" });
});

test("resolveExplicitPrimaryStudentId: dos o más seleccionados, sin elección enviada → error, nunca cae al primero por descarte", () => {
  const result = resolveExplicitPrimaryStudentId(["s1", "s2", "s3"], null);
  assert.deepEqual(result, { error: "Elegí quién es el alumno principal." });
});

test("resolveExplicitPrimaryStudentId: dos o más seleccionados, id enviado que NO está entre los seleccionados → error (desmarcado o payload manipulado)", () => {
  const result = resolveExplicitPrimaryStudentId(["s1", "s2"], "s3");
  assert.deepEqual(result, { error: "Elegí quién es el alumno principal." });
});

test("resolveExplicitPrimaryStudentId: cero alumnos seleccionados → error de selección, nunca de principal", () => {
  const result = resolveExplicitPrimaryStudentId([], null);
  assert.deepEqual(result, { error: "Elegí al menos un alumno." });
});

test("resolveExplicitPrimaryStudentId: nunca elige por orden alfabético/array — con varios seleccionados y sin elección, el primero del array NUNCA se usa silenciosamente", () => {
  const selected = ["zzz-ultimo-alfabetico", "aaa-primero-alfabetico"];
  const result = resolveExplicitPrimaryStudentId(selected, null);
  assert.ok("error" in result, "debe rechazar, nunca elegir solo");
});

test("nextPrimaryAfterToggle: 0 → 1 seleccionado, se auto-asigna al único", () => {
  assert.equal(nextPrimaryAfterToggle(0, ["s1"], ""), "s1");
});

test("nextPrimaryAfterToggle: 1 → 2 seleccionados, el auto-asignado anterior se limpia (hallazgo real del E2E) — nunca queda 'pegado' sin elección real", () => {
  assert.equal(nextPrimaryAfterToggle(1, ["s1", "s2"], "s1"), "", "s1 se había auto-asignado al ser el único; al aparecer s2 deja de ser una elección real");
});

test("nextPrimaryAfterToggle: 2 → 3 seleccionados, el principal ya elegido explícitamente se conserva", () => {
  assert.equal(nextPrimaryAfterToggle(2, ["s1", "s2", "s3"], "s2"), "s2");
});

test("nextPrimaryAfterToggle: 3 → 2, se desmarca a alguien que NO era el principal — se conserva", () => {
  assert.equal(nextPrimaryAfterToggle(3, ["s1", "s2"], "s2"), "s2");
});

test("nextPrimaryAfterToggle: 3 → 2, se desmarca justo al principal — se invalida (nunca queda apuntando a alguien ausente)", () => {
  assert.equal(nextPrimaryAfterToggle(3, ["s1", "s3"], "s2"), "");
});

test("nextPrimaryAfterToggle: 2 → 1, se auto-asigna al único que queda sin importar si era el principal antes", () => {
  assert.equal(nextPrimaryAfterToggle(2, ["s2"], "s1"), "s2");
});
