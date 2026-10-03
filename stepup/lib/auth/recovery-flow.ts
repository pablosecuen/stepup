import { classifyCallbackUrlError, type CallbackErrorCategory } from "./error-messages.ts";
import { DEFAULT_AUTH_REDIRECT, RECOVERY_PASSWORD_PATH } from "./safe-redirect.ts";

/**
 * Plan de `/auth/confirm` (enlaces de correo: recuperación de contraseña y
 * confirmación de alta). Decide, SIN tocar la red, qué hacer con los parámetros
 * de la URL. La regla central para ambos flujos: abrir el enlace (GET) NUNCA
 * consume el token — sólo muestra una pantalla con un botón; el token se
 * verifica recién cuando la persona lo confirma (POST). Así un escáner/prefetch
 * del correo que sólo hace GET no lo quema (causa documentada de `otp_expired`
 * por Supabase), y como no usa el `code_verifier` PKCE funciona abierto desde
 * otro dispositivo o navegador.
 *
 * Sólo se aceptan los tipos oficiales de `verifyOtp` que usan las plantillas
 * de Supabase para estos dos correos; cualquier otro `type` se rechaza antes de
 * consultar a Supabase.
 */
export type AuthLinkType = "recovery" | "signup" | "email";
export type AuthLinkFlow = "recovery" | "signup";

const FLOW_BY_TYPE: Readonly<Record<AuthLinkType, AuthLinkFlow>> = {
  recovery: "recovery",
  signup: "signup",
  // La plantilla oficial "Confirm signup" de Supabase usa `type=email`.
  email: "signup",
};

function isAuthLinkType(value: string | null | undefined): value is AuthLinkType {
  return value === "recovery" || value === "signup" || value === "email";
}

export function flowOfLinkType(type: AuthLinkType): AuthLinkFlow {
  return FLOW_BY_TYPE[type];
}

export type AuthLinkPlan =
  | { kind: "show-confirmation"; tokenHash: string; type: AuthLinkType; flow: AuthLinkFlow }
  /** Enlace PKCE antiguo (`?code=`): el token ya lo consumió Supabase; /auth/callback lo canjea (sólo en el navegador que lo pidió) y decide el destino. */
  | { kind: "exchange-code"; code: string }
  | { kind: "error"; category: CallbackErrorCategory };

export interface AuthLinkInput {
  tokenHash?: string | null;
  type?: string | null;
  code?: string | null;
  /** `error_code` que Supabase agrega a la URL de retorno cuando el enlace ya falló. */
  urlErrorCode?: string | null;
}

// `token_hash` de Supabase: hex o con prefijo `pkce_`. Se rechaza cualquier otra cosa antes de mostrar nada.
const TOKEN_HASH_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;
const CODE_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;

export function planAuthLinkConfirmation(input: AuthLinkInput): AuthLinkPlan {
  if (input.urlErrorCode) {
    return { kind: "error", category: classifyCallbackUrlError(input.urlErrorCode) };
  }

  if (input.tokenHash) {
    // Un enlace manipulado (otro `type`, caracteres raros, truncado) se corta acá, sin consultar a Supabase.
    if (!isAuthLinkType(input.type)) return { kind: "error", category: "link_invalid" };
    if (!TOKEN_HASH_SHAPE.test(input.tokenHash)) return { kind: "error", category: "link_invalid" };
    return { kind: "show-confirmation", tokenHash: input.tokenHash, type: input.type, flow: FLOW_BY_TYPE[input.type] };
  }

  if (input.code) {
    if (!CODE_SHAPE.test(input.code)) return { kind: "error", category: "link_invalid" };
    return { kind: "exchange-code", code: input.code };
  }

  return { kind: "error", category: "link_invalid" };
}

/** Código de 6 dígitos del correo (alternativa que ningún escáner puede consumir de antemano). */
export function isValidEmailCode(code: string | null | undefined): boolean {
  return typeof code === "string" && /^\d{6}$/.test(code.trim());
}

/** Destino tras verificar bien un enlace/código: recuperación → SIEMPRE "Nueva contraseña"; alta → Inicio. Nunca al revés. */
export function authLinkSuccessDestination(flow: AuthLinkFlow): string {
  return flow === "recovery" ? RECOVERY_PASSWORD_PATH : DEFAULT_AUTH_REDIRECT;
}

/**
 * Decisión de `/nueva-contrasena`: exige sesión Y marcador de recuperación de
 * ESA sesión. Sin sesión → login; con sesión pero sin marcador (sesión vieja
 * de otra cuenta, o la misma sin haber pasado por un enlace) → pedir el enlace.
 */
export function resolveNewPasswordAccess(input: { hasSession: boolean; markerValid: boolean }): { kind: "allow" } | { kind: "redirect"; to: string } {
  if (!input.hasSession) return { kind: "redirect", to: "/login" };
  if (!input.markerValid) return { kind: "redirect", to: "/recuperar-contrasena" };
  return { kind: "allow" };
}
