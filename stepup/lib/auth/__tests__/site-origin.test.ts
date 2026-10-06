import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_PRODUCTION_SITE_HOSTS, resolveSiteOrigin } from "../site-origin.ts";

/** R1 — NEXT_PUBLIC_SITE_URL como origen canónico de los enlaces de correo; nunca un origen inferido de la solicitud. */
const prod = (value: string | undefined, extra: Record<string, string> = {}) => resolveSiteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: value, ...extra });

test("Production: https://teacherflowapp.com es el origen canónico (con o sin barra final)", () => {
  assert.deepEqual(prod("https://teacherflowapp.com"), { ok: true, origin: "https://teacherflowapp.com" });
  assert.deepEqual(prod("https://teacherflowapp.com/"), { ok: true, origin: "https://teacherflowapp.com" });
  assert.deepEqual(prod("  https://teacherflowapp.com  "), { ok: true, origin: "https://teacherflowapp.com" });
  assert.deepEqual([...ALLOWED_PRODUCTION_SITE_HOSTS], ["teacherflowapp.com"]);
});

test("Production: sin variable → falla (nunca se infiere de los encabezados)", () => {
  assert.deepEqual(prod(undefined), { ok: false, reason: "missing" });
  assert.deepEqual(prod(""), { ok: false, reason: "missing" });
  assert.deepEqual(prod("   "), { ok: false, reason: "missing" });
});

test("Production: sólo HTTPS y sólo un host permitido", () => {
  assert.deepEqual(prod("http://teacherflowapp.com"), { ok: false, reason: "invalid" }, "http no");
  assert.deepEqual(prod("https://evil.example"), { ok: false, reason: "not_allowed" });
  assert.deepEqual(prod("https://teacherflow-web.vercel.app"), { ok: false, reason: "not_allowed" }, "el alias de Vercel no es el origen canónico");
  assert.deepEqual(prod("https://www.teacherflowapp.com"), { ok: false, reason: "not_allowed" });
  assert.deepEqual(prod("https://teacherflowapp.com.evil.example"), { ok: false, reason: "not_allowed" });
  assert.deepEqual(prod("https://evil.example@teacherflowapp.com"), { ok: false, reason: "invalid" }, "credenciales en la URL");
});

test("Production: sólo un origen (sin ruta, consulta, fragmento ni basura)", () => {
  for (const value of ["https://teacherflowapp.com/inicio", "https://teacherflowapp.com/?a=1", "https://teacherflowapp.com/#x", "no-es-una-url", "javascript:alert(1)", "//teacherflowapp.com", "ftp://teacherflowapp.com"]) {
    assert.equal(prod(value).ok, false, value);
  }
});

test("Production: un origen local sólo se admite fuera de Vercel (para probar `next start`), nunca desplegado", () => {
  assert.deepEqual(prod("http://localhost:3000"), { ok: true, origin: "http://localhost:3000" });
  assert.deepEqual(prod("http://127.0.0.1:3910"), { ok: true, origin: "http://127.0.0.1:3910" });
  assert.equal(prod("http://localhost:3000", { VERCEL: "1" }).ok, false, "en Vercel nunca");
  assert.equal(prod("https://localhost", { VERCEL: "1" }).ok, false);
});

test("Desarrollo: la variable es opcional; si está, debe ser un origen válido", () => {
  assert.deepEqual(resolveSiteOrigin({ NODE_ENV: "development" }), { ok: false, reason: "missing" });
  assert.deepEqual(resolveSiteOrigin({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), { ok: true, origin: "http://localhost:3000" });
  assert.equal(resolveSiteOrigin({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "xx" }).ok, false);
});

test("el resultado nunca incluye el valor de la variable en el motivo de un fallo", () => {
  const result = prod("https://evil.example/secreto?token=abc");
  assert.deepEqual(result, { ok: false, reason: "invalid" });
  assert.doesNotMatch(JSON.stringify(result), /evil|secreto|token/);
});
