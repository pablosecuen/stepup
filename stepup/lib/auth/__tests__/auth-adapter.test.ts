// Pruebas de comportamiento del AuthAdapter usando exclusivamente el
// FakeAuthAdapter — CERO red, CERO import de @supabase/*. Esto es lo que
// garantiza "ausencia de llamadas reales a Supabase durante las pruebas":
// este archivo, y el propio FakeAuthAdapter, no pueden hacer una llamada
// real aunque quisieran (el paquete ni siquiera está importado acá).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeAuthAdapter } from "../testing/fake-auth-adapter.ts";
import { AUTH_ERROR_MESSAGES, CALLBACK_ERROR_MESSAGES } from "../error-messages.ts";

test("ingreso correcto: devuelve el usuario y queda con sesión", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "prof@example.com", password: "correcta123", emailConfirmed: true }],
  });
  const result = await adapter.signInWithPassword("Prof@Example.com", "correcta123");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.email, "prof@example.com");
  assert.deepEqual(await adapter.getUser(), { id: "u1", email: "prof@example.com" });
});

test("ingreso incorrecto: contraseña equivocada da el mismo mensaje que cuenta inexistente", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "prof@example.com", password: "correcta123", emailConfirmed: true }],
  });
  const wrongPassword = await adapter.signInWithPassword("prof@example.com", "mala");
  const noAccount = await adapter.signInWithPassword("nadie@example.com", "cualquiera1");
  assert.equal(wrongPassword.ok, false);
  assert.equal(noAccount.ok, false);
  if (!wrongPassword.ok && !noAccount.ok) {
    assert.equal(wrongPassword.error.message, AUTH_ERROR_MESSAGES.invalid_credentials);
    assert.equal(noAccount.error.message, AUTH_ERROR_MESSAGES.invalid_credentials);
  }
  assert.equal(await adapter.getUser(), null);
});

test("ingreso con correo sin confirmar: mensaje específico, no inicia sesión", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "sin-confirmar@example.com", password: "correcta123", emailConfirmed: false }],
  });
  const result = await adapter.signInWithPassword("sin-confirmar@example.com", "correcta123");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, AUTH_ERROR_MESSAGES.email_not_confirmed);
});

test("registro: cuenta nueva queda pendiente de confirmación, nunca autenticada de una", async () => {
  const adapter = new FakeAuthAdapter();
  const result = await adapter.signUp("nueva@example.com", "contraseña1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.needsEmailConfirmation, true);
  assert.equal(await adapter.getUser(), null);
});

test("registro: correo ya existente da user_already_exists", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "ya@example.com", password: "algo1234", emailConfirmed: true }],
  });
  const result = await adapter.signUp("ya@example.com", "otraCosa1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, AUTH_ERROR_MESSAGES.user_already_exists);
});

test("registro: contraseña corta da weak_password (regla de móvil: mínimo 8)", async () => {
  const adapter = new FakeAuthAdapter();
  const result = await adapter.signUp("nueva2@example.com", "corta1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, AUTH_ERROR_MESSAGES.weak_password);
});

test("callback: código válido confirma el correo e inicia sesión", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "pendiente@example.com", password: "algo1234", emailConfirmed: false }],
    validCodes: { "codigo-valido": "u1" },
  });
  const result = await adapter.exchangeCodeForSession("codigo-valido");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.id, "u1");
  assert.deepEqual(await adapter.getUser(), { id: "u1", email: "pendiente@example.com" });
});

test("callback: código vencido da link_expired y no inicia sesión", async () => {
  const adapter = new FakeAuthAdapter({ expiredCodes: ["vencido"] });
  const result = await adapter.exchangeCodeForSession("vencido");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, CALLBACK_ERROR_MESSAGES.link_expired);
  assert.equal(await adapter.getUser(), null);
});

test("callback: código inválido/desconocido da link_invalid", async () => {
  const adapter = new FakeAuthAdapter();
  const result = await adapter.exchangeCodeForSession("no-existe");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, CALLBACK_ERROR_MESSAGES.link_invalid);
});

test("callback: código ya usado una vez da link_already_used la segunda vez", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "una-vez@example.com", password: "algo1234", emailConfirmed: false }],
    validCodes: { "un-solo-uso": "u1" },
  });
  const first = await adapter.exchangeCodeForSession("un-solo-uso");
  const second = await adapter.exchangeCodeForSession("un-solo-uso");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.message, CALLBACK_ERROR_MESSAGES.link_already_used);
});

test("recuperación: siempre responde ok, nunca revela si la cuenta existe", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "existe@example.com", password: "algo1234", emailConfirmed: true }],
  });
  const withAccount = await adapter.requestPasswordReset("existe@example.com");
  const withoutAccount = await adapter.requestPasswordReset("no-existe@example.com");
  assert.equal(withAccount.ok, true);
  assert.equal(withoutAccount.ok, true);
});

test("cambio de contraseña: requiere sesión activa", async () => {
  const adapter = new FakeAuthAdapter();
  const result = await adapter.updatePassword("nuevaContraseña1");
  assert.equal(result.ok, false);
});

test("cambio de contraseña: con sesión, guarda la nueva contraseña", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "cambia@example.com", password: "vieja1234", emailConfirmed: true }],
  });
  await adapter.signInWithPassword("cambia@example.com", "vieja1234");
  const updateResult = await adapter.updatePassword("nuevaContraseña1");
  assert.equal(updateResult.ok, true);

  await adapter.signOut();
  const loginWithOld = await adapter.signInWithPassword("cambia@example.com", "vieja1234");
  const loginWithNew = await adapter.signInWithPassword("cambia@example.com", "nuevaContraseña1");
  assert.equal(loginWithOld.ok, false);
  assert.equal(loginWithNew.ok, true);
});

test("cierre de sesión: limpia el usuario autenticado", async () => {
  const adapter = new FakeAuthAdapter({
    users: [{ id: "u1", email: "sesion@example.com", password: "algo1234", emailConfirmed: true }],
  });
  await adapter.signInWithPassword("sesion@example.com", "algo1234");
  assert.notEqual(await adapter.getUser(), null);
  const result = await adapter.signOut();
  assert.equal(result.ok, true);
  assert.equal(await adapter.getUser(), null);
});

test("sin conexión: cualquier acción devuelve el mensaje de sin conexión", async () => {
  const adapter = new FakeAuthAdapter({ offline: true });
  const signIn = await adapter.signInWithPassword("x@example.com", "cualquiera1");
  const signUp = await adapter.signUp("y@example.com", "cualquiera1");
  const reset = await adapter.requestPasswordReset("z@example.com");
  for (const result of [signIn, signUp, reset]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.message, AUTH_ERROR_MESSAGES.no_connection);
  }
});
