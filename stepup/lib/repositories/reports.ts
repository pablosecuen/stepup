import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable } from "../db/read.ts";
import type { ReportRecordRow } from "../db/database.types.ts";
import { toReportRecord, toReportRecordSummary, REPORT_RECORD_SCHEMA_VERSION, type ReportRecord, type ReportRecordSummary, type ReportRecordSnapshot } from "./reports-mapping.ts";

export class ReportRecordNotFoundError extends Error {}

const BUCKET = "report-pdfs";

/** El path SIEMPRE se construye acá, a partir del `owner_id` real de sesión y el `student_id` de la FILA ya verificada — nunca a partir de un valor que mande el cliente. */
function pdfObjectPath(ownerId: string, studentId: string, reportId: string): string {
  return `${ownerId}/${studentId}/${reportId}.pdf`;
}

/** Historial real de un alumno — más reciente primero. DTO mínimo, nunca el snapshot completo. */
export async function listReportRecordsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<ReportRecordSummary[]> {
  // Páginas chicas: cada fila trae el snapshot del reporte (jsonb), así que se limita el peso de cada respuesta.
  const data = await readTable<ReportRecordRow>(ctx.supabase, "report_records", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: [
      { column: "generated_at", ascending: false },
      { column: "id", ascending: false },
    ],
    pageSize: 50,
  });
  return data.map(toReportRecordSummary);
}

/** Detalle completo (con snapshot) — sólo cuando hace falta regenerar/ver, nunca para listar. */
export async function getReportRecord(ctx: AuthenticatedDbContext, reportId: string): Promise<ReportRecord | null> {
  const { data, error } = await ctx.supabase.from("report_records").select("*").eq("owner_id", ctx.ownerId).eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toReportRecord(data as ReportRecordRow);
}

export interface CreateReportRecordInput {
  operationId: string;
  studentId: string;
  title: string;
  selectedMonths: string[];
  periodStart: string;
  periodEnd: string;
  snapshot: ReportRecordSnapshot;
}

export interface CreateReportRecordResult {
  record: ReportRecord;
  /** false cuando esta llamada convergió en una fila YA existente (mismo operation_id) en vez de crear una nueva — idempotencia real, nunca simulada. */
  wasCreated: boolean;
}

/**
 * Crea el registro de forma idempotente por `operation_id` — el MISMO
 * `operation_id` (reclamado server-side vía `claimReportDraft`, ver
 * `lib/repositories/report-drafts.ts`) nunca crea una segunda fila;
 * siempre devuelve la fila real (la recién creada o la ya existente), y
 * SIEMPRE informa cuál de las dos pasó — el llamador lo necesita para
 * decidir si lo que se está devolviendo a la usuaria corresponde de
 * verdad a lo que pidió (ver `lib/reports/generate-outcome.ts`).
 * `pdf_url` (acá: el PATH del objeto en Storage, nunca una URL firmada
 * persistida) se completa DESPUÉS, una vez subido el PDF — ver
 * `attachReportPdf`.
 */
export async function createReportRecord(ctx: AuthenticatedDbContext, input: CreateReportRecordInput): Promise<CreateReportRecordResult> {
  const { data, error } = await ctx.supabase
    .from("report_records")
    .insert({
      owner_id: ctx.ownerId,
      operation_id: input.operationId,
      student_id: input.studentId,
      title: input.title,
      selected_months: input.selectedMonths,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      snapshot: input.snapshot as unknown as Record<string, unknown>,
      schema_version: REPORT_RECORD_SCHEMA_VERSION,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: selectError } = await ctx.supabase
        .from("report_records")
        .select("*")
        .eq("owner_id", ctx.ownerId)
        .eq("operation_id", input.operationId)
        .single();
      if (selectError) throw selectError;
      return { record: toReportRecord(existing as ReportRecordRow), wasCreated: false };
    }
    throw error;
  }
  return { record: toReportRecord(data as ReportRecordRow), wasCreated: true };
}

/**
 * Sube el PDF real al bucket privado y guarda su PATH (nunca una URL
 * firmada) en la fila. El `studentId` usado para el path viene SIEMPRE de
 * la fila ya verificada por `reportId` (`getReportRecord`, filtrada por
 * `owner_id` real de sesión) — la función ni siquiera recibe un
 * `studentId` como parámetro.
 *
 * Siempre `upsert: true`: el path es determinístico (`ownerId/studentId/
 * reportId.pdf`) y dos requests concurrentes para el MISMO `reportId`
 * comparten siempre el mismo `operation_id`/snapshot ya persistido, así
 * que sobrescribir nunca pierde información real.
 *
 * Si el UPDATE posterior falla, el objeto NO se borra acá — queda
 * disponible en Storage hasta el próximo reintento idempotente de esta
 * misma operación (mismo `reportId`, mismo path determinístico). Borrar
 * en este punto sería una carrera real tipo TOCTOU: no hay forma de
 * comprobar de forma atómica, sólo releyendo la fila, que ningún otro
 * request concurrente esté a punto de completar su propio UPDATE con este
 * mismo objeto un instante después — es preferible un objeto huérfano
 * recuperable a arriesgar borrar el PDF de un ganador real.
 */
