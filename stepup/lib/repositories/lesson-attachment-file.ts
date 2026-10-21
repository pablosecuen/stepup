import type { AuthenticatedDbContext } from "../db/server-context.ts";

/**
 * Entrega de un adjunto de clase al navegador (foto o PDF) POR EL SERVIDOR de TeacherFlow, para que el navegador nunca hable con Supabase (la política de
 * seguridad del sitio sólo permite el propio origen). Verifica que el archivo sea de la cuenta de la sesión y esté disponible antes de leerlo.
 * Archivo aparte de `lesson-content.ts` (que es `server-only`) para poder probarse con `node --test`.
 */

export const LESSON_FILES_BUCKET_NAME = "lesson-files";

export class AttachmentNotFoundError extends Error {}
export class AttachmentNotAvailableError extends Error {}

export interface LessonAttachmentFile {
  blob: Blob;
  name: string;
  mimeType: string | null;
}

export async function getLessonAttachmentFile(ctx: AuthenticatedDbContext, id: string): Promise<LessonAttachmentFile> {
  const { data, error } = await ctx.supabase.from("lesson_attachments").select("name, mime_type, storage_path, file_status").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data as { name: string; mime_type: string | null; storage_path: string | null; file_status: string } | null;
  if (!row) throw new AttachmentNotFoundError("No encontramos ese archivo.");
  if (row.file_status !== "disponible" || !row.storage_path) throw new AttachmentNotAvailableError("Este archivo todavía no está disponible.");
  if (!row.storage_path.startsWith(`${ctx.ownerId}/`)) throw new AttachmentNotFoundError("No encontramos ese archivo.");
  const { data: blob, error: downloadError } = await ctx.supabase.storage.from(LESSON_FILES_BUCKET_NAME).download(row.storage_path);
  if (downloadError) throw downloadError;
  if (!blob) throw new AttachmentNotFoundError("No encontramos ese archivo.");
  return { blob, name: row.name, mimeType: row.mime_type };
}
