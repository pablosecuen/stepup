import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUTH_REDIRECT, RECOVERY_PASSWORD_PATH, isPrivatePath, sanitizeNextPath } from "../safe-redirect.ts";
import { CALLBACK_ERROR_MESSAGES, classifyCallbackError, classifyVerifyOtpError } from "../error-messages.ts";
import { RECOVERY_MARKER_MAX_AGE_SECONDS } from "../recovery-marker.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative: string) => readFileSync(ROOT + relative, "utf8");

test("el next de recuperación sobrevive al saneamiento (antes se reemplazaba por /inicio)", () => {
  assert.equal(RECOVERY_PASSWORD_PATH, "/nueva-contrasena");
  assert.equal(sanitizeNextPath("/nueva-contrasena"), "/nueva-contrasena");
  assert.equal(sanitizeNextPath(encodeURIComponent("/nueva-contrasena")), "/nueva-contrasena");
});

test("sólo la ruta exacta: subrutas, queries, hosts y variantes siguen cayendo a Inicio", () => {
  for (const bad of ["/nueva-contrasena/x", "/nueva-contrasena?x=1", "/nueva-contrasena#a", "//nueva-contrasena", "/Nueva-Contrasena", "/nueva-contrasena/..", "https://evil.example.com/nueva-contrasena", "/nueva-contrasena\\x"]) {
    assert.equal(sanitizeNextPath(bad), "/inicio", bad);
  }
});

test("/nueva-contrasena NO pasa a ser un área privada del proxy", () => {
  assert.equal(isPrivatePath("/nueva-contrasena"), false);
  assert.equal(isPrivatePath("/inicio"), true);
});

test("errores del canje PKCE: 'otro dispositivo' ya no se confunde con 'ya usado'", () => {
  assert.equal(classifyCallbackError({ name: "AuthPKCECodeVerifierMissingError", message: "PKCE code verifier not found in storage." }), "link_other_device");
  assert.equal(classifyCallbackError({ message: "invalid request: both auth code and code verifier should be non-empty" }), "link_other_device");
  assert.equal(classifyCallbackError({ code: "otp_expired" }), "link_expired");
  assert.equal(classifyCallbackError({ code: "flow_state_not_found" }), "link_already_used");
  assert.equal(classifyCallbackError({ name: "AuthRetryableFetchError", status: 0 }), "no_connection");
});

test("errores de verifyOtp: vencido/ya usado comparten código; lo demás es inválido; red y servidor se distinguen", () => {
  assert.equal(classifyVerifyOtpError({ code: "otp_expired" }), "link_expired");
  assert.equal(classifyVerifyOtpError({ code: "validation_failed" }), "link_invalid");
  assert.equal(classifyVerifyOtpError({}), "link_invalid");
  assert.equal(classifyVerifyOtpError({ name: "AuthRetryableFetchError", status: 0 }), "no_connection");
  assert.equal(classifyVerifyOtpError({ name: "AuthRetryableFetchError", status: 503 }), "server_error");
  assert.equal(classifyVerifyOtpError(undefined), "unknown");
});

test("los textos nuevos no prometen una causa que no se puede conocer", () => {
  assert.match(CALLBACK_ERROR_MESSAGES.link_expired, /venció o ya fue usado/);
  assert.match(CALLBACK_ERROR_MESSAGES.link_other_device, /dispositivo|navegador/);
  assert.match(CALLBACK_ERROR_MESSAGES.link_other_device, /código de 6 dígitos/);
});

// ---- Cableado: lo que no se puede ejecutar sin Next, se verifica estructuralmente ----

test("abrir /auth/confirm (GET) NUNCA consume el token: la página no llama a ningún verify", () => {
  const page = read("app/auth/confirm/page.tsx");
  assert.doesNotMatch(page, /verifyLinkToken|verifyEmailCode|verifyOtp|exchangeCodeForSession|createSupabase|createSupabaseAuthAdapter/);
  assert.match(page, /planAuthLinkConfirmation/);
  assert.match(page, /<form action=\{confirmAuthLinkAction\}/);
  assert.match(page, /name="type" value=\{plan\.type\}/, "el type validado viaja al POST, que lo revalida");
});

