import { planPhotoPreview } from "./photo-preview.ts";

/**
 * Una foto que no se puede leer no debe quedar guardada como foto utilizable: después no abriría, no tendría miniatura y no entraría en el reporte. Estas reglas se usan ANTES de subir (navegador) y al
 * registrar (servidor). PURO: decide por los bytes reales, nunca por el nombre ni por el tipo declarado.
 */
export class UnreadablePhotoError extends Error {}

export const UNREADABLE_PHOTO_MESSAGE = "No pudimos leer esta foto, así que no se guardó. Probá con otra o guardala como JPG desde el teléfono.";
export const UNREADABLE_HEIC_MESSAGE = "No pudimos leer esta foto HEIC, así que no se guardó. Probá exportarla como JPG desde el teléfono o elegí otra.";
export const NOT_A_PHOTO_MESSAGE = "El archivo no es una foto válida (JPG, PNG, WebP o HEIC), así que no se guardó.";

/** Revisión rápida por los primeros bytes: ¿tiene forma de foto JPG, PNG, WebP o HEIC? Lanza `UnreadablePhotoError` si no. */
export function assertLooksLikePhoto(head: Uint8Array): "native" | "heic" {
  const plan = planPhotoPreview(head);
  if (plan.mode === "native" || plan.mode === "heic") return plan.mode;
  throw new UnreadablePhotoError(plan.reason === "empty" ? "El archivo está vacío." : NOT_A_PHOTO_MESSAGE);
}
