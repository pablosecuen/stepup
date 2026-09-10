"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseRuntimeConfig } from "@/lib/auth/config";

/**
 * Cliente de Supabase para el navegador (Client Components). `null` si el
 * entorno no está configurado — nunca lanza, nunca intenta conectarse con
 * una URL vacía o de ejemplo. Sesión persistida vía cookies (no
 * localStorage), flujo PKCE explícito, igual criterio que el cliente móvil
 * (`src/features/account/lib/supabaseClient.ts`: persistSession true,
 * autoRefreshToken true, flowType 'pkce').
 */
export function createSupabaseBrowserClient() {
  const config = getSupabaseRuntimeConfig();
  if (!config) return null;

  return createBrowserClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
