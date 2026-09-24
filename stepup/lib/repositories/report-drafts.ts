import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";

/**
 * Claim atómico REAL (server-side, vía RPC — nunca localStorage, nunca
 * mutación directa de `report_draft_claims`) de "hay una generación de
 * reporte en curso para este alumno". Toda la lógica de convergencia bajo
 * concurrencia vive en Postgres (`claim_report_draft`/
 * `start_new_report_draft`, ver la migración) — acá sólo se invoca.
 */

/**
 * Reclama (o reutiliza) el borrador activo. Usada SIEMPRE por
 * `generateStudentReportAction`: un reintento tras una respuesta perdida
 * reclama el mismo borrador y por lo tanto termina en el mismo
 * `report_records` (idempotencia real por `operation_id`).
 */
export async function claimReportDraft(ctx: AuthenticatedDbContext, studentId: string): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("claim_report_draft", { p_student_id: studentId });
  if (error) throw error;
  return data as string;
}

export type ReportDraftTransition = "created" | "rotated" | "in_progress";

export interface StartNewReportDraftResult {
  operationId: string;
  /**
   * 'created'/'rotated': esta llamada realmente empezó una operación
   * nueva — es seguro limpiar el formulario. 'in_progress': el claim
   * activo sigue en curso (sin reporte completo) y NO se rotó — nunca hay
   * que limpiar el formulario ni tratarlo como si se hubiera iniciado un
   * reporte nuevo, aunque la llamada haya sido exitosa.
   */
  transition: ReportDraftTransition;
}

/**
 * Transición EXPLÍCITA para empezar una generación nueva — rota el
 * `operation_id` sólo si el borrador actual ya tiene un reporte completo;
 * si sigue en curso, devuelve el mismo. Toda la atomicidad (incluyendo la
 * convergencia de dos llamadas simultáneas al mismo UUID nuevo) la
 * garantiza la propia RPC en una única transacción con lock de fila real.
 */
export async function startNewReportDraft(ctx: AuthenticatedDbContext, studentId: string): Promise<StartNewReportDraftResult> {
  const { data, error } = await ctx.supabase.rpc("start_new_report_draft", { p_student_id: studentId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { operation_id: string; transition: ReportDraftTransition };
  return { operationId: row.operation_id, transition: row.transition };
}
