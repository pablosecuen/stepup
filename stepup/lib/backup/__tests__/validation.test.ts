import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBackupPayload, isDateKey, isIsoDateTime, countNestedRows } from "../validation.ts";
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

// ---------------------------------------------------------------------------
// R6 — límites por importación: −1 / exacto / +1, rechazo temprano y barato
// ---------------------------------------------------------------------------

function items(count: number, prefix = "x"): Array<{ id: string }> {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}` }));
}

/** Reparte `total` filas entre colecciones sin pasar el tope por colección. */
function withTotalRows(total: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let left = total;
  for (const key of ["students", "calendarLessons", "payments", "paymentCharges", "customLevels"]) {
    const n = Math.min(BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION, left);
    out[key] = items(n, key[0]);
    left -= n;
  }
  return out;
}

function codes(result: ReturnType<typeof validateBackupPayload>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

test("R6: exactamente MAX_ROWS_PER_COLLECTION entra y una más se rechaza", () => {
  assert.equal(validateBackupPayload(minimalV1({ students: items(BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION) })).ok, true);
  assert.deepEqual(codes(validateBackupPayload(minimalV1({ students: items(BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION + 1) }))), ["too_many_rows"]);
});

test("R6: exactamente MAX_ROWS_TOTAL entra y una más se rechaza", () => {
  assert.equal(validateBackupPayload(minimalV1(withTotalRows(BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL))).ok, true);
  assert.deepEqual(codes(validateBackupPayload(minimalV1(withTotalRows(BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL + 1)))), ["too_many_rows_total"]);
});

function withNested(count: number): Record<string, unknown> {
  return { profiles: { p1: { id: "p1", levelHistory: items(count, "lh") } } };
}

test("R6: exactamente MAX_NESTED_ROWS filas anidadas entran y una más se rechaza", () => {
  assert.equal(validateBackupPayload(minimalV1(withNested(BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS))).ok, true);
  assert.deepEqual(codes(validateBackupPayload(minimalV1(withNested(BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS + 1)))), ["too_many_nested_rows"]);
});

test("R6: el trabajo total (contadas + anidadas) se controla aunque ninguna de las dos pase sola", () => {
  const half = Math.floor(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS / 2);
  const at = { students: items(half), ...withNested(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS - half) };
  const over = { students: items(half), ...withNested(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS - half + 1) };
  assert.equal(validateBackupPayload(minimalV1(at)).ok, true);
  assert.deepEqual(codes(validateBackupPayload(minimalV1(over))), ["too_much_work"]);
});

test("R6: cuenta las filas anidadas de clases, series y registros", () => {
  const nested = countNestedRows({
    profiles: { a: { levelHistory: [{}, {}] }, b: { levelHistory: [{}] } },
    calendarLessons: [{ participants: [{}, {}, {}] }, {}],
    recurrenceRules: [{ participantStudentIds: ["x", "y"] }],
    pedagogicalLessons: [{ roster: [{}], attendance: [{}, {}], evaluations: [{}], homeworkReviews: [{}, {}, {}] }],
  });
  assert.equal(nested, 3 + 3 + 2 + 7);
  assert.equal(countNestedRows({}), 0);
  assert.equal(countNestedRows({ profiles: [1, 2], calendarLessons: "x" }), 0, "formas raras no rompen el conteo");
});

test("R6: el rechazo por tamaño es TEMPRANO: no recorre textos ni profundidad del documento", () => {
  const longText = "a".repeat(BACKUP_IMPORT_LIMITS.MAX_FREE_TEXT_LENGTH + 1);
  const students = Array.from({ length: BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION + 1 }, (_, i) => ({ id: `s${i}`, notes: longText }));
  assert.deepEqual(codes(validateBackupPayload(minimalV1({ students }))), ["too_many_rows"], "sólo el exceso de filas: nunca llegó a mirar los textos");
});

test("R6: un arreglo gigantesco se rechaza sin reventar la pila ni tardar", () => {
  const started = Date.now();
  const result = validateBackupPayload(minimalV1({ students: new Array(300_000).fill({ id: "x" }) }));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("too_many_rows"));
  assert.ok(Date.now() - started < 1500, "rechazo inmediato");
});

test("R6: la profundidad se mide con un bucle (un arreglo grande y plano no usa la pila)", () => {
  const result = validateBackupPayload(minimalV1({ students: items(BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION) }));
  assert.equal(result.ok, true);
});

test("R6: una colección que no es lista, un elemento sin id o una referencia obligatoria ausente se rechazan antes de llamar a la base", () => {
  assert.deepEqual(codes(validateBackupPayload(minimalV1({ students: {} }))), ["invalid_collection"]);
  assert.deepEqual(codes(validateBackupPayload(minimalV1({ students: [{ name: "sin id" }] }))), ["invalid_item"]);
  assert.deepEqual(codes(validateBackupPayload(minimalV1({ students: [{ id: "   " }] }))), ["invalid_item"]);
  assert.ok(codes(validateBackupPayload(minimalV1({ schemaVersion: 2, paymentCharges: [], payments: [], paymentAdjustments: [], paymentAllocations: [{ id: "a1" }] }))).includes("invalid_item"));
  assert.ok(codes(validateBackupPayload(minimalV1({ schemaVersion: 2, paymentCharges: [], payments: [], paymentAllocations: [], paymentAdjustments: [{ id: "j1" }] }))).includes("invalid_item"));
  assert.ok(codes(validateBackupPayload(minimalV1({ packageCreditMovements: [{ id: "m1" }] }))).includes("invalid_item"));
  // Las excepciones de series no llevan `id`: se identifican por serie + ocurrencia.
  assert.equal(validateBackupPayload(minimalV1({ recurrenceExceptions: [{ recurrenceId: "r", occurrenceKey: "k", exceptionType: "cancelled" }] })).ok, true);
});

test("R6: importación vacía y mínima válidas", () => {
  assert.equal(validateBackupPayload(minimalV1()).ok, true);
  assert.equal(validateBackupPayload(minimalV1({ students: items(1) })).ok, true);
});