export async function attachReportPdf(ctx: AuthenticatedDbContext, reportId: string, pdfBytes: Buffer): Promise<void> {
  const record = await getReportRecord(ctx, reportId);
  if (!record) throw new ReportRecordNotFoundError("Reporte no encontrado.");

  const path = pdfObjectPath(ctx.ownerId, record.studentId, record.id);
  const { error: uploadError } = await ctx.supabase.storage.from(BUCKET).upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await ctx.supabase.from("report_records").update({ pdf_url: path }).eq("owner_id", ctx.ownerId).eq("id", reportId);
  if (updateError) throw updateError;
}

/** URL firmada y temporal para ver/descargar — nunca una URL pública permanente. Verifica ownership antes de firmar. */
export async function getSignedReportPdfUrl(ctx: AuthenticatedDbContext, reportId: string, expiresInSeconds = 300): Promise<string> {
  const record = await getReportRecord(ctx, reportId);
  if (!record) throw new ReportRecordNotFoundError("Reporte no encontrado.");
  if (!record.pdfPath) throw new Error("Este reporte todavía no tiene un PDF generado.");

  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(record.pdfPath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

interface ReportPdfCleanupJobRow {
  id: string;
  owner_id: string;
  pdf_path: string;
  created_at: string;
}

/**
 * Reintenta, de forma oportunista (sin cron), cualquier limpieza de
 * Storage pendiente del owner real. Se llama: (a) apenas `deleteReportRecord`
 * encola un trabajo nuevo, (b) cada vez que se carga el historial de
 * reportes (`listStudentReportsAction`), y (c) desde una acción explícita
 * de recuperación (`retryPendingReportCleanupAction`) — así un trabajo
 * nunca queda abandonado indefinidamente sólo porque nadie volvió a
 * eliminar otro reporte.
 *
 * "Objeto inexistente" cuenta como éxito (Storage no falla al borrar un
 * path que ya no existe), y un trabajo sólo se resuelve (se borra de la
 * cola) después de confirmar el borrado real — si Storage falla, el
 * trabajo queda pendiente para el próximo intento, nunca se pierde.
 *
 * Antes de borrar CUALQUIER objeto, se verifica que ningún
 * `report_records` vigente del owner siga referenciando ese path exacto.
 * En la práctica esto nunca debería encontrar una coincidencia — los
 * paths son deterministas y únicos por `reportId`
 * (`${ownerId}/${studentId}/${reportId}.pdf`, un UUID que nunca se
 * reutiliza), y el trabajo sólo se encola atómicamente junto con el
 * DELETE de la fila que lo originó (`delete_report_record`) — pero se
 * comprueba igual, en vez de asumirlo, como última defensa real.
 */
export async function sweepPendingReportPdfCleanupJobs(ctx: AuthenticatedDbContext): Promise<number> {
  const { data, error } = await ctx.supabase.rpc("list_pending_report_pdf_cleanup_jobs");
  if (error || !data) return 0;

  let resolvedCount = 0;
  for (const job of data as ReportPdfCleanupJobRow[]) {
    const { data: stillReferenced, error: referenceCheckError } = await ctx.supabase
      .from("report_records")
      .select("id")
      .eq("owner_id", ctx.ownerId)
      .eq("pdf_url", job.pdf_path)
      .maybeSingle();
    // Fail-closed: si la propia comprobación falla, NUNCA se asume que el
    // path está libre — mejor dejar el trabajo pendiente para el próximo
    // barrido que arriesgar borrar un objeto que sí sigue referenciado.
    if (referenceCheckError || stillReferenced) continue;

    const { error: removeError } = await ctx.supabase.storage.from(BUCKET).remove([job.pdf_path]);
    if (!removeError) {
      // Best-effort: si esto falla, el trabajo simplemente sigue pendiente
      // y se reintenta en el próximo barrido.
      const { error: resolveError } = await ctx.supabase.rpc("resolve_report_pdf_cleanup_job", { p_job_id: job.id });
      if (!resolveError) resolvedCount += 1;
    }
  }
  return resolvedCount;
}

/**
 * Elimina el reporte — sólo el registro y su PDF físico, nunca
 * clases/evaluaciones/otros reportes. La fila y el encolado del trabajo
 * de limpieza (si tenía PDF) los hace atómicamente la RPC
 * `delete_report_record` (una sola transacción real en Postgres): nunca
 * puede quedar una fila borrada sin su trabajo, ni viceversa. A partir de
 * ahí, borrar el objeto de Storage es best-effort y reintentable — un
 * fallo acá deja, como máximo, un objeto privado huérfano (inaccesible:
 * ninguna fila lo referencia, nunca se puede firmar una URL para él sin
 * una fila) nunca una fila visible rota.
 */
export async function deleteReportRecord(ctx: AuthenticatedDbContext, reportId: string): Promise<void> {
  const { error } = await ctx.supabase.rpc("delete_report_record", { p_report_id: reportId });
  if (error) {
    if (error.code === "P0002") throw new ReportRecordNotFoundError("Reporte no encontrado.");
    throw error;
  }
  await sweepPendingReportPdfCleanupJobs(ctx);
}

export { pdfObjectPath };
