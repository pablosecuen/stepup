"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatSessionRecoveryLog, probeSessionReadiness, type ReadOnlyProbeClient, type SessionReadiness } from "@/lib/auth/session-recovery";

/**
 * Comprobación de SÓLO LECTURA de la sesión recién iniciada (ver lib/auth/session-recovery.ts): la llama la pantalla
 * `/iniciando-sesion` antes de volver a cargar Inicio. Sólo hace `select … limit 1` filtrados por el dueño; no ejecuta
 * ninguna RPC ni escribe nada, así que repetirla es inofensivo. Cada comprobación deja una línea de log sin datos.
 */
export async function checkSessionReadyAction(attempt: number): Promise<SessionReadiness> {
  const supabase = await createSupabaseServerClient();
  const safeAttempt = Number.isInteger(attempt) && attempt >= 1 && attempt <= 10 ? attempt : 0;

  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!supabase || !user) {
    console.warn(formatSessionRecoveryLog({ attempt: safeAttempt, status: "signed_out" }));
    return { status: "signed_out" };
  }

  const readiness = await probeSessionReadiness(supabase as unknown as ReadOnlyProbeClient, user.id);
  console.warn(formatSessionRecoveryLog({ attempt: safeAttempt, status: readiness.status, code: readiness.status === "error" ? readiness.code : null }));
  return readiness;
}
