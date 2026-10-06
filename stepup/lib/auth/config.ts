// Validación central de la configuración de Supabase. Sólo lee variables públicas (NEXT_PUBLIC_*): nunca service_role ni
// ninguna clave secreta.
//
// Qué pasa si falta o es inválida (R1, "fallar cerrado"):
//  - Desarrollo y pruebas locales (`NODE_ENV !== "production"`): igual que antes, la web arranca en "modo vista previa" (el área
//    privada no se bloquea y nada intenta conectarse), para poder trabajar sin Supabase.
//  - Production: NUNCA se continúa con valores vacíos o inválidos. `proxy.ts` y el layout privado responden con un mensaje
//    controlado (503) y las pantallas de cuenta muestran «Cuenta no disponible». Ver `shouldFailClosed()`.
// Nunca se imprime el valor de ninguna variable: sólo el estado ("missing" / "invalid").

export interface SupabaseRuntimeConfig {
  url: string;
  publishableKey: string;
}

export type SupabaseConfigState = "ok" | "missing" | "invalid";

type Env = Record<string, string | undefined>;

function readEnv(env: Env, name: string): string | undefined {
  const value = env[name];
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// Detecta los valores de ejemplo del propio .env.example (u otros placeholders obvios) para que copiar ese archivo tal cual
// no intente conectar con una URL inexistente. Anclado al INICIO de cada etiqueta del host / de la clave: una clave o un
// proyecto reales (cadenas al azar) no pueden coincidir por casualidad en el medio del texto.
const PLACEHOLDER_LABEL = /^(?:your-project|example|placeholder|changeme|x{4,})/i;
const PLACEHOLDER_KEY = /^(?:sb_publishable_)?(?:example|placeholder|changeme|your|x{4,})/i;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** Production exige HTTPS; el único http permitido es un servidor LOCAL (pruebas con `next start`), nunca en Vercel. */
function isAcceptableUrl(value: string, env: Env): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    if (env.NODE_ENV !== "production") return true;
    return !env.VERCEL && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function evaluateSupabaseConfig(env: Env = process.env): { state: SupabaseConfigState; config: SupabaseRuntimeConfig | null } {
  const url = readEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = readEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !publishableKey) return { state: "missing", config: null };
  if (!isAcceptableUrl(url, env)) return { state: "invalid", config: null };
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { state: "invalid", config: null };
  }
  if (hostname.split(".").some((label) => PLACEHOLDER_LABEL.test(label)) || PLACEHOLDER_KEY.test(publishableKey)) return { state: "invalid", config: null };

  return { state: "ok", config: { url, publishableKey } };
}

/** null si la configuración está ausente, es un placeholder, o es inválida. */
export function getSupabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  return evaluateSupabaseConfig().config;
}

export function getSupabaseConfigState(): SupabaseConfigState {
  return evaluateSupabaseConfig().state;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseRuntimeConfig() !== null;
}

export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** En Production una configuración ausente/inválida NUNCA se trata como «modo local»: el área privada queda no disponible. */
export function shouldFailClosed(env: Env = process.env): boolean {
  return isProductionRuntime(env) && evaluateSupabaseConfig(env).state !== "ok";
}
