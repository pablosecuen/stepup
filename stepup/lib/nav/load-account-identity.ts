import "server-only";
import type { AuthUser } from "@/lib/auth/auth-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTeacherProfile } from "@/lib/repositories/teacher-profile";
import type { AccountIdentityInput } from "@/lib/nav/account-identity";

/**
 * Nombre y correo para el shell. SÓLO lectura (la misma fila `teacher_profiles` que ya lee Configuración) y a prueba de
 * fallos: si el nombre no se puede leer (red, sesión recién creada, fila inexistente…) devuelve únicamente el correo y el
 * shell sigue renderizando. Reusa el usuario ya verificado por el layout (no vuelve a pedirlo a Auth) y nunca loguea datos.
 */
export async function loadAccountIdentity(user: AuthUser | null): Promise<AccountIdentityInput> {
  const email = user?.email ?? null;
  if (!user) return { displayName: null, email };
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { displayName: null, email };
    const profile = await getTeacherProfile({ supabase, ownerId: user.id });
    return { displayName: profile.displayName || null, email };
  } catch {
    return { displayName: null, email };
  }
}
