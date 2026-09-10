// Categorías y textos EXACTOS copiados de móvil
// (`src/features/account/utils/translateAuthError.ts` y
// `deepLinkAuth.ts`), con una sola adaptación de palabra: donde móvil dice
// "…volvé a pedirlo desde la app.", acá dice "…volvé a pedirlo." (no hay
// "app" en la web). Ningún otro texto ni regla se modifica ni se inventa.

export type AuthErrorCategory =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_exists"
  | "weak_password"
  | "no_connection"
  | "server_unavailable"
  | "unknown";

// Mismo motivo que móvil: Supabase devuelve el mismo código
// `invalid_credentials` tanto si la cuenta no existe como si la contraseña
// es incorrecta — nunca revelar cuál de las dos pasó.
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCategory, string> = {
  invalid_credentials: "El correo o la contraseña no son correctos.",
  email_not_confirmed: "Todavía no confirmaste tu correo. Revisá tu bandeja de entrada (y la carpeta de spam).",
  user_already_exists: "Ya existe una cuenta con ese correo. Iniciá sesión o recuperá tu contraseña.",
  weak_password: "La contraseña es demasiado débil. Usá al menos 8 caracteres.",
  no_connection: "No hay conexión a internet. Conectate y probá de nuevo.",
  server_unavailable: "El servidor no está disponible en este momento. Probá de nuevo en unos minutos.",
  unknown: "No se pudo completar la operación. Probá de nuevo.",
};

export type CallbackErrorCategory =
  | "link_expired"
  | "link_already_used"
  | "link_invalid"
  | "no_connection"
  | "server_error"
  | "unknown";

export const CALLBACK_ERROR_MESSAGES: Record<CallbackErrorCategory, string> = {
  link_expired: "Este enlace venció. Volvé a pedirlo.",
  link_already_used: "Este enlace ya fue usado. Si ya confirmaste tu cuenta, iniciá sesión normalmente.",
  link_invalid: "Este enlace no es válido.",
  no_connection: "No hay conexión a internet. Conectate y volvé a tocar el enlace.",
  server_error: "El servidor no está disponible en este momento. Probá de nuevo en unos minutos.",
  unknown: "No se pudo procesar el enlace.",
};

interface RawAuthError {
  code?: string | null;
  status?: number | null;
  name?: string;
}

/**
 * Clasifica un error crudo de Supabase Auth en una categoría estable —
 * mismo criterio que `classifyAuthError` en móvil: primero el `code`
 * conocido, después el status (0 -&gt; sin conexión, 5xx -&gt; servidor no
 * disponible vía `AuthRetryableFetchError`), por último `unknown`.
 */
export function classifyAuthError(error: RawAuthError | null | undefined): AuthErrorCategory {
  if (!error) return "unknown";

  switch (error.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "user_already_exists":
      return "user_already_exists";
    case "weak_password":
      return "weak_password";
  }

  if (error.name === "AuthRetryableFetchError") {
    return error.status === 0 ? "no_connection" : "server_unavailable";
  }

  return "unknown";
}

export function translateAuthError(error: RawAuthError | null | undefined): string {
  return AUTH_ERROR_MESSAGES[classifyAuthError(error)];
}

/**
 * Clasifica el resultado de un intercambio PKCE (`/auth/callback`) — mismo
 * criterio que `classifyDeepLinkErrorDescription`/
 * `classifyAuthErrorAsDeepLinkCategory` en móvil: un código de un solo uso
 * que falla casi siempre es "ya usado"; conexión/servidor se distinguen
 * igual que arriba.
 */
export function classifyCallbackError(error: RawAuthError | null | undefined): CallbackErrorCategory {
  if (!error) return "unknown";

  if (error.name === "AuthRetryableFetchError") {
    return error.status === 0 ? "no_connection" : "server_error";
  }

  if (error.code === "otp_expired") return "link_expired";

  // PKCE es de un solo uso: la causa real más común de una excepción acá
  // es que el enlace ya se abrió antes, no que haya un error de servidor.
  return "link_already_used";
}

export function translateCallbackError(error: RawAuthError | null | undefined): string {
  return CALLBACK_ERROR_MESSAGES[classifyCallbackError(error)];
}

/** Clasifica el propio parámetro `?error=&error_code=` que Supabase agrega a la URL de retorno cuando el enlace ya falló antes de llegar a nuestro código. */
export function classifyCallbackUrlError(errorCode: string | null | undefined): CallbackErrorCategory {
  if (!errorCode) return "unknown";
  if (errorCode === "otp_expired") return "link_expired";
  if (errorCode === "access_denied") return "link_invalid";
  return "unknown";
}
