// CAPTCHA de Cloudflare Turnstile para los formularios públicos (R3) — PREPARADO Y DESACTIVADO por defecto. Puro (sin React/Next).
//
// Supabase Auth soporta hCaptcha y Cloudflare Turnstile ("Authentication › Bot and Abuse Protection › Enable CAPTCHA protection",
// con la clave SECRETA del proveedor) y exige que el cliente mande el token en `options.captchaToken` de signUp, signInWithPassword,
// resetPasswordForEmail y resend. Este módulo sólo prepara el lado de la web:
//
//   * Sin `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (o con un valor inválido o de ejemplo) NO se muestra ningún widget, NO se carga ningún
//     script de terceros y NO se manda ningún token: todo funciona exactamente como antes.
//   * Con la clave de sitio válida, los formularios muestran el widget y mandan el token (el servidor sólo lo reenvía a Supabase).
//
// ORDEN DE ACTIVACIÓN (importante): 1) crear el sitio en Turnstile, 2) definir `NEXT_PUBLIC_TURNSTILE_SITE_KEY` en Vercel y
// desplegar, 3) RECIÉN DESPUÉS activar CAPTCHA en Supabase con la clave secreta. Si se activa en Supabase antes de que la web mande
// el token, TODOS los inicios de sesión, altas y recuperaciones fallan. La clave secreta vive sólo en Supabase (nunca en este repo ni
// en Vercel).

/** Nombre del campo que Turnstile agrega al formulario con el token. */
export const CAPTCHA_FIELD = "cf-turnstile-response";

/** Origen del que se carga el script y el iframe del widget (se agrega a la CSP Report-Only sólo cuando CAPTCHA está activo). */
export const CAPTCHA_ORIGIN = "https://challenges.cloudflare.com";

const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{10,64}$/;
const PLACEHOLDER_PATTERN = /^(?:x+|your[-_]?|changeme|example|placeholder|todo|<)/i;
const TOKEN_PATTERN = /^[0-9A-Za-z._-]{1,2048}$/;

type Env = Record<string, string | undefined>;

/** Clave de sitio de Turnstile (pública por diseño), o `null` si no está configurada o no es válida. */
export function readCaptchaSiteKey(env: Env = process.env): string | null {
  const raw = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!raw || !SITE_KEY_PATTERN.test(raw) || PLACEHOLDER_PATTERN.test(raw)) return null;
  return raw;
}

export function captchaEnabled(env: Env = process.env): boolean {
  return readCaptchaSiteKey(env) !== null;
}

/** Token del formulario, o `undefined` si falta o no tiene la forma de un token (nunca se reenvía basura a Supabase). */
export function captchaTokenFromFormData(formData: FormData): string | undefined {
  const value = formData.get(CAPTCHA_FIELD);
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return TOKEN_PATTERN.test(token) ? token : undefined;
}

/** Opciones para `supabase.auth.*`: vacías si no hay token (comportamiento anterior). */
export function captchaOptions(token: string | undefined): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}
