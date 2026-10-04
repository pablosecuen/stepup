import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseRuntimeConfig } from "@/lib/auth/config";

/**
 * Cliente de Supabase para Server Components/Actions/Route Handlers.
 * `null` si el entorno no está configurado. Usa las cookies de la request
 * (patrón oficial `@supabase/ssr` para Next.js App Router) — nunca
 * localStorage, nunca una única cookie de sesión larga sin refrescar.
 *
 * `setAll` puede fallar cuando se llama desde un Server Component puro
 * (no puede escribir cookies) — se ignora a propósito: `proxy.ts` ya
 * refresca la sesión en cada navegación, así que perder una escritura acá
 * no deja al usuario sin sesión.
 */
export async function createSupabaseServerClient() {
  const config = getSupabaseRuntimeConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Ver comentario de arriba: seguro de ignorar.
        }
      },
    },
  });
}
