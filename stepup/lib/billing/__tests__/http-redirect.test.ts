import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches, clientKeyFrom, contentLengthOf, readBodyLimited } from "../http.ts";
import { actionError, safeProviderRedirect } from "../redirect.ts";
import { demoScenariosAllowed, resolveProviderChoice } from "../provider-selection.ts";
import { DEMO_SCENARIOS, demoScenario } from "../demo-scenarios.ts";
import { checkBillingReadiness } from "../readiness.ts";

const ORIGIN = "https://teacherflowapp.com";

function streamOf(chunks: string[]): Pick<Request, "body"> {
  const encoder = new TextEncoder();
  return new Request("https://x.test", { method: "POST", body: new ReadableStream<Uint8Array<ArrayBuffer>>({ start: (controller) => { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk) as Uint8Array<ArrayBuffer>); controller.close(); } }), duplex: "half" } as RequestInit);
}

test("lectura de cuerpo con tope: corta apenas se supera, sin leer el resto; el borde exacto pasa", async () => {
  assert.equal(await readBodyLimited(streamOf(["hola ", "mundo"]), 100), "hola mundo");
  assert.equal(await readBodyLimited(streamOf(["x".repeat(10)]), 10), "x".repeat(10));
  assert.equal(await readBodyLimited(streamOf(["x".repeat(11)]), 10), "too_large");
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull: (controller) => { pulled += 1; controller.enqueue(new TextEncoder().encode("y".repeat(1024))); } });
  assert.equal(await readBodyLimited({ body: endless }, 4096), "too_large");
  assert.ok(pulled <= 8, `no leyó un cuerpo infinito (${pulled} lecturas)`);
  assert.equal(await readBodyLimited({ body: null }, 10), "");
  const invalid = await readBodyLimited({ body: new ReadableStream({ start: (c) => { c.enqueue(new Uint8Array([0xff, 0xfe, 0xfd])); c.close(); } }) }, 10);
  assert.equal(invalid, "�", "un cuerpo que no es texto válido nunca se interpreta");
});

