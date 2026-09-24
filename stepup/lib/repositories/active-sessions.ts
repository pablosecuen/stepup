import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { ActiveSessionRow } from "@/lib/db/database.types";

/**
 * Repositorio de sesión activa — MODELO REAL confirmado por auditoría
 * (Fase 8): `active_sessions` guarda UNA sola fila por profesora (no una
 * lista de dispositivos auditable). Es el mecanismo que usa la app MÓVIL
 * para garantizar "un solo dispositivo autorizado a la vez" en su modelo
 * local-first — la web nunca participa de ese mecanismo como "otro
 * dispositivo" (no tiene almacenamiento local que necesite autorización), así
 * que este repositorio NUNCA llama `transfer_active_session` ni
 * `touch_active_session` (eso reclamaría/renovaría la sesión para un
 * `device_id` de la web, invalidando en el acto el dispositivo móvil real
 * autorizado). Sólo hace dos cosas, ambas reales y ya existentes:
 *  1. Leer la fila actual (RLS ya permite `select` propio directo, sin RPC).
 *  2. Cerrarla remotamente vía `end_active_session`, para el caso real de uso
 *     "perdí el dispositivo / quiero forzar el cierre" — la RPC ya exige
 *     coincidencia exacta de `device_id` + `generation` con la fila vigente
 *     (scopeada a `auth.uid()` por RLS/SECURITY DEFINER), así que sólo puede
 *     cerrar la sesión de la propia cuenta.
 */
export async function getActiveSession(ctx: AuthenticatedDbContext): Promise<ActiveSessionRow | null> {
  const { data, error } = await ctx.supabase.from("active_sessions").select("*").eq("user_id", ctx.ownerId).maybeSingle();
  if (error) throw error;
  return (data as ActiveSessionRow | null) ?? null;
}

export class ActiveSessionMismatchError extends Error {}

/**
 * Cierra remotamente la sesión autorizada actual. `deviceId`/`generation`
 * deben coincidir EXACTO con la fila vigente (se la pasamos tal cual la
 * leímos con `getActiveSession`, nunca un valor local propio de la web) —
 * si no coinciden (alguien ya renovó/transfirió entretanto), la RPC no borra
 * nada y esto lo reporta como conflicto, nunca lo trata como éxito silencioso.
 */
export async function endActiveSession(ctx: AuthenticatedDbContext, deviceId: string, generation: number): Promise<void> {
  const before = await getActiveSession(ctx);
  const { error } = await ctx.supabase.rpc("end_active_session", { p_device_id: deviceId, p_generation: generation });
  if (error) throw error;

  const after = await getActiveSession(ctx);
  const stillSameRow = before && after && after.device_id === before.device_id && after.generation === before.generation;
  if (stillSameRow) {
    throw new ActiveSessionMismatchError(
      "La sesión ya había cambiado (se renovó o se transfirió a otro dispositivo) — no se cerró nada. Recargá para ver el estado actual."
    );
  }
}
