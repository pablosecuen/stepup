import "server-only";
import { cache } from "react";
import type { AuthUser } from "@/lib/auth/auth-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Usuario verificado con Auth, UNA sola vez por solicitud de renderizado. El layout privado y la página (vía
 * `requireAuthenticatedDbContext`) corren a la vez en cada navegación y antes cada uno preguntaba a Supabase Auth por separado:
 * dos idas y vueltas de red para el mismo dato. `cache` de React comparte la misma promesa entre ambos DENTRO de la solicitud (nunca
 * entre solicitudes ni personas). La recuperación de sesión (B0) y el resto de los flujos de cuenta siguen usando el adaptador
 * directamente: siempre consultan de nuevo.
 */
export const getRenderUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});
