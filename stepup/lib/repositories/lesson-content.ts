import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable } from "../db/read.ts";
import { toLessonContent, toMaterialLibrary, type LessonAttachmentRow, type LessonContent, type LessonContentRegistrationRow, type LibraryMaterial, type LibraryMaterialRow, type MaterialRow } from "./lesson-content-mapping.ts";

/** Bucket privado de los adjuntos y materiales trasladados (ver la migración R10). Los objetos viven en `<owner>/attachments|materials/<huella>.<ext>`. */
export const LESSON_FILES_BUCKET = "lesson-files";

export class LessonFileNotFoundError extends Error {}
export class LessonFileNotAvailableError extends Error {}

const CONTENT_COLUMNS = "id, topics, objectives, activities, activity_notes, internal_notes, material_ids, is_billable, consumes_monthly_package";

/**
 * Contenido propio de la clase registrada (temas, objetivos, actividades, notas, materiales y adjuntos). `null` si la clase no tiene nada de eso.
 * Siempre filtra por la cuenta de la sesión (además de RLS); nunca usa un identificador de cuenta que mande el cliente.
 */
export async function getLessonContent(ctx: AuthenticatedDbContext, registrationId: string): Promise<LessonContent | null> {
  const { data, error } = await ctx.supabase.from("lesson_registrations").select(CONTENT_COLUMNS).eq("owner_id", ctx.ownerId).eq("id", registrationId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as LessonContentRegistrationRow;

  const attachments = await readTable<LessonAttachmentRow>(ctx.supabase, "lesson_attachments", {
    columns: "id, name, kind, caption, student_id, size_bytes, file_status, added_at",
    filter: (q) => q.eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId).is("removed_at", null),
  });
  const materialIds = Array.isArray(row.material_ids) ? (row.material_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const materials =
    materialIds.length === 0
      ? []
      : await readTable<MaterialRow>(ctx.supabase, "material_library_items", {
          columns: "id, legacy_mobile_id, name, note, attachment_name, attachment_kind, file_status",
          filter: (q) => q.eq("owner_id", ctx.ownerId).in("legacy_mobile_id", materialIds),
        });
  return toLessonContent(row, attachments, materials);
}

/** Biblioteca de materiales de la cuenta (para elegir y agregar materiales en el registro de una clase). */
export async function listMaterialLibrary(ctx: AuthenticatedDbContext): Promise<LibraryMaterial[]> {
  const rows = await readTable<LibraryMaterialRow>(ctx.supabase, "material_library_items", {
    columns: "id, legacy_mobile_id, name, note, attachment_name, attachment_kind, file_status, created_at",
    filter: (q) => q.eq("owner_id", ctx.ownerId),
  });
  return toMaterialLibrary(rows);
}

/** URL firmada y temporal de un adjunto o material. Verifica que el archivo sea de la cuenta de la sesión y esté disponible antes de firmar. */
export async function getSignedLessonFileUrl(ctx: AuthenticatedDbContext, kind: "attachment" | "material", id: string, expiresInSeconds = 300): Promise<string> {
  const table = kind === "attachment" ? "lesson_attachments" : "material_library_items";
  const { data, error } = await ctx.supabase.from(table).select("storage_path, file_status").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data as { storage_path: string | null; file_status: string } | null;
  if (!row) throw new LessonFileNotFoundError("No encontramos ese archivo.");
  if (row.file_status !== "disponible" || !row.storage_path) throw new LessonFileNotAvailableError("Este archivo todavía no está disponible.");
  if (!row.storage_path.startsWith(`${ctx.ownerId}/`)) throw new LessonFileNotFoundError("No encontramos ese archivo.");
  const { data: signed, error: signError } = await ctx.supabase.storage.from(LESSON_FILES_BUCKET).createSignedUrl(row.storage_path, expiresInSeconds);
  if (signError) throw signError;
  return signed.signedUrl;
}
