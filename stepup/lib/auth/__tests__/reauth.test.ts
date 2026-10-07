import test from "node:test";
import assert from "node:assert/strict";
import { verifyPassword, type PasswordProbe } from "../reauth.ts";

// R4 — La reautenticación verifica la contraseña contra Auth con un cliente aparte y descarta SU sesión (alcance local).

function probe(result: { error: { code?: string; status?: number; name?: string } | null } | Error) {
  const seen: { signIn: Record<string, unknown>[]; discarded: number } = { signIn: [], discarded: 0 };
  const p: PasswordProbe = {
    signIn: async (input) => {
      seen.signIn.push(input as never);
      if (result instanceof Error) throw result;
      return result;
    },
    discardSession: async () => { seen.discarded += 1; },
  };
  return { p, seen };
}

test("contraseña correcta: ok y se descarta la sesión de verificación (una sola vez)", async () => {
  const { p, seen } = probe({ error: null });
  assert.deepEqual(await verifyPassword(p, "a@b.test", "clave"), { ok: true });
  assert.equal(seen.discarded, 1);
  assert.deepEqual(seen.signIn[0], { email: "a@b.test", password: "clave", options: {} }, "sin token no se manda captchaToken");
});

test("el token del CAPTCHA, si hay, viaja en options.captchaToken", async () => {
  const { p, seen } = probe({ error: null });
  await verifyPassword(p, "a@b.test", "clave", "tok-123");
  assert.deepEqual(seen.signIn[0], { email: "a@b.test", password: "clave", options: { captchaToken: "tok-123" } });
});

test("contraseña incorrecta (invalid_credentials): wrong_password y NO hay sesión que descartar", async () => {
  const { p, seen } = probe({ error: { code: "invalid_credentials", status: 400 } });
  assert.deepEqual(await verifyPassword(p, "a@b.test", "mala"), { ok: false, reason: "wrong_password" });
  assert.equal(seen.discarded, 0);
});

test("CAPTCHA fallido, límite de tasa (429 y códigos over_*) y fallos de Auth se distinguen", async () => {
  assert.deepEqual(await verifyPassword(probe({ error: { code: "captcha_failed" } }).p, "a@b.test", "x"), { ok: false, reason: "captcha_failed" });
  assert.deepEqual(await verifyPassword(probe({ error: { status: 429 } }).p, "a@b.test", "x"), { ok: false, reason: "rate_limited" });
  assert.deepEqual(await verifyPassword(probe({ error: { code: "over_request_rate_limit" } }).p, "a@b.test", "x"), { ok: false, reason: "rate_limited" });
  assert.deepEqual(await verifyPassword(probe({ error: { name: "AuthRetryableFetchError", status: 503 } }).p, "a@b.test", "x"), { ok: false, reason: "unavailable" });
  assert.deepEqual(await verifyPassword(probe({ error: { code: "email_not_confirmed" } }).p, "a@b.test", "x"), { ok: false, reason: "unavailable" }, "otros errores no se confunden con contraseña incorrecta");
});

test("si el cliente lanza (red caída), no se confunde con contraseña incorrecta y no revienta", async () => {
  assert.deepEqual(await verifyPassword(probe(new Error("fetch failed")).p, "a@b.test", "x"), { ok: false, reason: "unavailable" });
});

test("contraseña vacía, enorme o sin correo: se rechaza sin llamar a Auth", async () => {
  for (const [email, password] of [["a@b.test", ""], ["a@b.test", "x".repeat(1025)], ["", "clave"], ["a@b.test", undefined as unknown as string]] as const) {
    const { p, seen } = probe({ error: null });
    assert.deepEqual(await verifyPassword(p, email, password), { ok: false, reason: "wrong_password" });
    assert.equal(seen.signIn.length, 0);
  }
});

test("si descartar la sesión de verificación falla, igual cuenta como verificada (la sesión expira sola) y nada se muestra", async () => {
  const p: PasswordProbe = { signIn: async () => ({ error: null }), discardSession: async () => { throw new Error("logout falló"); } };
  assert.deepEqual(await verifyPassword(p, "a@b.test", "clave"), { ok: true });
});
