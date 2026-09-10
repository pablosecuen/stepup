import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeNextPath, isPrivatePath, DEFAULT_AUTH_REDIRECT } from "../safe-redirect.ts";

test("sanitizeNextPath: null/undefined/empty vuelven al fallback", () => {
  assert.equal(sanitizeNextPath(null), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath(undefined), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath(""), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: ruta interna permitida se conserva", () => {
  assert.equal(sanitizeNextPath("/calendario"), "/calendario");
  assert.equal(sanitizeNextPath("/alumnos/123"), "/alumnos/123");
});

test("sanitizeNextPath: rechaza dominio externo absoluto", () => {
  assert.equal(sanitizeNextPath("https://evil.example.com/phish"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("http://evil.com"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: rechaza protocol-relative (//host)", () => {
  assert.equal(sanitizeNextPath("//evil.com/x"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: rechaza esquemas peligrosos disfrazados de ruta", () => {
  assert.equal(sanitizeNextPath("/javascript:alert(1)"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("javascript:alert(1)"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: rechaza backslashes usados para simular host", () => {
  assert.equal(sanitizeNextPath("/\\evil.com"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: rechaza ruta interna no permitida (fuera de lista blanca)", () => {
  assert.equal(sanitizeNextPath("/configuracion-secreta"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("/login"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: decodifica antes de validar y rechaza si el resultado no es interno", () => {
  assert.equal(sanitizeNextPath("%2F%2Fevil.com"), DEFAULT_AUTH_REDIRECT);
});

test("sanitizeNextPath: encoding inválido no rompe, cae al fallback", () => {
  assert.equal(sanitizeNextPath("%"), DEFAULT_AUTH_REDIRECT);
});

test("isPrivatePath: reconoce rutas del área privada", () => {
  assert.equal(isPrivatePath("/inicio"), true);
  assert.equal(isPrivatePath("/alumnos"), true);
  assert.equal(isPrivatePath("/alumnos/42"), true);
  assert.equal(isPrivatePath("/calendario"), true);
  assert.equal(isPrivatePath("/cobros"), true);
  assert.equal(isPrivatePath("/configuracion"), true);
});

test("isPrivatePath: rutas públicas no se marcan como privadas", () => {
  assert.equal(isPrivatePath("/"), false);
  assert.equal(isPrivatePath("/login"), false);
  assert.equal(isPrivatePath("/registro"), false);
});
