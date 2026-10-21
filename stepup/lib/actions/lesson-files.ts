"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getSignedLessonFileUrl, LessonFileNotAvailableError, LessonFileNotFoundError } from "@/lib/repositories/lesson-content";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { addMaterial, prepareAttachmentUpload, prepareMaterialUpload, registerAttachment, removeAttachment, setAttachmentCaption, type PreparedUpload } from "@/lib/repositories/lesson-files-write";
import type { AttachmentKind } from "@/lib/lessons/attachments";
import type { ActionResult } from "./lesson-registrations";

// Server Action — abrir un adjunto o un material de una clase. Nunca confía en una ruta ni en un identificador de cuenta que mande el cliente: sólo recibe el
// identificador del adjunto/material, y el repositorio verifica que sea de la cuenta de la sesión, que esté disponible y que su ruta cuelgue de esa cuenta.
// La URL es firmada y temporal (5 minutos), nunca una dirección pública permanente.
export async function openLessonFileAction(kind: "attachment" | "material", id: string): Promise<ActionResult<{ url: string }>> {
  try {
    if ((kind !== "attachment" && kind !== "material") || typeof id !== "string" || id.length === 0 || id.length > 64) return { error: "No encontramos ese archivo." };
    const ctx = await requireAuthenticatedDbContext();
    const url = await getSignedLessonFileUrl(ctx, kind, id);
    return { data: { url } };
  } catch (error) {
    if (error instanceof LessonFileNotFoundError) return { error: "No encontramos ese archivo." };
    if (error instanceof LessonFileNotAvailableError) return { error: "Este archivo todavía no está disponible." };
    return { error: actionErrorMessage("lesson-files", error) };
  }
}

// ── Adjuntos y materiales de una clase (escritura) ────────────────────────────────────────────────────────────────────────────────────────────────
// Ninguna acción recibe una ruta ni una cuenta del navegador: la cuenta sale de la sesión y la ruta del archivo la arma el servidor. El archivo se sube con una URL firmada de UN solo objeto y
// recién después se registra (la base verifica que exista, que sea de la cuenta y que el tamaño coincida). Nada se borra nunca: «quitar» sólo oculta.

// `LessonFileInputError` es un error de dominio (texto escrito para la persona): `actionErrorMessage` lo muestra tal cual si es seguro y reduce todo lo demás a un texto genérico.
function fileError(error: unknown): { error: string } {
  return { error: actionErrorMessage("lesson-files", error) };
}

export async function prepareAttachmentUploadAction(input: { registrationId: string; attachmentId: string; name: string; type: string; size: number }): Promise<ActionResult<PreparedUpload>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    return { data: await prepareAttachmentUpload(ctx, input) };
  } catch (error) {
    return fileError(error);
  }
}

export async function registerAttachmentAction(input: { registrationId: string; attachmentId: string; name: string; kind: AttachmentKind; mimeType: string; size: number; path: string; caption: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const result = await registerAttachment(ctx, input);
    return { data: { id: result.id } };
  } catch (error) {
    return fileError(error);
  }
}

export async function setAttachmentCaptionAction(attachmentId: string, caption: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await setAttachmentCaption(ctx, attachmentId, caption);
    return {};
  } catch (error) {
    return fileError(error);
  }
}

export async function removeAttachmentAction(attachmentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await removeAttachment(ctx, attachmentId);
    return {};
  } catch (error) {
    return fileError(error);
  }
}

export async function prepareMaterialUploadAction(input: { materialId: string; name: string; type: string; size: number }): Promise<ActionResult<PreparedUpload>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    return { data: await prepareMaterialUpload(ctx, input) };
  } catch (error) {
    return fileError(error);
  }
}

export async function addMaterialAction(input: { materialId: string; name: string; note: string | null; attachment: { name: string; mimeType: string; size: number; path: string } | null }): Promise<ActionResult<{ id: string; legacyId: string }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    return { data: await addMaterial(ctx, input) };
  } catch (error) {
    return fileError(error);
  }
}
