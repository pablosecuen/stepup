import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBackupPayload, isDateKey, isIsoDateTime } from "../validation.ts";
import { BACKUP_IMPORT_LIMITS } from "../limits.ts";

function minimalV1(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    appVersion: "1.0.0",
    students: [],
    profiles: {},
    pedagogicalLessons: [],
    calendarLessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    teacherAvailability: null,
    ...overrides,
  };
}

test("acepta un backup v1 mínimo válido y lo normaliza a v2 con financieras vacías", () => {
  const result = validateBackupPayload(minimalV1());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.backup.schemaVersion, 2);
    assert.deepEqual(result.backup.paymentCharges, []);
  }
});

test("rechaza un documento que no es objeto", () => {
  const result = validateBackupPayload([1, 2, 3]);
  assert.equal(result.ok, false);
});

test("rechaza schemaVersion desconocida", () => {
  const result = validateBackupPayload(minimalV1({ schemaVersion: 99 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "unknown_schema_version"));
});

test("rechaza __proto__ a cualquier profundidad", () => {
  // Object.keys() nunca ve "__proto__" en un literal `{ __proto__: x }` (la
  // sintaxis lo trata como setter de prototipo, no como propiedad propia) —
  // el vector real de ataque es JSON.parse, que sí crea una propiedad
  // propia enumerable llamada "__proto__". Hay que construir el caso de
  // prueba así para que sea representativo del riesgo real.
  const hostile = JSON.parse('{"id":"1","nested":{"__proto__":{"polluted":true}}}');
  const result = validateBackupPayload(minimalV1({ students: [hostile] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "dangerous_key"));
});

test("rechaza constructor/prototype como clave propia dentro de un array anidado", () => {
  const result = validateBackupPayload(minimalV1({ students: [{ id: "1", list: [{ constructor: "x" }] }] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "dangerous_key"));
});

test("falta una colección obligatoria -> missing_field", () => {
  const doc = minimalV1();
  delete (doc as Record<string, unknown>).calendarLessons;
  const result = validateBackupPayload(doc);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "missing_field" && e.path === "calendarLessons"));
});

test("v2 exige las 4 colecciones financieras obligatorias", () => {
  const doc = minimalV1({ schemaVersion: 2 });
  const result = validateBackupPayload(doc);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "missing_field" && e.path === "paymentCharges"));
});

test("colecciones opcionales ausentes nunca son error", () => {
  const result = validateBackupPayload(minimalV1());
  assert.equal(result.ok, true);
});

test("customLevels se lee del JSON crudo aunque el móvil nunca lo restaure (corrección del gap real)", () => {
  const result = validateBackupPayload(minimalV1({ customLevels: [{ id: "cl1", name: "B1 avanzado", createdAt: "2026-01-01T00:00:00.000Z" }] }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.backup.customLevels?.length, 1);
});

test("rechaza más filas que MAX_ROWS_PER_COLLECTION", () => {
  const students = Array.from({ length: BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION + 1 }, (_, i) => ({ id: `s${i}` }));
  const result = validateBackupPayload(minimalV1({ students }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "too_many_rows"));
});

test("rechaza un string libre más largo que MAX_FREE_TEXT_LENGTH, a cualquier profundidad", () => {
  const longText = "a".repeat(BACKUP_IMPORT_LIMITS.MAX_FREE_TEXT_LENGTH + 1);
  const result = validateBackupPayload(minimalV1({ students: [{ id: "1", notes: longText }] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "string_too_long"));
});

test("rechaza JSON anidado más profundo que MAX_JSON_DEPTH", () => {
  let nested: unknown = "leaf";
  for (let i = 0; i < BACKUP_IMPORT_LIMITS.MAX_JSON_DEPTH + 5; i += 1) nested = { child: nested };
  const result = validateBackupPayload(minimalV1({ students: [{ id: "1", deep: nested }] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "too_deep"));
});

test("acumula todos los errores encontrados, no corta en el primero (salvo los estructurales)", () => {
  const doc = minimalV1({ schemaVersion: 99 });
  delete (doc as Record<string, unknown>).calendarLessons;
  const result = validateBackupPayload(doc);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((e) => e.code === "unknown_schema_version"));
    assert.ok(result.errors.some((e) => e.code === "missing_field"));
  }
});

test("isDateKey: rechaza fecha de calendario inválida (31 de febrero)", () => {
  assert.equal(isDateKey("2026-02-31"), false);
  assert.equal(isDateKey("2026-02-28"), true);
});

test("isIsoDateTime: laxo, cualquier string parseable por Date", () => {
  assert.equal(isIsoDateTime("2026-09-01T00:00:00.000Z"), true);
  assert.equal(isIsoDateTime("no es una fecha"), false);
});

test("resume las 3 colecciones excluidas de v1 con motivo, nunca las omite en silencio", () => {
  const result = validateBackupPayload(
    minimalV1({
      profiles: {
        s1: { id: "s1", statusHistory: [{ status: "activo", date: "2026-01-01" }], priceHistory: [{ price: 100, date: "2026-01-01" }] },
      },
    })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.excludedCollections.studentStatusHistory.count, 1);
    assert.equal(result.excludedCollections.studentPriceHistory.count, 1);
    assert.ok(result.excludedCollections.studentStatusHistory.reason.length > 0);
  }
});
