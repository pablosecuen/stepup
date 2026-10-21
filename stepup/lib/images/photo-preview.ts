import { sniffKind } from "../phone-extraction/sniff.ts";

/**
 * Lógica PURA de la vista previa de fotos: decide, por los bytes reales del archivo (nunca por su nombre ni por lo que declaró la app), cómo mostrarlo.
 * El archivo original no se modifica: la vista previa HEIC es sólo una conversión temporal en el navegador de quien mira.
 */

/** Tope de lo que se intenta mostrar (el bucket admite hasta 20 MiB por archivo). */
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
/** Tope de píxeles de una foto HEIC a decodificar (≈ 100 megapíxeles): evita agotar la memoria con un archivo hostil. */
export const MAX_HEIC_PIXELS = 100_000_000;

export type PhotoPlan =
  | { mode: "native"; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { mode: "heic" }
  | { mode: "unsupported"; reason: "empty" | "too_large" | "not_an_image" };

export function planPhotoPreview(bytes: Uint8Array): PhotoPlan {
  if (bytes.length === 0) return { mode: "unsupported", reason: "empty" };
  if (bytes.length > MAX_PREVIEW_BYTES) return { mode: "unsupported", reason: "too_large" };
  const kind = sniffKind(bytes);
  if (kind === "jpeg") return { mode: "native", mime: "image/jpeg" };
  if (kind === "png") return { mode: "native", mime: "image/png" };
  if (kind === "webp") return { mode: "native", mime: "image/webp" };
  if (kind === "heic") return { mode: "heic" };
  return { mode: "unsupported", reason: "not_an_image" };
}

export const PHOTO_MESSAGES = {
  loading: "Cargando la foto…",
  preparing: "Preparando la foto para mostrarla…",
  fetchFailed: "No pudimos traer la foto. Probá de nuevo o descargá el original.",
  cannotShow: "No pudimos mostrar esta foto en el navegador. El archivo original está guardado: podés descargarlo.",
  empty: "El archivo está vacío. El original sigue guardado: podés descargarlo.",
  tooLarge: "La foto es demasiado grande para mostrarla acá. Podés descargar el original.",
} as const;

export function messageForUnsupported(reason: "empty" | "too_large" | "not_an_image"): string {
  if (reason === "empty") return PHOTO_MESSAGES.empty;
  if (reason === "too_large") return PHOTO_MESSAGES.tooLarge;
  return PHOTO_MESSAGES.cannotShow;
}
