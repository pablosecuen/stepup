import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import type { ReportRecordRow } from "../db/database.types.ts";
import { toReportRecord, toReportRecordSummary, REPORT_RECORD_SCHEMA_VERSION, type ReportRecord, type ReportRecordSummary, type ReportRecordSnapshot } from "./reports-mapping.ts";
import { shouldCleanupUnreferencedPdf } from "../reports/pdf-attach-guard.ts";

export class ReportRecordNotFoundError extends Error {}

const BUCKET = "report-pdfs";

/** El path SIEMPRE se construye acá, a partir del `owner_id` real de sesión y el `student_id` de la FILA ya verificada — nunca a partir de un valor que mande el cliente. */
function pdfObjectPath(ownerId: string, studentId: string, reportId: string): string {
  return `${ownerId}/${studentId}/${reportId}.pdf`;
}

/** Historial real de un alumno — más reciente primero. DTO mínimo, nunca el snapshot completo. */
export async function listReportRecordsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<ReportRecordSummary[]> {
  const { data, error } = await ctx.supabase
    .from("report_records")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return (data as ReportRecordRow[]).map(toReportRecordSummary);
}

/** Detalle completo (con snapshot) — sólo cuando hace falta regenerar/ver, nunca para listar. */
export async function getReportRecord(ctx: AuthenticatedDbContext, reportId: string): Promise<ReportRecord | null> {
  const { data, error } = await ctx.supabase.from("report_records").select("*").eq("owner_id", ctx.ownerId).eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toReportRecord(data as ReportRecordRow);
}

/** Igual que `getReportRecord`, pero busca por `operation_id` — usada para saber si un claim activo ya tiene un reporte real asociado. */
export async function getReportRecordByOperationId(ctx: AuthenticatedDbContext, operationId: string): Promise<ReportRecord | null> {
  const { data, error } = await ctx.supabase.from("report_records").select("*").eq("owner_id", ctx.ownerId).eq("operation_id", operationId).maybeSingle();
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

/**
 * Crea el registro de forma idempotente por `operation_id` — el MISMO
 * `operation_id` (reclamado server-side vía `claimReportDraft`, ver
 * `lib/repositories/report-drafts.ts`) nunca crea una segunda fila;
 * siempre devuelve la fila real (la recién creada o la ya existente).
 * `pdf_url` (acá: el PATH del objeto en Storage, nunca una URL firmada
 * persistida) se completa DESPUÉS, una vez subido el PDF — ver
 * `attachReportPdf`.
 */
export async function createReportRecord(ctx: AuthenticatedDbContext, input: CreateReportRecordInput): Promise<ReportRecord> {
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
      return toReportRecord(existing as ReportRecordRow);
    }
    throw error;
  }
  return toReportRecord(data as ReportRecordRow);
}

/**
 * Sube el PDF real al bucket privado y guarda su PATH (nunca una URL
 * firmada) en la fila. El `studentId` usado para el path viene SIEMPRE de
 * la fila ya verificada por `reportId` (`getReportRecord`, filtrada por
 * `owner_id` real de sesión) — la función ni siquiera recibe un
 * `studentId` como parámetro, así que no hay forma de que un valor
 * manipulable termine en el path.
 *
 * Sirve tanto para la generación inicial como para una regeneración
 * explícita — siempre con `upsert: true`: dos requests concurrentes para
 * el MISMO `reportId` (misma fila, mismo `operation_id`, mismo snapshot ya
 * persistido) siempre representan el mismo contenido lógico, así que
 * sobrescribir nunca pierde información real. Esto evita depender de
 * interpretar el texto de un error de Storage para reconocer un conflicto
 * (eso es exactamente lo que NO hay que hacer: el texto de "ya existe" no
 * es una API estable).
 *
 * Compensación real: si la subida tiene éxito pero el UPDATE de la fila
 * falla después, antes de borrar el objeto recién subido se releé la fila
 * — si YA quedó apuntando a este mismo path (otro request concurrente
 * completó su propio UPDATE exitoso mientras tanto), NUNCA se borra: sería
 * borrar el PDF válido de un ganador real. Sólo se limpia cuando ningún
 * registro vigente lo referencia (`shouldCleanupUnreferencedPdf`).
 */
export async function attachReportPdf(ctx: AuthenticatedDbContext, reportId: string, pdfBytes: Buffer): Promise<void> {
  const record = await getReportRecord(ctx, reportId);
  if (!record) throw new ReportRecordNotFoundError("Reporte no encontrado.");

  const path = pdfObjectPath(ctx.ownerId, record.studentId, record.id);
  const { error: uploadError } = await ctx.supabase.storage.from(BUCKET).upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await ctx.supabase.from("report_records").update({ pdf_url: path }).eq("owner_id", ctx.ownerId).eq("id", reportId);
  if (updateError) {
    const current = await getReportRecord(ctx, reportId).catch(() => null);
    if (shouldCleanupUnreferencedPdf(path, current?.pdfPath ?? null)) {
      await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
    throw updateError;
  }
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

/**
 * Elimina el reporte — sólo el registro y su PDF físico, nunca
 * clases/evaluaciones/otros reportes. Borra primero la FILA (lo único
 * visible para la usuaria) y recién después intenta limpiar el objeto en
 * Storage: si esa limpieza falla, el resultado es a lo sumo un objeto
 * privado huérfano — inaccesible (ninguna fila lo referencia, nunca se
 * puede firmar una URL para él sin una fila) y por lo tanto recuperable
 * sin apuro — nunca una fila visible rota apuntando a un PDF inexistente.
 */
export async function deleteReportRecord(ctx: AuthenticatedDbContext, reportId: string): Promise<void> {
  const record = await getReportRecord(ctx, reportId);
  if (!record) throw new ReportRecordNotFoundError("Reporte no encontrado.");

  const { error } = await ctx.supabase.from("report_records").delete().eq("owner_id", ctx.ownerId).eq("id", reportId);
  if (error) throw error;

  if (record.pdfPath) {
    await ctx.supabase.storage.from(BUCKET).remove([record.pdfPath]).catch(() => {});
  }
}

export { pdfObjectPath };
