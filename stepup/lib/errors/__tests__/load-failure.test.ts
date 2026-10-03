import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeLoadFailure, formatLoadFailureLog } from "../load-failure.ts";

class DbUnauthenticatedError extends Error {
  constructor() {
    super("No hay una sesión real activa.");
    this.name = "DbUnauthenticatedError";
  }
}

test("sesión vencida se distingue de cualquier otra falla", () => {
  assert.deepEqual(describeLoadFailure(new DbUnauthenticatedError()), { kind: "unauthenticated", name: "DbUnauthenticatedError" });
});

test("error de PostgREST/Postgres: se identifica por código, sin copiar mensaje, details ni hint", () => {
  const postgrest = { code: "42501", message: 'permission denied for table payment_charges', details: "Failing row contains (03e8e8f0…)", hint: "revisá los grants" };
  const failure = describeLoadFailure(postgrest);
  assert.deepEqual(failure, { kind: "database", code: "42501", name: undefined });
  const log = formatLoadFailureLog("inicio", failure);
  assert.doesNotMatch(log, /payment_charges|Failing row|03e8e8f0|revisá/);
  assert.match(log, /"code":"42501"/);
  assert.equal(describeLoadFailure({ code: "PGRST301", message: "JWT expired" }).kind, "database");
  assert.equal(describeLoadFailure({ code: "57014", message: "canceling statement due to statement timeout" }).code, "57014");
});

test("red y rechazos de fetch no se confunden con errores de datos", () => {
  assert.equal(describeLoadFailure(new TypeError("fetch failed")).kind, "network");
  assert.equal(describeLoadFailure(new TypeError("Failed to fetch")).kind, "network");
  assert.equal(describeLoadFailure({ name: "AuthRetryableFetchError", status: 0 }).kind, "network");
});

test("errores desconocidos nunca exponen su mensaje", () => {
  const failure = describeLoadFailure(new RangeError("Fecha local inválida: 2026-02-30 de PRUEBA ALUMNO"));
  assert.deepEqual(failure, { kind: "unknown", name: "RangeError", code: undefined });
  assert.doesNotMatch(formatLoadFailureLog("inicio", failure), /PRUEBA|2026-02-30/);
  for (const value of [null, undefined, "boom", 42, {}, [], { code: "x".repeat(200) }]) {
    assert.equal(describeLoadFailure(value).kind, "unknown", JSON.stringify(value));
  }
});

test("Inicio ya no oculta la causa: registra el fallo y distingue la sesión vencida", () => {
  const page = readFileSync(fileURLToPath(new URL("../../../app/(app)/inicio/page.tsx", import.meta.url)), "utf8");
  assert.match(page, /logLoadFailure\("inicio", error\)/);
  assert.doesNotMatch(page, /\} catch \{/, "no puede volver a ser un catch vacío");
  assert.match(page, /failure\.kind === "unauthenticated"/);
});
