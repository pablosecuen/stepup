import { classifyAuthError } from "./error-messages.ts";
import { captchaOptions } from "./captcha.ts";

/**
 * Reautenticación con contraseña para acciones críticas (R4, hallazgo M-06). Una sesión robada (o una pestaña abierta y olvidada)
 * alcanza para leer datos, pero NO para una acción irreversible: la persona tiene que volver a escribir su contraseña, y el
 * servidor la verifica contra Supabase Auth en esa misma petición (no queda ningún "permiso reciente" que se pueda robar o
 * reutilizar: cada acción crítica la vuelve a pedir).
 *
 * La verificación usa un cliente de Supabase APARTE (sin cookies ni persistencia): iniciar sesión con la contraseña crea una sesión
 * nueva en Auth, y esa sesión se cierra enseguida con alcance LOCAL (sólo la que se acaba de crear — nunca `global`, que cerraría
 * todos los dispositivos de la persona). La sesión real de la persona no se toca.
 *
 * Pura (sin Next ni Supabase): el cliente real lo inyecta `reauth-supabase.ts`; las pruebas inyectan uno en memoria. Nunca
 * registra la contraseña, el correo ni el token del CAPTCHA.
 */
export type PasswordCheck = { ok: true } | { ok: false; reason: "wrong_password" | "captcha_failed" | "rate_limited" | "unavailable" };

interface RawAuthError {
  code?: string | null;
  status?: number | null;
  name?: string;
  message?: string;
}

export interface PasswordProbe {
  signIn(input: { email: string; password: string; options: { captchaToken?: string } }): Promise<{ error: RawAuthError | null }>;
  /** Cierra SÓLO la sesión que creó la verificación (alcance local). */
  discardSession(): Promise<void>;
}

const MAX_PASSWORD_LENGTH = 1024;

export async function verifyPassword(probe: PasswordProbe, email: string, password: string, captchaToken?: string): Promise<PasswordCheck> {
  if (!email || typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: "wrong_password" };
  }

  let error: RawAuthError | null;
  try {
    ({ error } = await probe.signIn({ email, password, options: captchaOptions(captchaToken) }));
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (error) {
    switch (classifyAuthError(error)) {
      case "invalid_credentials":
        return { ok: false, reason: "wrong_password" };
      case "captcha_failed":
        return { ok: false, reason: "captcha_failed" };
      case "rate_limited":
        return { ok: false, reason: "rate_limited" };
      default:
        return { ok: false, reason: "unavailable" };
    }
  }

  // La contraseña es correcta. La sesión de verificación se descarta (si falla, expira sola: no se le muestra nada a la persona).
  try {
    await probe.discardSession();
  } catch {
    // intencional
  }
  return { ok: true };
}
