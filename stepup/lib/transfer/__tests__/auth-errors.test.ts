import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAuthReachable, classifyAuthFailure } from "../auth-errors.ts";

/** Diagnóstico de inicio de sesión: cada causa se distingue y ningún mensaje filtra secretos. */

const SECRETS = ["usuario.ficticio@example.invalid", "Clave-Ficticia-123", "sb_publishable_ficticia"];

test("credenciales rechazadas, correo sin confirmar, bloqueo y límite de intentos se distinguen", () => {
  assert.equal(classifyAuthFailure({ name: "AuthApiError", status: 400, code: "invalid_credentials", message: "Invalid login credentials" }).kind, "credentials");
  assert.equal(classifyAuthFailure({ name: "AuthApiError", status: 400, message: "Invalid login credentials" }).kind, "credentials");
  assert.equal(classifyAuthFailure({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }).kind, "email_not_confirmed");
  assert.equal(classifyAuthFailure({ status: 400, code: "user_banned", message: "x" }).kind, "banned");
  assert.equal(classifyAuthFailure({ status: 429, code: "over_request_rate_limit", message: "x" }).kind, "rate_limited");
});

test("red, servicio y configuración no se confunden con credenciales", () => {
  assert.equal(classifyAuthFailure({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }).kind, "network");
  assert.equal(classifyAuthFailure(new TypeError("fetch failed")).kind, "network");
  assert.equal(classifyAuthFailure({ name: "AuthRetryableFetchError", status: 503, message: "x" }).kind, "service");
  assert.equal(classifyAuthFailure({ name: "AuthApiError", status: 500, message: "boom" }).kind, "service");
  assert.equal(classifyAuthFailure({ name: "AuthApiError", status: 401, message: "Invalid API key" }).kind, "config");
  const other = classifyAuthFailure({ status: 418, code: "teapot" });
  assert.equal(other.kind, "unknown");
  assert.match(other.message, /418/);
  assert.equal(classifyAuthFailure(null).kind, "unknown");
});

test("ningún mensaje incluye correo, contraseña, clave ni el texto crudo del servidor", () => {
  for (const error of [
    { status: 400, code: "invalid_credentials", message: `Invalid login credentials for ${SECRETS[0]} ${SECRETS[1]}` },
    { status: 500, message: `${SECRETS[2]} ${SECRETS[0]}` },
    { status: 418, code: "x", message: SECRETS.join(" ") },
    new Error(SECRETS.join(" ")),
  ]) {
    const { message } = classifyAuthFailure(error);
    for (const secret of SECRETS) assert.equal(message.includes(secret), false, secret);
  }
});

test("antes de usar las credenciales se comprueba el servicio: sin red, clave pública rechazada o servicio caído", async () => {
  const mk = (impl: () => Promise<{ status: number }>) => ({ fetch: impl });
  assert.equal(await checkAuthReachable("http://x/", "k", mk(async () => ({ status: 200 }))), null);
  assert.equal(await checkAuthReachable("http://x", "k", mk(async () => ({ status: 404 }))), null, "otro estado 4xx: el servicio responde");
  assert.equal((await checkAuthReachable("http://x", "k", mk(async () => { throw new TypeError("fetch failed"); })))?.kind, "network");
  assert.equal((await checkAuthReachable("http://x", "k", mk(async () => ({ status: 401 }))))?.kind, "config");
  assert.equal((await checkAuthReachable("http://x", "k", mk(async () => ({ status: 502 }))))?.kind, "service");
  let url = "";
  await checkAuthReachable("http://x///", "k", { fetch: async (u) => { url = u; return { status: 200 }; } });
  assert.equal(url, "http://x/auth/v1/health");
});