test("el token sólo se verifica dentro de las acciones, vía la orquestación probada, y el type se revalida en el POST", () => {
  const actions = read("lib/auth/actions.ts");
  assert.match(actions, /confirmAuthLink\(\{ tokenHash: readString\(formData, "tokenHash"\), type: readString\(formData, "type"\) \}/);
  assert.match(actions, /verifyEmailCode\(\{ flow, email: readString\(formData, "email"\)/);
  assert.match(actions, /savePassword\(/);
  assert.match(actions, /abandonRecovery\(/);
  const session = read("lib/auth/recovery-session.ts");
  assert.match(session, /deps\.adapter\.verifyLinkToken\(plan\.tokenHash, plan\.type\)/);
  assert.match(session, /planAuthLinkConfirmation\(\{ tokenHash: input\.tokenHash, type: input\.type \}\)/);
});

test("alta y recuperación piden el enlace hacia /auth/confirm; el adaptador verifica con verifyOtp (sin PKCE)", () => {
  const adapter = read("lib/auth/supabase-auth-adapter.ts");
  assert.match(adapter, /redirectTo: `\$\{origin\}\/auth\/confirm`/);
  assert.equal((adapter.match(/emailRedirectTo: `\$\{origin\}\/auth\/confirm`/g) ?? []).length, 2, "alta y reenvío de confirmación");
  assert.doesNotMatch(adapter, /\/auth\/callback/, "ningún pedido nuevo apunta al callback PKCE");
  assert.match(adapter, /verifyOtp\(\{ type, token_hash: tokenHash \}\)/);
  assert.match(adapter, /verifyOtp\(\{ type: flow, email: normalizeEmail\(email\), token: code\.trim\(\) \}\)/);
});

test("el callback PKCE antiguo sigue existiendo y el destino de recuperación ya no depende sólo del next", () => {
  assert.match(read("app/auth/callback/route.ts"), /authCallback\(/);
  const session = read("lib/auth/recovery-session.ts");
  assert.match(session, /result\.data\.isRecovery \|\| next === RECOVERY_PASSWORD_PATH/);
  assert.match(read("lib/auth/supabase-auth-adapter.ts"), /redirectType === "recovery"/);
  assert.equal(DEFAULT_AUTH_REDIRECT, "/inicio");
});

test("/nueva-contrasena y el guardado exigen sesión + marcador (misma puerta)", () => {
  const page = read("app/nueva-contrasena/page.tsx");
  assert.match(page, /newPasswordGate\(/);
  assert.doesNotMatch(page, /redirect\("\/login"\)/, "ya no basta con 'hay sesión'");
  assert.match(read("lib/auth/recovery-session.ts"), /const gate = await newPasswordGate\(deps\)/);
});

test("/auth/callback delega en authCallback y /recuperar-contrasena ya no expulsa a Inicio a quien tiene sesión vieja", () => {
  const route = read("app/auth/callback/route.ts");
  assert.match(route, /authCallback\(/);
  assert.doesNotMatch(route, /sanitizeNextPath|classifyCallbackUrlError/, "la decisión vive en recovery-session.ts");
  assert.doesNotMatch(read("app/recuperar-contrasena/page.tsx"), /redirect\(DEFAULT_AUTH_REDIRECT\)/);
});

test("ningún archivo de los enlaces de correo loguea tokens, códigos, URLs ni correos", () => {
  for (const file of [
    "lib/auth/recovery-session.ts",
    "lib/auth/recovery-flow.ts",
    "lib/auth/recovery-marker.ts",
    "lib/auth/recovery-cookie.ts",
    "lib/auth/actions.ts",
    "lib/auth/supabase-auth-adapter.ts",
    "app/auth/confirm/page.tsx",
    "app/auth/callback/route.ts",
    "app/nueva-contrasena/page.tsx",
    "components/auth/email-code-form.tsx",
  ]) {
    assert.doesNotMatch(read(file), /console\.(log|error|warn|info|debug)/, file);
  }
});

test("cookie del marcador: httpOnly, secure en Production, SameSite=lax, máximo 15 minutos y atada al usuario", () => {
  const cookie = read("lib/auth/recovery-cookie.ts");
  assert.match(cookie, /httpOnly: true/);
  assert.match(cookie, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(cookie, /sameSite: "lax"/);
  assert.match(cookie, /maxAge: RECOVERY_MARKER_MAX_AGE_SECONDS/);
  assert.match(cookie, /path: "\/"/);
  assert.match(cookie, /createRecoveryMarker\(userId, Date\.now\(\)\)/, "atada al id de usuario");
  assert.match(cookie, /isValidRecoveryMarker\(store\.get\(RECOVERY_MARKER_COOKIE\)\?\.value, userId, Date\.now\(\)\)/, "se comprueba contra el usuario de la sesión");
  assert.equal(RECOVERY_MARKER_MAX_AGE_SECONDS, 900, "15 minutos");
});

test("el marcador se elimina al guardar, al abandonar, al iniciar/cerrar sesión, al pedir otro enlace y al confirmar un alta", () => {
  const session = read("lib/auth/recovery-session.ts");
  assert.match(session, /await deps\.markers\.clear\(\);\n  await deps\.adapter\.signOut\(\);\n  return \{ redirectTo: "\/login" \};\n\}\n\n\/\*\* Abandonar/, "al guardar");
  assert.match(session, /export async function abandonRecovery\(deps: RecoveryDeps\)[\s\S]*deps\.markers\.clear\(\)/, "al abandonar");
  assert.match(session, /else await deps\.markers\.clear\(\)/, "al confirmar un alta");
  const actions = read("lib/auth/actions.ts");
  assert.equal((actions.match(/await clearRecoveryMarker\(\);/g) ?? []).length, 3, "inicio de sesión, pedido nuevo y cierre de sesión");
});

test("Nueva contraseña ofrece 'Cancelar' (abandonar la recuperación) desde la página de servidor, no desde un componente cliente sin protección", () => {
  assert.match(read("app/nueva-contrasena/page.tsx"), /<form action=\{abandonRecoveryAction\}/);
  assert.doesNotMatch(read("app/nueva-contrasena/new-password-form.tsx"), /abandonRecoveryAction/);
});

test("la alta ofrece el código de 6 dígitos igual que la recuperación (componente compartido)", () => {
  assert.match(read("app/crear-cuenta/signup-form.tsx"), /<EmailCodeForm flow="signup" email=\{email\} \/>/);
  assert.match(read("app/recuperar-contrasena/forgot-password-form.tsx"), /<EmailCodeForm flow="recovery" email=\{state\.email\} \/>/);
});

test("la alta confirmada termina en una pantalla pública \"Cuenta confirmada\" con Iniciar sesión (ya no cae en Inicio sin aviso)", () => {
  const page = read("app/auth/confirmado/page.tsx");
  assert.match(page, /title="Cuenta confirmada"/);
  assert.match(page, /subtitle="Tu correo fue verificado correctamente\."/);
  assert.match(page, /href="\/login"[\s\S]*Iniciar sesión/);
  assert.doesNotMatch(page, /verifyOtp|verifyLinkToken|createSupabase|loadHomeData|requireAuthenticatedDbContext/, "no confirma nada ni consulta datos: es sólo el aviso final");
  assert.equal(isPrivatePath("/auth/confirmado"), false, "es pública: no depende de la sesión ni de que Inicio cargue");
});

test("el botón de /auth/confirm queda deshabilitado mientras corre la verificación (un segundo toque ya no consume el token otra vez)", () => {
  const button = read("components/auth/confirm-submit-button.tsx");
  assert.match(button, /^"use client";/);
  assert.match(button, /useFormStatus\(\)/);
  assert.match(button, /disabled=\{pending\}/);
  assert.match(button, /Confirmando…/);

  const page = read("app/auth/confirm/page.tsx");
  assert.match(page, /<ConfirmSubmitButton label=\{copy\.button\} \/>/);
  assert.match(page, /<form action=\{confirmAuthLinkAction\}/, "el formulario sigue en la página de servidor");
  assert.doesNotMatch(page, /<button/, "no queda un botón sin estado de espera");
});

test("/auth/error se arma con describeAuthErrorScreen (aviso con Iniciar sesión para un enlace ya usado)", () => {
  const page = read("app/auth/error/page.tsx");
  assert.match(page, /describeAuthErrorScreen\(type\)/);
  assert.match(page, /screen\.primary\.href/);
  assert.match(page, /screen\.secondary\.href/);
});
