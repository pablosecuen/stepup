/**
 * Diagnóstico del inicio de sesión del traslado: distingue credenciales rechazadas, red, servicio y configuración, con mensajes útiles que NUNCA incluyen el correo, la
 * contraseña, las claves ni el texto crudo del servidor (sólo el estado HTTP y el código, que no son secretos). No cambia ni restablece nada de la cuenta.
 */

export type AuthFailureKind = "credentials" | "email_not_confirmed" | "banned" | "rate_limited" | "network" | "service" | "config" | "unknown";

export interface AuthFailure {
  kind: AuthFailureKind;
  message: string;
}

const MESSAGES: Record<Exclude<AuthFailureKind, "unknown">, string> = {
  credentials:
    "Supabase RECHAZÓ el correo o la contraseña (la conexión funciona). Revisá mayúsculas, espacios y que sea el correo de la cuenta web. Si esa cuenta entra con Google u otro proveedor, no tiene contraseña propia. No se cambió ni restableció nada.",
  email_not_confirmed: "La cuenta existe pero su correo todavía no está confirmado. Confirmalo desde el mensaje que envió la web y volvé a intentar.",
  banned: "La cuenta figura como bloqueada en Supabase. No se hizo ningún cambio; revisá el estado de la cuenta en el panel.",
  rate_limited: "Supabase pidió esperar: hubo demasiados intentos seguidos. Esperá unos minutos antes de volver a intentar (no se hizo ningún cambio).",
  network: "No hay conexión con Supabase (red, VPN, proxy o DNS). Tus credenciales NO fueron evaluadas. Revisá tu conexión y volvé a intentar.",
  service: "El servicio de Supabase respondió con un error propio (no es un problema de tus credenciales). Probá de nuevo en unos minutos; si sigue, revisá el estado del proyecto en el panel.",
  config: "Supabase no aceptó la clave PÚBLICA del proyecto que está en el archivo de entorno (.env.local): ese archivo es de otro proyecto o está desactualizado. Tus credenciales NO fueron evaluadas.",
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Clasifica el error que devuelve `signInWithPassword` (o una excepción de red). */
export function classifyAuthFailure(error: unknown): AuthFailure {
  const e = (error !== null && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const status = num(e.status);
  const code = str(e.code) || str(e.error_code);
  const name = str(e.name);
  const text = str(e.message).toLowerCase();

  if (code === "invalid_credentials" || (status === 400 && /invalid login credentials|invalid credentials/.test(text))) return { kind: "credentials", message: MESSAGES.credentials };
  if (code === "email_not_confirmed" || /email not confirmed/.test(text)) return { kind: "email_not_confirmed", message: MESSAGES.email_not_confirmed };
  if (code === "user_banned") return { kind: "banned", message: MESSAGES.banned };
  if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return { kind: "rate_limited", message: MESSAGES.rate_limited };
  if ((status === 401 || status === 403) && (/api key|apikey|jwt|no api key/.test(text) || code === "bad_jwt" || code === "no_authorization")) return { kind: "config", message: MESSAGES.config };
  if (name === "AuthRetryableFetchError" && (status === 0 || status === null)) return { kind: "network", message: MESSAGES.network };
  if (status === null || status === 0) {
    if (/fetch failed|network|enotfound|econnrefused|econnreset|etimedout|timeout|socket|failed to fetch/.test(text)) return { kind: "network", message: MESSAGES.network };
    return { kind: "unknown", message: "No se pudo iniciar sesión por un motivo no identificado (sin respuesta del servicio). Tus credenciales no se muestran ni se guardan." };
  }
  if (status >= 500) return { kind: "service", message: MESSAGES.service };
  return { kind: "unknown", message: `No se pudo iniciar sesión (estado ${status}${code ? `, código ${code.slice(0, 60)}` : ""}). Tus credenciales no se muestran ni se guardan.` };
}

export interface ReachabilityDeps {
  fetch: (input: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number }>;
}

/**
 * Antes de usar las credenciales: ¿responde el servicio de autenticación con la clave pública? Usa el punto de salud (público, sin credenciales de la cuenta).
 * Devuelve `null` si todo está bien o el diagnóstico si no.
 */
export async function checkAuthReachable(url: string, publicKey: string, deps: ReachabilityDeps = { fetch: (input, init) => fetch(input, init) }): Promise<AuthFailure | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const { status } = await deps.fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, { headers: { apikey: publicKey }, signal: controller.signal });
    if (status === 401 || status === 403) return { kind: "config", message: MESSAGES.config };
    if (status >= 500) return { kind: "service", message: MESSAGES.service };
    return null;
  } catch {
    return { kind: "network", message: MESSAGES.network };
  } finally {
    clearTimeout(timer);
  }
}
