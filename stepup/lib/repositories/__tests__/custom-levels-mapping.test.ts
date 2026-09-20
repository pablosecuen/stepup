import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateCustomLevelName,
  isReservedStandardLevelName,
  normalizeCustomLevelName,
  toCustomLevelRecord,
  validateLevelName,
  type CustomLevelRecord,
} from "../custom-levels-mapping.ts";

test("normalizeCustomLevelName: recorta y colapsa espacios repetidos", () => {
  assert.equal(normalizeCustomLevelName("  B1   avanzado  "), "B1 avanzado");
});

test("isReservedStandardLevelName: detecta los 6 niveles CEFR sin importar mayúsculas", () => {
  assert.equal(isReservedStandardLevelName("a1"), true);
  assert.equal(isReservedStandardLevelName("C2"), true);
  assert.equal(isReservedStandardLevelName("b1 "), true);
  assert.equal(isReservedStandardLevelName("Infantes"), false);
});

test("isDuplicateCustomLevelName: insensible a mayúsculas y espacios", () => {
  const levels: CustomLevelRecord[] = [{ id: "1", name: "Infantes", createdAt: "2026-01-01" }];
  assert.equal(isDuplicateCustomLevelName(levels, "infantes"), true);
  assert.equal(isDuplicateCustomLevelName(levels, "  INFANTES  "), true);
  assert.equal(isDuplicateCustomLevelName(levels, "Avanzado"), false);
});

test("isDuplicateCustomLevelName: excluye el propio id (renombrar sobre sí mismo no es duplicado)", () => {
  const levels: CustomLevelRecord[] = [{ id: "1", name: "Infantes", createdAt: "2026-01-01" }];
  assert.equal(isDuplicateCustomLevelName(levels, "Infantes", "1"), false);
});

test("validateLevelName: rechaza nombre vacío", () => {
  const error = validateLevelName("   ", []);
  assert.equal(error?.message, "Ponele un nombre al nivel.");
});

test("validateLevelName: rechaza un nombre reservado (CEFR estándar)", () => {
  const error = validateLevelName("b2", []);
  assert.equal(error?.message, "Ese nombre ya corresponde a un nivel estándar (A1-C2).");
});

test("validateLevelName: rechaza un duplicado de un nivel personalizado ya existente", () => {
  const levels: CustomLevelRecord[] = [{ id: "1", name: "Infantes", createdAt: "2026-01-01" }];
  const error = validateLevelName("infantes", levels);
  assert.equal(error?.message, "Ya existe un nivel personalizado con ese nombre.");
});

test("validateLevelName: nombre nuevo válido no produce error", () => {
  const error = validateLevelName("Avanzado", []);
  assert.equal(error, null);
});

test("toCustomLevelRecord: mapea la fila real a la forma del dominio", () => {
  const record = toCustomLevelRecord({
    id: "abc",
    owner_id: "owner-1",
    legacy_mobile_id: null,
    name: "Infantes",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(record, { id: "abc", name: "Infantes", createdAt: "2026-01-01T00:00:00.000Z" });
});