test("clave del cliente: anonimizada (nunca la IP), estable y distinta por cliente; Content-Length sólo si es un entero razonable", () => {
  const a = clientKeyFrom(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.ok(!a.includes("203"));
  assert.equal(a, clientKeyFrom(new Headers({ "x-forwarded-for": "203.0.113.9" })), "sólo cuenta el primer salto");
  assert.notEqual(a, clientKeyFrom(new Headers({ "x-forwarded-for": "203.0.113.10" })));
  assert.equal(clientKeyFrom(new Headers({ "x-real-ip": "198.51.100.1" })).length, 24);
  assert.equal(clientKeyFrom(new Headers()).length, 24);
  assert.equal(contentLengthOf(new Headers({ "content-length": "1234" })), 1234);
  for (const bad of ["-1", "12.5", "abc", "", "99999999999999"]) assert.equal(contentLengthOf(new Headers({ "content-length": bad })), null, bad);
  assert.equal(contentLengthOf(new Headers()), null);
});

test("secreto de los trabajos programados: exactamente «Bearer <secreto>», comparación completa; un secreto corto o ausente NUNCA coincide", () => {
  const secret = "s".repeat(40);
  assert.equal(bearerMatches(`Bearer ${secret}`, secret), true);
  for (const bad of [null, undefined, "", secret, `bearer ${secret}`, `Bearer ${secret}x`, `Bearer ${secret.slice(0, -1)}`, `Bearer  ${secret}`, `Basic ${secret}`, "Bearer ", "Bearer"]) assert.equal(bearerMatches(bad, secret), false, String(bad));
  assert.equal(bearerMatches("Bearer corto", "corto"), false, "un secreto de menos de 32 caracteres no se acepta ni coincidiendo");
  assert.equal(bearerMatches(`Bearer ${secret}`, undefined), false);
  assert.equal(bearerMatches(`Bearer ${secret}`, ""), false);
});

test("REDIRECT MANIPULADO: sólo se sigue HTTPS de mobbex.com o una ruta interna; todo lo demás se descarta", () => {
  for (const ok of ["https://mobbex.com/p/subscriptions/x/subscriber/y/source", "https://checkout.mobbex.com/abc?x=1"]) assert.equal(safeProviderRedirect(ok, ORIGIN), new URL(ok).toString(), ok);
  assert.equal(safeProviderRedirect("/facturacion/resultado", ORIGIN), "/facturacion/resultado");
  assert.equal(safeProviderRedirect("/facturacion/resultado?x=1", ORIGIN), "/facturacion/resultado?x=1");
  const evil = [
    "http://mobbex.com/x", "https://mobbex.com.evil.example/x", "https://evilmobbex.com/x", "https://evil.example/x", "https://mobbex.com@evil.example/x",
    "https://user:pass@mobbex.com/x", "https://mobbex.com:8443/x", "javascript:alert(1)", "data:text/html,<script>1</script>", "//evil.example/x", "\\\\evil.example",
    "https://evil.example\\@mobbex.com", "/\\evil.example", "ftp://mobbex.com/x", "", " https://mobbex.com/x\n", "https://mobbex.com/x\r\nSet-Cookie: a=b", null, undefined, 42, {}, "x".repeat(3000),
  ];
  for (const value of evil) assert.equal(safeProviderRedirect(value, ORIGIN), null, String(value).slice(0, 40));
});

test("el resultado de una acción: éxito sin error; error con su mensaje; una falla de red (sin «ok») o un valor raro nunca se toma como éxito", () => {
  assert.equal(actionError({ ok: true }), null);
  assert.equal(actionError({ ok: true, redirectUrl: "/x" }), null);
  assert.equal(actionError({ ok: false, error: "Algo pasó." }), "Algo pasó.");
  assert.equal(actionError({ error: "Sin conexión." }), "Sin conexión.");
  for (const weird of [null, undefined, 1, "ok", {}, { ok: false }, { ok: "true" }, { ok: 1 }]) assert.match(String(actionError(weird)), /No pudimos completar la acción/, String(weird));
});

test("el adaptador falso SÓLO existe fuera de Production; los escenarios de demostración sólo en el servidor de desarrollo local con el falso", () => {
  assert.equal(resolveProviderChoice({}), "mobbex");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "mobbex" }), "mobbex");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "fake" }), "fake");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: " FAKE " }), "fake");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "fake", VERCEL_ENV: "preview" }), "fake");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "fake", VERCEL_ENV: "production" }), "mobbex", "en Production nunca el falso, aunque se pida");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "otro" }), "mobbex");
  assert.equal(demoScenariosAllowed({ NODE_ENV: "development", BILLING_PROVIDER: "fake" }), true);
  for (const env of [{ NODE_ENV: "production", BILLING_PROVIDER: "fake" }, { NODE_ENV: "development" }, { NODE_ENV: "development", BILLING_PROVIDER: "fake", VERCEL_ENV: "preview" }, { NODE_ENV: "development", BILLING_PROVIDER: "mobbex" }, {}]) assert.equal(demoScenariosAllowed(env), false, JSON.stringify(env));
});

test("los escenarios de demostración son inventados, deterministas y sólo se resuelven por nombre exacto (sin prototipos)", () => {
  assert.ok(Object.keys(DEMO_SCENARIOS).length >= 12);
  for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "ACTIVE", "", null, undefined, 5]) assert.equal(demoScenario(name), null, String(name));
  assert.ok(demoScenario("grace"));
  for (const scenario of Object.values(DEMO_SCENARIOS)) {
    const text = JSON.stringify(scenario);
    assert.ok(!/@|password|secret/i.test(text));
  }
});

test("los requisitos de activación incluyen el secreto de los trabajos programados y no piden credenciales de Mobbex con el adaptador falso", () => {
  const result = checkBillingReadiness({}, { enabled: true, enforcement: false }, { realProvider: false });
  assert.deepEqual(result.missing.map((item) => item.split(" ")[0]), ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]);
});
