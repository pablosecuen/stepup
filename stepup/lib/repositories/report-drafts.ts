import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import type { ReportDraftClaimRow, ReportRecordRow } from "../db/database.types.ts";

/**
 * Claim atómico REAL (server-side, nunca localStorage) de "hay una
 * generación de reporte en curso para este alumno". `localStorage` puede
 * seguir usándose como optimización de interfaz (por ejemplo, para
 * deshabilitar un botón), pero la única garantía real de que dos pestañas
 * o dos reintentos concurrentes converjan en el MISMO `operation_id` es
 * esta fila única por (owner_id, student_id): la clave primaria de
 * `report_draft_claims` hace que Postgres serialice cualquier INSERT
 * concurrente sobre la misma clave — no es una secuencia simulada, es
 * atomicidad real de la base.
 *
 * Idéntico patrón de idempotencia que `createReportRecord` (intentar
 * insertar; si choca por clave duplicada, releer y devolver lo que ya
 * existe) pero la clave acá es (owner_id, student_id) en vez de
 * (owner_id, operation_id) — así el `operation_id` en sí mismo nace
 * siempre server-side (`default gen_random_uuid()`), nunca confía en un
 * valor que mande el cliente.
 */
export async function claimReportDraft(ctx: AuthenticatedDbContext, studentId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("report_draft_claims")
    .insert({ owner_id: ctx.ownerId, student_id: studentId })
    .select("operation_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: selectError } = await ctx.supabase
        .from("report_draft_claims")
        .select("operation_id")
        .eq("owner_id", ctx.ownerId)
        .eq("student_id", studentId)
        .single();
      if (selectError) throw selectError;
      return (existing as Pick<ReportDraftClaimRow, "operation_id">).operation_id;
    }
    throw error;
  }
  return (data as Pick<ReportDraftClaimRow, "operation_id">).operation_id;
}

/**
 * Libera el claim activo — únicamente si corresponde a un `operation_id`
 * que ya tiene un `report_records` REALMENTE completo (con PDF real
 * adjunto, `pdf_url` no nulo). Si el claim sigue en curso, es un no-op
 * silencioso: nunca se libera antes de tiempo.
 *
 * Esta es la "transición explícita" real después de un éxito confirmado:
 * nunca se llama automáticamente al terminar de generar dentro de
 * `generateStudentReportAction` (eso rompería el reintento ante una
 * respuesta perdida — si el servidor liberase el claim apenas termina,
 * pero la respuesta nunca llega a la pestaña, un reintento posterior
 * reclamaría un `operation_id` nuevo y duplicaría el reporte). Sólo la
 * propia pestaña, después de RECIBIR de verdad la confirmación de éxito,
 * dispara esta acción — ver `startNewReportDraftAction`.
 */
export async function releaseReportDraft(ctx: AuthenticatedDbContext, studentId: string): Promise<void> {
  const { data: claim, error: claimError } = await ctx.supabase
    .from("report_draft_claims")
    .select("operation_id")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return;

  const operationId = (claim as Pick<ReportDraftClaimRow, "operation_id">).operation_id;

  const { data: record, error: recordError } = await ctx.supabase
    .from("report_records")
    .select("pdf_url")
    .eq("owner_id", ctx.ownerId)
    .eq("operation_id", operationId)
    .maybeSingle();
  if (recordError) throw recordError;
  if (!record || (record as Pick<ReportRecordRow, "pdf_url">).pdf_url === null) return;

  const { error: deleteError } = await ctx.supabase
    .from("report_draft_claims")
    .delete()
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .eq("operation_id", operationId);
  if (deleteError) throw deleteError;
}
