import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quotaErrorMessage, isQuotaMessage, QUOTA_SQLSTATE } from "../quota-message.ts";
import { domainErrorMessage, GENERIC_ERROR_MESSAGE } from "../domain-error-message.ts";
import { actionErrorMessage } from "../action-error.ts";
import { translateImportError } from "../../backup/import-copy.ts";

// R3 — Los errores de cuota de la base (SQLSTATE 53400) llegan a la usuaria como un texto claro por rubro: sin tablas, SQL, claves
// internas ni cifras de los límites, y sin pasar por el mensaje genérico.

const MIGRATION = readFileSync("supabase/migrations/20261007100000_r3_quota_infrastructure.sql", "utf8");
const quotaKeys = [...MIGRATION.matchAll(/^  \('([a-z_]+)', (?:null|\d+), /gm)].map((m) => m[1]).filter((key) => !["report_preview", "report_pdf", "cloud_backup_analyze", "password_change_email"].includes(key));
const actionKeys = [...MIGRATION.matchAll(/^  \('(report_preview|report_pdf|cloud_backup_analyze|password_change_email)', \d+, \d+, /gm)].map((m) => m[1]);

const pg = (message: string, details: string) => ({ code: "53400", message, details, hint: null });

test("hay 37 categorías y 4 acciones en los valores por defecto de la migración (la prueba lee el SQL real)", () => {
  assert.equal(new Set(quotaKeys).size, 37);
  assert.equal(new Set(actionKeys).size, 4);
});

test("toda categoría de la base tiene un rubro en lenguaje simple (ninguna cae en el texto genérico)", () => {
  for (const key of quotaKeys) {
    const text = quotaErrorMessage(pg("quota_exceeded", key));
    assert.ok(text !== null, key);
    assert.doesNotMatch(text!, /un límite de uso de tu cuenta/, `${key} cae en el genérico: falta su rubro`);
  }
});

test("los textos nunca revelan tablas, claves internas, SQL ni cifras de límites", () => {
  const samples: string[] = [];
  for (const key of [...quotaKeys, "clave_desconocida"]) {
    for (const message of ["quota_exceeded", "quota_rate_exceeded", "quota_row_too_large"]) samples.push(quotaErrorMessage(pg(message, key))!);
  }
  for (const action of actionKeys) samples.push(quotaErrorMessage(pg("quota_rate_exceeded", action))!);
  for (const text of samples) {
    assert.doesNotMatch(text, /\d/, `cifras en: ${text}`);
    assert.doesNotMatch(text, /_|quota|public\.|relation|constraint|trigger|SQL|53400|owner|table/i, `término interno en: ${text}`);
    assert.ok(text.length < 200);
    assert.ok(isQuotaMessage(text), `isQuotaMessage no reconoce: ${text}`);
  }
});

test("distingue tope total, ventana de tiempo, tamaño y operaciones en curso", () => {
  assert.match(quotaErrorMessage(pg("quota_exceeded", "students"))!, /límite de alumnos/);
  assert.match(quotaErrorMessage(pg("quota_rate_exceeded", "report_pdf"))!, /demasiadas veces en poco tiempo/);
  assert.match(quotaErrorMessage(pg("quota_row_too_large", "report_records"))!, /demasiado grande/);
  assert.match(quotaErrorMessage(pg("quota_exceeded", "student_creation_claims_pending"))!, /en curso/);
});

test("un error que no es de cuota no se traduce (null) y el código es 53400", () => {
  assert.equal(QUOTA_SQLSTATE, "53400");
  assert.equal(quotaErrorMessage({ code: "23505", message: "duplicate key" }), null);
  assert.equal(quotaErrorMessage(new Error("quota_exceeded")), null);
  assert.equal(quotaErrorMessage(null), null);
  assert.equal(isQuotaMessage("Ese registro ya existe."), false);
});

test("domainErrorMessage y actionErrorMessage muestran el texto de cuota (no el genérico) y no lo registran como fallo inesperado", () => {
  const error = pg("quota_exceeded", "students");
  assert.match(domainErrorMessage(error), /límite de alumnos/);
  assert.notEqual(domainErrorMessage(error), GENERIC_ERROR_MESSAGE);
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    assert.match(actionErrorMessage("students", error), /límite de alumnos/);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [], "un límite de cuota es un resultado esperado: no se loguea como error inesperado");
});

test("un PostgrestError real (instancia de Error con code/details) también se traduce", () => {
  const error = Object.assign(new Error("quota_exceeded"), { code: "53400", details: "payments", hint: null });
  assert.match(domainErrorMessage(error), /límite de pagos/);
});

test("el asistente de importación deja pasar el texto de cuota tal cual (con su propio código) en vez de un mensaje de importación", () => {
  const text = quotaErrorMessage(pg("quota_rate_exceeded", "import_previews"))!;
  const translated = translateImportError(text, "analyze");
  assert.equal(translated.message, text);
  assert.equal(translated.code, "quota_exceeded");
  const total = quotaErrorMessage(pg("quota_exceeded", "import_runs"))!;
  assert.match(translateImportError(total, "apply").message, /límite de importaciones/);
});
