import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { LESSON_FILES_BUCKET } from "./lesson-content.ts";
import { attachmentStoragePath, checkPickedFile, cleanFileName, isUuid, materialStoragePath, MAX_CAPTION_LENGTH, type AttachmentKind } from "../lessons/attachments.ts";

/**
 * Escritura de adjuntos y materiales de una clase. Siempre por la cuenta de la sesión: la ruta del archivo la arma el SERVIDOR bajo `<id de la cuenta>/…` (el navegador nunca elige una ruta ni una
 * cuenta), la subida usa una URL firmada de UN solo objeto y la base verifica que el archivo exista y coincida antes de registrarlo (funciones de la migración 20261022100000). Nunca borra nada.
 */
export class LessonFileInputError extends Error {}

export interface PreparedUpload {
  /** URL firmada de subida de un único objeto (vale 2 horas). */
  signedUrl: string;
  /** Ruta del objeto dentro del bucket (la misma que después se registra). */
  path: string;
  kind: AttachmentKind;
  mimeType: string;
}

async function assertRegistrationOwned(ctx: AuthenticatedDbContext, registrationId: string): Promise<void> {
  const { data, error } = await ctx.supabase.from("lesson_registrations").select("id").eq("owner_id", ctx.ownerId).eq("id", registrationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new LessonFileInputError("No encontramos ese registro.");
}

async function signUpload(ctx: AuthenticatedDbContext, path: string): Promise<string> {
  const { data, error } = await ctx.supabase.storage.from(LESSON_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("No se pudo preparar la subida.");
  return data.signedUrl;
}

export async function prepareAttachmentUpload(ctx: AuthenticatedDbContext, input: { registrationId: string; attachmentId: string; name: string; type: string; size: number }): Promise<PreparedUpload> {
  if (!isUuid(input.registrationId) || !isUuid(input.attachmentId)) throw new LessonFileInputError("Adjunto inválido.");
  const check = checkPickedFile({ name: input.name, type: input.type, size: input.size });
  if (!check.ok) throw new LessonFileInputError(check.message);
  await assertRegistrationOwned(ctx, input.registrationId);
  const path = attachmentStoragePath(ctx.ownerId, input.registrationId, input.attachmentId, check.mimeType);
  return { signedUrl: await signUpload(ctx, path), path, kind: check.kind, mimeType: check.mimeType };
}

export async function prepareMaterialUpload(ctx: AuthenticatedDbContext, input: { materialId: string; name: string; type: string; size: number }): Promise<PreparedUpload> {
  if (!isUuid(input.materialId)) throw new LessonFileInputError("Material inválido.");
  const check = checkPickedFile({ name: input.name, type: input.type, size: input.size }, "pdf");
  if (!check.ok) throw new LessonFileInputError(check.message);
  const path = materialStoragePath(ctx.ownerId, input.materialId);
  return { signedUrl: await signUpload(ctx, path), path, kind: check.kind, mimeType: check.mimeType };
}

export interface RegisterAttachmentInput {
  registrationId: string;
  attachmentId: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  path: string;
  caption: string | null;
  /** Clases grupales: el alumno al que pertenece el archivo. Ausente / `null` = común a toda la clase. La base verifica que sea participante de ESTE registro. */
  studentId?: string | null;
}

export async function registerAttachment(ctx: AuthenticatedDbContext, input: RegisterAttachmentInput): Promise<{ id: string; deduplicated: boolean }> {
  if (!isUuid(input.registrationId) || !isUuid(input.attachmentId)) throw new LessonFileInputError("Adjunto inválido.");
  const studentId = input.studentId ?? null;
  if (studentId !== null && !isUuid(studentId)) throw new LessonFileInputError("Participante inválido.");
  const { data, error } = await ctx.supabase.rpc("add_lesson_attachment", {
    p_registration_id: input.registrationId,
    p_attachment: { id: input.attachmentId, name: cleanFileName(input.name), kind: input.kind, mime_type: input.mimeType, size_bytes: input.size, caption: input.caption, storage_path: input.path, student_id: studentId },
  });
  if (error) throw error;
  const result = data as { id: string; deduplicated: boolean };
  return { id: result.id, deduplicated: result.deduplicated === true };
}

export async function setAttachmentCaption(ctx: AuthenticatedDbContext, attachmentId: string, caption: string): Promise<void> {
  if (!isUuid(attachmentId)) throw new LessonFileInputError("Adjunto inválido.");
  if (caption.length > MAX_CAPTION_LENGTH) throw new LessonFileInputError("La descripción es demasiado larga.");
  const { error } = await ctx.supabase.rpc("set_lesson_attachment_caption", { p_attachment_id: attachmentId, p_caption: caption });
  if (error) throw error;
}

/** «Quitar» un adjunto lo oculta de la clase; la fila y el archivo se conservan. */
export async function removeAttachment(ctx: AuthenticatedDbContext, attachmentId: string): Promise<void> {
  if (!isUuid(attachmentId)) throw new LessonFileInputError("Adjunto inválido.");
  const { error } = await ctx.supabase.rpc("remove_lesson_attachment", { p_attachment_id: attachmentId });
  if (error) throw error;
}

export interface AddMaterialInput {
  materialId: string;
  name: string;
  note: string | null;
  attachment: { name: string; mimeType: string; size: number; path: string } | null;
}

export async function addMaterial(ctx: AuthenticatedDbContext, input: AddMaterialInput): Promise<{ id: string; legacyId: string }> {
  if (!isUuid(input.materialId)) throw new LessonFileInputError("Material inválido.");
  const { data, error } = await ctx.supabase.rpc("add_material_library_item", {
    p_item: {
      id: input.materialId,
      name: input.name,
      note: input.note,
      attachment: input.attachment ? { name: cleanFileName(input.attachment.name), mime_type: input.attachment.mimeType, size_bytes: input.attachment.size, storage_path: input.attachment.path } : null,
    },
  });
  if (error) throw error;
  const result = data as { id: string; legacy_id: string };
  return { id: result.id, legacyId: result.legacy_id };
}
