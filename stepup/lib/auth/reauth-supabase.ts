import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeConfig } from "@/lib/auth/config";
import { verifyPassword, type PasswordCheck } from "@/lib/auth/reauth";

/**
 * Verifica la contraseña de la persona contra Supabase Auth con un cliente APARTE de la sesión (sin cookies, sin persistencia, sin
 * refresco automático). Ver `reauth.ts`: la sesión que crea la verificación se cierra con alcance LOCAL.
 */
export async function verifyOwnPassword(email: string, password: string, captchaToken?: string): Promise<PasswordCheck> {
  const config = getSupabaseRuntimeConfig();
  if (!config) return { ok: false, reason: "unavailable" };

  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return verifyPassword(
    {
      signIn: (input) => client.auth.signInWithPassword(input),
      discardSession: async () => {
        await client.auth.signOut({ scope: "local" });
      },
    },
    email,
    password,
    captchaToken
  );
}
