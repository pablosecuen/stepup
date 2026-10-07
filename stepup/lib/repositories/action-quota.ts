import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";

/**
 * Límite por ventana para acciones COSTOSAS de la web (R3): se llama ANTES del trabajo costoso (renderizar un PDF, descargar y
 * analizar un respaldo de hasta 20 MB, mandar un correo). Lo decide la base —transaccional y distribuido entre instancias de
 * Vercel, a diferencia de un contador en memoria— con `consume_action_quota` (propietaria = `auth.uid()`; los límites salen de
 * `action_quota_defaults`/`account_quota_overrides`, nunca del cliente).
 *
 * Si se agotó, lanza el error de PostgREST (SQLSTATE 53400, `quota_rate_exceeded`) que `actionErrorMessage` traduce a un texto
 * claro. Cualquier otro fallo también corta la acción (falla cerrado): no se hace el trabajo costoso sin poder contarlo.
 */
export type ExpensiveAction = "report_preview" | "report_pdf" | "cloud_backup_analyze" | "password_change_email" | "account_reauth";

export async function consumeActionQuota(ctx: AuthenticatedDbContext, action: ExpensiveAction): Promise<void> {
  const { error } = await ctx.supabase.rpc("consume_action_quota", { p_action: action });
  if (error) throw error;
}
