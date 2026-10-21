import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { LESSON_FILES_BUCKET } from "../repositories/lesson-content.ts";
import { toReportJpeg } from "./evidence-image.ts";
import type { StudentReportEvidenceCandidate } from "./student-report-data.ts";
import type { PreparedEvidence, PreparedEvidenceFile, PreparedEvidenceImage } from "./evidence.ts";

/**
 * Prepara las evidencias elegidas para el PDF del reporte: cada foto se lee del almacenamiento privado de la cuenta, se endereza, se reduce (el PDF no necesita la foto original: 900 px de ancho alcanza para
 * la miniatura del reporte) y se guarda como JPEG; las fotos HEIC se convierten en el servidor. Un PDF se nombra con su fecha (no se incrusta). Si una foto no se puede leer o convertir, el reporte
 * NO falla: esa evidencia figura como «no disponible». Siempre por la cuenta de la sesión; nunca modifica ni borra ningún archivo.
 */
export async function prepareReportEvidence(ctx: AuthenticatedDbContext, selected: readonly StudentReportEvidenceCandidate[]): Promise<PreparedEvidence> {
  const images: PreparedEvidenceImage[] = [];
  const files: PreparedEvidenceFile[] = [];
  const imageCandidates = selected.filter((candidate) => candidate.kind === "image");
  for (const candidate of selected) if (candidate.kind === "pdf") files.push({ dateKey: candidate.dateKey, name: candidate.name, kind: "pdf" });
  if (imageCandidates.length === 0) return { images, files };

  const { data, error } = await ctx.supabase.from("lesson_attachments").select("id, storage_path, file_status").eq("owner_id", ctx.ownerId).in("id", imageCandidates.map((c) => c.attachmentId));
  if (error) throw error;
  const rows = new Map((data as { id: string; storage_path: string | null; file_status: string }[]).map((row) => [row.id, row]));

  // De a una: decodificar una foto grande ocupa bastante memoria.
  for (const candidate of imageCandidates) {
    const row = rows.get(candidate.attachmentId);
    try {
      if (!row || row.file_status !== "disponible" || !row.storage_path || !row.storage_path.startsWith(`${ctx.ownerId}/`)) throw new Error("not_available");
      const { data: blob, error: downloadError } = await ctx.supabase.storage.from(LESSON_FILES_BUCKET).download(row.storage_path);
      if (downloadError || !blob) throw new Error("download");
      const jpeg = await toReportJpeg(new Uint8Array(await blob.arrayBuffer()));
      images.push({ attachmentId: candidate.attachmentId, dateKey: candidate.dateKey, name: candidate.name, caption: candidate.caption, jpeg });
    } catch {
      files.push({ dateKey: candidate.dateKey, name: candidate.name, kind: "unavailable" });
    }
  }
  return { images, files };
}
