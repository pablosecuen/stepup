import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBillingLog, logBilling, sanitizeLogFields } from "../log.ts";

test("el registro sólo admite códigos cortos: cualquier otra cosa se reemplaza por «redacted»", () => {
  const clean = sanitizeLogFields({
    reason: "signature_invalid",
    code: "23505",
    provider: "mobbex",
    worker: "w-1",
    method: "billing_commit_batch",
    status: "persona.secreta@example.com", // un correo
    kind: "Bearer abc.def.ghi", // un token
    count: 12,
    attempts: Number.NaN,
  });
  assert.deepEqual(clean, { reason: "signature_invalid", code: "23505", status: "redacted", provider: "mobbex", worker: "w-1", kind: "redacted", method: "billing_commit_batch", count: 12, attempts: null });
});

test("campos desconocidos (cuerpos, encabezados, importes de una persona) se descartan aunque se los pase por descuido", () => {
  const line = formatBillingLog("webhook", "rejected", { reason: "signature_missing", rawBody: '{"customer":{"email":"x@y.z"}}', headers: { authorization: "Bearer secret" }, email: "x@y.z", amount: 24900 } as never);
  assert.equal(line, '[billing] {"scope":"webhook","kind":"rejected","reason":"signature_missing"}');
  for (const leak of ["x@y.z", "Bearer", "secret", "24900", "customer"]) assert.equal(line.includes(leak), false);
});

test("scope y kind también se validan; una línea siempre es JSON de una sola línea", () => {
  const line = formatBillingLog("api key=abc", "kind\nwith newline");
  assert.equal(line.includes("\n"), false);
  assert.equal(line, '[billing] {"scope":"redacted","kind":"redacted"}');
  assert.deepEqual(JSON.parse(line.replace("[billing] ", "")), { scope: "redacted", kind: "redacted" });
});

test("logBilling usa el nivel pedido", () => {
  const seen: string[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = (line: string) => void seen.push(`info ${line}`);
  console.warn = (line: string) => void seen.push(`warn ${line}`);
  console.error = (line: string) => void seen.push(`error ${line}`);
  try {
    logBilling("a", "b");
    logBilling("a", "b", {}, "warn");
    logBilling("a", "b", {}, "error");
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(seen.map((line) => line.split(" ")[0]), ["info", "warn", "error"]);
});
