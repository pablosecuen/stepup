import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { REPORT_PDF_BUCKET, removeAllReportPdfsOf } from "@/lib/repositories/report-pdf-storage";
import { LESSON_FILES_BUCKET } from "@/lib/repositories/lesson-content";

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

/**
 * Borra TODOS los PDF de reportes y los archivos de clases (adjuntos y materiales) de la cuenta en Storage (ver `report-pdf-storage.ts`) con la propia sesión: las políticas del bucket
 * sólo permiten borrar bajo el prefijo `<id de usuario>/`, y el prefijo sale del `ownerId` real de la sesión, nunca del cliente.
 * Lanza `ReportPdfCleanupIncompleteError` si quedó algo: en ese caso la cuenta NO debe eliminarse.
 */
export async function removeOwnReportPdfs(ctx: AuthenticatedDbContext): Promise<void> {
  await removeAllReportPdfsOf(ctx.supabase.storage.from(REPORT_PDF_BUCKET) as never, ctx.ownerId);
  // Los adjuntos y materiales trasladados también son datos de alumnos: se borran igual (mismo recorrido, mismo prefijo de la cuenta).
  await removeAllReportPdfsOf(ctx.supabase.storage.from(LESSON_FILES_BUCKET) as never, ctx.ownerId);
}
