import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteOrigin } from "@/lib/auth/site-url";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { translateAuthError, translateCallbackError, classifyCallbackError } from "@/lib/auth/error-messages";
import type { AuthAdapter, AuthActionResult, AuthUser, SignUpOutcome } from "@/lib/auth/auth-adapter";

// Mismo texto que móvil cuando `getSupabaseClient()` devuelve null
// (`useAuthSession.ts`): "La sincronización con la nube todavía no está
// configurada."
const NOT_CONFIGURED: AuthActionResult<never> = {
  ok: false,
  error: { message: "La sincronización con la nube todavía no está configurada." },
};

function toUser(user: { id: string; email?: string | null } | null | undefined): AuthUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
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

      const origin = await getSiteOrigin();
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };

      // Igual que móvil: "confirmar correo" es siempre obligatorio, nunca
      // se intenta iniciar sesión directamente después de signUp.
      return { ok: true, data: { needsEmailConfirmation: !data.session } };
    },

    async resendConfirmationEmail(email) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const origin = await getSiteOrigin();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizeEmail(email),
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error) return { ok: false, error: { message: translateAuthError(error) } };
      return { ok: true, data: undefined };
    },

    async requestPasswordReset(email) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return NOT_CONFIGURED;

      const origin = await getSiteOrigin();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/nueva-contrasena")}`,
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

    async exchangeCodeForSession(code) {
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
      return { ok: true, data: user };
    },

    async getUser() {
      const supabase = await createSupabaseServerClient();
      if (!supabase) return null;

      const { data } = await supabase.auth.getUser();
      return toUser(data.user);
    },
  };
}
