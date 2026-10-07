import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCaptchaSiteKey, captchaEnabled, captchaTokenFromFormData, captchaOptions, CAPTCHA_FIELD, CAPTCHA_ORIGIN } from "../captcha.ts";
import { buildSecurityHeaders, captchaOriginFromEnv, CSP_REPORT_ONLY } from "../../security/security-headers.mjs";
import { classifyAuthError, translateAuthError, AUTH_ERROR_MESSAGES } from "../error-messages.ts";

// R3 — CAPTCHA (Turnstile) PREPARADO Y DESACTIVADO por defecto: sin clave de sitio todo queda exactamente como antes.

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const VALID = "0x4AAAAAAAabcdefghijKLMN";

test("sin clave de sitio (o inválida / de ejemplo) CAPTCHA está desactivado", () => {
  for (const env of [{}, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "   " }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "corta" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "xxxxxxxxxxxxxxxx" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "your_site_key_here" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "<site-key>" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "con espacios y simbolos!!" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "a".repeat(65) }]) {
    assert.equal(readCaptchaSiteKey(env), null, JSON.stringify(env));
    assert.equal(captchaEnabled(env), false);
    assert.equal(captchaOriginFromEnv(env), null);
  }
});

test("una clave de sitio con la forma de Turnstile activa el CAPTCHA y el origen del widget", () => {
  assert.equal(readCaptchaSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ` ${VALID} ` }), VALID);
  assert.equal(captchaEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: VALID }), true);
  assert.equal(captchaOriginFromEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: VALID }), CAPTCHA_ORIGIN);
});

test("la validación de la web y la de next.config (cabeceras) coinciden en una tabla de casos", () => {
  const samples = ["", "x", VALID, "xxxxxxxxxxxxxxxx", "1x00000000000000000000AA", "your-key-here-12345", "0x4AAAAAAA-valid_key-OK", "a b c d e f g h i j k"];
  for (const sample of samples) {
    const env = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: sample };
    assert.equal(captchaEnabled(env), captchaOriginFromEnv(env) !== null, `discrepancia con ${JSON.stringify(sample)}`);
  }
});

test("el token del formulario sólo se acepta con forma de token; si no, no se manda nada a Supabase", () => {
  const form = (value?: string) => {
    const data = new FormData();
    if (value !== undefined) data.set(CAPTCHA_FIELD, value);
    return data;
  };
  assert.equal(CAPTCHA_FIELD, "cf-turnstile-response");
  assert.equal(captchaTokenFromFormData(form()), undefined);
  assert.equal(captchaTokenFromFormData(form("")), undefined);
  assert.equal(captchaTokenFromFormData(form("   ")), undefined);
  assert.equal(captchaTokenFromFormData(form("con espacios")), undefined);
  assert.equal(captchaTokenFromFormData(form("<script>")), undefined);
  assert.equal(captchaTokenFromFormData(form("a".repeat(2049))), undefined);
  assert.equal(captchaTokenFromFormData(form("0.abcDEF_123-xyz")), "0.abcDEF_123-xyz");
  const file = new FormData();
  file.set(CAPTCHA_FIELD, new Blob(["x"]), "f.txt");
  assert.equal(captchaTokenFromFormData(file), undefined);
  assert.deepEqual(captchaOptions(undefined), {});
  assert.deepEqual(captchaOptions("tok"), { captchaToken: "tok" });
});

