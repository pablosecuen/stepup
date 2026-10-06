import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteOrigin, SiteOriginUnavailableError } from "@/lib/auth/site-url";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { AUTH_ERROR_MESSAGES, translateAuthError, translateCallbackError, classifyCallbackError, classifyVerifyOtpError, CALLBACK_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import type { AuthAdapter, AuthActionResult, AuthExchangeUser, AuthUser, SignUpOutcome } from "@/lib/auth/auth-adapter";

// Mismo texto que móvil cuando `getSupabaseClient()` devuelve null
// (`useAuthSession.ts`): "La sincronización con la nube todavía no está
// configurada."
const NOT_CONFIGURED: AuthActionResult<never> = {
  ok: false,
  error: { message: "La sincronización con la nube todavía no está configurada." },
};

// El origen canónico del enlace del correo no está disponible (R1): el correo NO se envía y la persona ve un mensaje
// controlado (sin variables ni valores). Ver lib/auth/site-origin.ts.
const ORIGIN_UNAVAILABLE: AuthActionResult<never> = { ok: false, error: { message: AUTH_ERROR_MESSAGES.server_unavailable } };

async function siteOriginOrNull(): Promise<string | null> {
  try {
    return await getSiteOrigin();
  } catch (error) {
    if (error instanceof SiteOriginUnavailableError) return null;
    throw error;
  }
}

function toUser(user: { id: string; email?: string | null } | null | undefined): AuthUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

function toVerifyResult(
  user: { id: string; email?: string | null } | null | undefined,
  error: { code?: string; status?: number; name?: string; message?: string } | null
): AuthActionResult<AuthUser> {
  if (error) {
    const category = classifyVerifyOtpError(error);
    return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES[category], code: category } };
  }
  const mapped = toUser(user);
  if (!mapped) {
    const category = classifyVerifyOtpError(undefined);
    return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES[category], code: category } };
  }
  return { ok: true, data: mapped };
}

/**
 * Implementación real del `AuthAdapter`, sobre el cliente Supabase de
 * servidor (`@supabase/ssr`, cookies). Nunca se llama desde el navegador —
 * siempre desde Server Actions o Route Handlers (ver "server-only" arriba).
 * `createSupabaseServerClient()` devuelve `null` cuando el entorno no está
 * configurado; cada método lo maneja devolviendo el mismo texto que móvil,
 * nunca lanzando ni intentando conectarse.
 */
export function createSupabaseAuthAdapter(): AuthAdapter {
  return {
    async signInWithPassword(email, password) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };

      const user = toUser(data.user);
      if (!user) return { ok: false, error: { message: translateAuthError(undefined) } };
      return { ok: true, data: user };
    },

    async signUp(email, password) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const origin = await siteOriginOrNull();
      if (origin === null) return ORIGIN_UNAVAILABLE;
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        // /auth/confirm acepta el enlace nuevo (`?token_hash=&type=email`, sin PKCE) y el antiguo (`?code=`).
        options: { emailRedirectTo: `${origin}/auth/confirm` },
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };

      // Igual que móvil: "confirmar correo" es siempre obligatorio, nunca
      // se intenta iniciar sesión directamente después de signUp.
      return { ok: true, data: { needsEmailConfirmation: !data.session } };
    },

    async resendConfirmationEmail(email) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const origin = await siteOriginOrNull();
      if (origin === null) return ORIGIN_UNAVAILABLE;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizeEmail(email),
        options: { emailRedirectTo: `${origin}/auth/confirm` },
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };
      return { ok: true, data: undefined };
    },

    async requestPasswordReset(email) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const origin = await siteOriginOrNull();
      if (origin === null) return ORIGIN_UNAVAILABLE;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        // /auth/confirm acepta el enlace nuevo (`?token_hash=`, sin PKCE) y el antiguo (`?code=`).
        redirectTo: `${origin}/auth/confirm`,
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };
      return { ok: true, data: undefined };
    },

    async updatePassword(newPassword) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };
      return { ok: true, data: undefined };
    },

    async signOut() {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      // scope: 'local' — igual que móvil: nunca revoca otros dispositivos.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };
      return { ok: true, data: undefined };
    },

    async exchangeCodeForSession(code): Promise<AuthActionResult<AuthExchangeUser>> {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return { ok: false, error: { message: translateCallbackError(error), code: classifyCallbackError(error) } };
      }

      const user = toUser(data.user);
      if (!user) {
        return {
          ok: false,
          error: { message: translateCallbackError(undefined), code: classifyCallbackError(undefined) },
        };
      }
      // supabase-js recuerda en el verificador PKCE (sufijo "/recovery") que el código vino de resetPasswordForEmail y lo
      // devuelve como `redirectType`, un campo que existe en runtime pero no figura en sus tipos.
      const redirectType = (data as { redirectType?: string | null }).redirectType;
      const exchanged: AuthExchangeUser = { ...user, isRecovery: redirectType === "recovery" };
      return { ok: true, data: exchanged };
    },

    async verifyLinkToken(tokenHash, type) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      return toVerifyResult(data?.user, error);
    },

    async verifyEmailCode(email, code, flow) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const { data, error } = await supabase.auth.verifyOtp({ type: flow, email: normalizeEmail(email), token: code.trim() });
      return toVerifyResult(data?.user, error);
    },

    async getUser() {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return null;

      const { data } = await supabase.auth.getUser();
      return toUser(data.user);
    },
  };
}
