import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERIC_ERROR_MESSAGE, domainErrorMessage } from "../domain-error-message.ts";
import { NETWORK_ERROR_MESSAGE } from "../../actions/network-guard.ts";

test("Error normal de dominio: se muestra su mensaje", () => {
  assert.equal(domainErrorMessage(new Error("Serie no encontrada.")), "Serie no encontrada.");
});

test("objeto PostgREST con código de dominio (raise exception de nuestra RPC): se muestra el mensaje útil, nunca details/hint", () => {
  const postgrest = {
    code: "P0001",
    message: "El preview de undo ya no es válido. Generá uno nuevo con preview_undo_backup_import.",
    details: "secreto: fila interna 123",
    hint: "revisá la tabla import_runs",
  };
  const shown = domainErrorMessage(postgrest);
  assert.equal(shown, postgrest.message);
  assert.doesNotMatch(shown, /secreto|import_runs|123/);
});

test("22023 / P0002 (validaciones propias) también se muestran", () => {
  assert.equal(domainErrorMessage({ code: "22023", message: "El respaldo trae la distribución 50/30/20 incompleta o inválida. No se importó nada." }), "El respaldo trae la distribución 50/30/20 incompleta o inválida. No se importó nada.");
  assert.equal(domainErrorMessage({ code: "P0002", message: "Alumno no encontrado." }), "Alumno no encontrado.");
});

test("23502 (el error real del bug): nunca expone columna, tabla ni la fila fallida", () => {
  const leaked = {
    code: "23502",
    message: 'null value in column "needs_percent" of relation "budget_distribution_settings" violates not-null constraint',
    details: "Failing row contains (<id de la cuenta QA descartable>, null, null, null, f, null, null)",
  };
  const shown = domainErrorMessage(leaked);
  assert.equal(shown, "Faltan datos obligatorios o no son válidos.");
  assert.doesNotMatch(shown, /needs_percent|budget_distribution|11111111|Failing row/);
});

test("códigos conocidos de Postgres se traducen a un texto genérico", () => {
  assert.equal(domainErrorMessage({ code: "42501", message: "permission denied for table students" }), "No tenés permiso para realizar esta acción.");
  assert.equal(domainErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }), "Ese registro ya existe.");
  assert.equal(domainErrorMessage({ code: "23503", message: "violates foreign key constraint" }), "No se pudo completar porque hay datos relacionados.");
  assert.equal(domainErrorMessage({ code: "40001", message: "could not serialize access" }), "Hubo un conflicto con otra operación. Intentá de nuevo.");
});

test("código desconocido o de PostgREST: genérico, aunque traiga un message", () => {
  assert.equal(domainErrorMessage({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage({ code: "XX000", message: "internal error in module foo" }), GENERIC_ERROR_MESSAGE);
});

test("un mensaje de dominio que parece interno (tabla/columna/URL/token) cae al genérico", () => {
  assert.equal(domainErrorMessage({ code: "P0001", message: 'relation "public.students" does not exist' }), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage(new Error("fallo en https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc")), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage(new Error("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc")), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage(new Error("línea 1\n    at fn (file.ts:1:1)")), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage({ code: "P0001", message: "x".repeat(400) }), GENERIC_ERROR_MESSAGE);
});

test("rechazo de red del navegador (TypeError) y fetch caído hacia Supabase: mensaje de red", () => {
  assert.equal(domainErrorMessage(new TypeError("Failed to fetch")), NETWORK_ERROR_MESSAGE);
  assert.equal(domainErrorMessage({ code: "", message: "TypeError: Failed to fetch", details: "stack...", hint: "" }), NETWORK_ERROR_MESSAGE);
  assert.equal(domainErrorMessage({ code: "", message: "TypeError: fetch failed" }), NETWORK_ERROR_MESSAGE);
});

test("valores desconocidos: string, número, null, undefined, objeto vacío -> genérico", () => {
  for (const value of ["boom", 42, null, undefined, {}, [], { code: "P0001" }, { message: 123 }]) {
    assert.equal(domainErrorMessage(value), GENERIC_ERROR_MESSAGE, JSON.stringify(value));
  }
});

test("un objeto sin código (no es una de nuestras RPC) no se muestra tal cual", () => {
  assert.equal(domainErrorMessage({ message: "No hay una sesión autenticada." }), GENERIC_ERROR_MESSAGE);
});

test("nunca se devuelven details, hint ni code en el texto final, sea cual sea la entrada", () => {
  const input = { code: "P0001", message: "Importación no encontrada.", details: "DETALLE-SECRETO", hint: "PISTA-SECRETA" };
  const shown = domainErrorMessage(input);
  assert.doesNotMatch(shown, /DETALLE-SECRETO|PISTA-SECRETA|P0001/);
});