test("cabeceras: sin CAPTCHA la política de prueba es la de siempre (frame-src 'none', sin terceros); con CAPTCHA sólo se permite el origen de Turnstile", () => {
  const without = buildSecurityHeaders({ production: true }).find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
  assert.equal(without, CSP_REPORT_ONLY);
  assert.match(without, /frame-src 'none'/);
  assert.doesNotMatch(without, /cloudflare/);
  const withCaptcha = buildSecurityHeaders({ production: true, captchaOrigin: CAPTCHA_ORIGIN }).find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
  assert.match(withCaptcha, /script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(withCaptcha, /connect-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(withCaptcha, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(withCaptcha, /unsafe-eval/);
  // el enmarcado de TeacherFlow sigue bloqueado pase lo que pase
  const enforced = buildSecurityHeaders({ production: true, captchaOrigin: CAPTCHA_ORIGIN }).find((h) => h.key === "Content-Security-Policy")!.value;
  assert.equal(enforced, "frame-ancestors 'none'");
  // fuera de Production no hay política de prueba aunque haya clave
  assert.ok(!buildSecurityHeaders({ production: false, captchaOrigin: CAPTCHA_ORIGIN }).some((h) => h.key === "Content-Security-Policy-Report-Only"));
});

test("errores de Supabase Auth: CAPTCHA fallido y límites de frecuencia tienen un texto claro (sin revelar nada)", () => {
  assert.equal(classifyAuthError({ code: "captcha_failed" }), "captcha_failed");
  assert.equal(classifyAuthError({ code: "over_request_rate_limit" }), "rate_limited");
  assert.equal(classifyAuthError({ code: "over_email_send_rate_limit" }), "rate_limited");
  assert.equal(classifyAuthError({ status: 429 }), "rate_limited");
  assert.equal(classifyAuthError({ code: "invalid_credentials" }), "invalid_credentials"); // sin cambios
  assert.match(translateAuthError({ code: "captcha_failed" }), /verificar que sos una persona/);
  assert.match(translateAuthError({ status: 429 }), /demasiados intentos/);
  for (const key of ["captcha_failed", "rate_limited"] as const) assert.doesNotMatch(AUTH_ERROR_MESSAGES[key], /captcha|turnstile|supabase|429|rate/i);
});

test("el widget NO renderiza ni carga ningún script de terceros sin clave de sitio", () => {
  const source = read("components/auth/captcha-widget.tsx");
  const nullReturn = source.indexOf("if (!siteKey) return null;");
  assert.ok(nullReturn !== -1, "debe volver null sin clave");
  assert.ok(source.indexOf("<Script") > nullReturn, "el <Script> de Turnstile sólo existe después de comprobar la clave");
  assert.match(source, /process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/, "acceso directo a la variable pública (la única que Next reemplaza en el cliente)");
  assert.doesNotMatch(source, /SECRET/i, "ninguna clave secreta en el cliente");
});

test("los formularios públicos y el cambio de contraseña incluyen el widget; el servidor sólo reenvía el token validado", () => {
  for (const file of ["app/login/login-form.tsx", "app/crear-cuenta/signup-form.tsx", "app/crear-cuenta/resend-confirmation-form.tsx", "app/recuperar-contrasena/forgot-password-form.tsx", "components/account/change-password-button.tsx"]) {
    assert.match(read(file), /<CaptchaWidget\b/, file);
  }
  const actions = read("lib/auth/actions.ts");
  assert.equal([...actions.matchAll(/captchaToken: captchaTokenFromFormData\(formData\)/g)].length, 4, "login, alta, reenvío y recuperación");
  const adapter = read("lib/auth/supabase-auth-adapter.ts");
  assert.equal([...adapter.matchAll(/captchaOptions\(captcha\?\.captchaToken\)/g)].length, 4);
  const account = read("lib/actions/account.ts");
  assert.match(account, /\^\[0-9A-Za-z\._-\]\{1,2048\}\$/);
});

test("ninguna clave secreta de CAPTCHA en el repositorio ni en la configuración de ejemplo", () => {
  const files = ["lib/auth/captcha.ts", "components/auth/captcha-widget.tsx", "next.config.mjs", "lib/security/security-headers.mjs", ".env.example"];
  for (const file of files) assert.doesNotMatch(read(file), /TURNSTILE_SECRET|HCAPTCHA_SECRET|CAPTCHA_SECRET|0x4[A-Za-z0-9_-]{20,}/, file);
});
