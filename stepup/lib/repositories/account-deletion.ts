import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";

/**
 * Conecta la RPC `delete_own_account()` YA EXISTENTE (ver
 * `database.types.ts`, confirmada por introspección real Fase 8) — nunca la
 * redefine. Sin parámetros: resuelve `auth.uid()` en servidor, borra
 * `auth.users` y todo lo que cuelga de ahí por `ON DELETE CASCADE`
 * (`active_sessions`, `cloud_backups`, y en este proyecto también los datos
 * propios de la web vía `owner_id references auth.users(id) on delete
 * cascade`). Irreversible, sin período de gracia — igual criterio que móvil.
 */
export async function deleteOwnAccount(ctx: AuthenticatedDbContext): Promise<void> {
  const { error } = await ctx.supabase.rpc("delete_own_account");
  if (error) throw error;
}
