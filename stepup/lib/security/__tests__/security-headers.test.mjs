import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSecurityHeaders, CSP_REPORT_ONLY, PERMISSIONS_POLICY } from "../security-headers.mjs";
import nextConfig from "../../../next.config.mjs";

/** R1 — cabeceras de seguridad. La verificación contra el servidor real (curl) se hace aparte; acá se fija el contrato. */
const byKey = (headers) => Object.fromEntries(headers.map((header) => [header.key, header.value]));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("Production: cabeceras bloqueantes exactas", () => {
  const headers = byKey(buildSecurityHeaders({ production: true }));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Content-Security-Policy"], "frame-ancestors 'none'", "la única directiva bloqueante es el enmarcado");
  assert.ok(headers["Permissions-Policy"]);
});

test("frame-ancestors está en una CSP BLOQUEANTE (en Report-Only el navegador la ignora)", () => {
  const headers = byKey(buildSecurityHeaders({ production: true }));
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.doesNotMatch(headers["Content-Security-Policy-Report-Only"], /frame-ancestors/);
});

test("la CSP completa sólo viaja como Report-Only (nunca bloqueante) y sólo en Production", () => {
  const production = buildSecurityHeaders({ production: true });
  const development = buildSecurityHeaders({ production: false });
  assert.equal(byKey(production)["Content-Security-Policy-Report-Only"], CSP_REPORT_ONLY);
  assert.equal(production.filter((header) => header.key === "Content-Security-Policy").length, 1, "la única CSP bloqueante es la de frame-ancestors");
  assert.equal("Content-Security-Policy-Report-Only" in byKey(development), false, "en `next dev` no hay política de prueba");
  assert.equal(byKey(development)["Content-Security-Policy"], "frame-ancestors 'none'", "el enmarcado se bloquea también en desarrollo");
});

test("CSP Report-Only: sin unsafe-eval, unsafe-inline sólo en script/style (temporal), sin comodines ni orígenes externos", () => {
  assert.doesNotMatch(CSP_REPORT_ONLY, /unsafe-eval/);
  const directives = Object.fromEntries(CSP_REPORT_ONLY.split("; ").map((part) => [part.split(" ")[0], part]));
  for (const [name, text] of Object.entries(directives)) {
    if (/unsafe-inline/.test(text)) assert.ok(name === "script-src" || name === "style-src", `unsafe-inline sólo se tolera (temporalmente) en script-src/style-src, no en ${name}`);
  }
  assert.doesNotMatch(CSP_REPORT_ONLY, /\*|https?:/, "sin comodines ni orígenes externos: el navegador sólo habla con su propio origen");
  assert.equal(directives["default-src"], "default-src 'self'");
  assert.equal(directives["object-src"], "object-src 'none'");
  assert.equal(directives["base-uri"], "base-uri 'self'");
  assert.equal(directives["form-action"], "form-action 'self'");
  assert.equal(directives["connect-src"], "connect-src 'self'", "el navegador nunca habla con Supabase");
  assert.equal(directives["manifest-src"], "manifest-src 'self'");
});

test("Permissions-Policy: deshabilita las funciones del navegador que la web no usa", () => {
  for (const feature of ["camera", "microphone", "geolocation", "payment", "usb", "display-capture"]) assert.match(PERMISSIONS_POLICY, new RegExp(`${feature}=\(\)`));
  assert.doesNotMatch(PERMISSIONS_POLICY, /=\*|=\(self\)/, "ninguna función queda habilitada");
});

test("next.config.mjs: poweredByHeader desactivado y las cabeceras se aplican a TODAS las rutas", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  const rules = await nextConfig.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, "/:path*");
  assert.deepEqual(rules[0].headers.map((header) => header.key).sort(), buildSecurityHeaders().map((header) => header.key).sort());
});

test("HSTS: la configuración propia no agrega includeSubDomains ni preload sin auditar los subdominios", () => {
  const sources = ["next.config.mjs", "lib/security/security-headers.mjs", "proxy.ts"].map((file) => readFileSync(`${ROOT}${file}`, "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /Strict-Transport-Security/i);
    assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ""), /includeSubDomains|preload/i);
  }
});
