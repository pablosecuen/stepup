import { IMAGE_MAX_BYTES } from "../lessons/attachments.ts";
import { assertLooksLikePhoto, UNREADABLE_HEIC_MESSAGE, UnreadablePhotoError } from "./photo-validity.ts";

/**
 * Foto elegida o tomada en el navegador → lo que se sube. Igual que la app anterior (que re-comprimía la foto a JPEG con calidad 0,9 al elegirla), una foto HEIC (la de las cámaras de iPhone) o una que pasa
 * del tope de 10 MB (cámaras de muchos megapíxeles) se convierte a JPEG ANTES de subir cuando el navegador sabe leerla; si no sabe (p. ej. HEIC fuera de Safari) se sube tal cual y el servidor
 * la convierte al mirarla o al armar un reporte. Si el navegador no puede reducirla devuelve la original; lo que no es una foto, o un HEIC que no se puede leer, se rechaza con un error claro (`UnreadablePhotoError`). No toca la foto del carrete. Las decisiones puras se prueban sin navegador.
 */
const JPEG_STEPS: { quality: number; maxEdgePx: number }[] = [
  { quality: 0.9, maxEdgePx: 4096 },
  { quality: 0.8, maxEdgePx: 3000 },
  { quality: 0.7, maxEdgePx: 2200 },
];

export interface PickedImage {
  name: string;
  type: string;
  size: number;
}

function isHeic(file: PickedImage): boolean {
  const type = file.type.toLowerCase();
  return type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/i.test(file.name);
}

/** ¿Conviene convertirla a JPEG antes de subir? HEIC siempre; el resto sólo si pasa del tope. */
export function needsClientConversion(file: PickedImage): boolean {
  return isHeic(file) || file.size > IMAGE_MAX_BYTES;
}

/** Nombre del archivo convertido: el mismo nombre con extensión .jpg. */
export function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base === "" ? "foto" : base}.jpg`;
}

type Drawable = CanvasImageSource & { width: number; height: number };

async function encode(bitmap: Drawable, step: { quality: number; maxEdgePx: number }): Promise<Blob | null> {
  const scale = Math.min(1, step.maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", step.quality));
}

async function toJpegFile(source: Drawable, file: File): Promise<File | null> {
  for (const step of JPEG_STEPS) {
    const blob = await encode(source, step);
    if (blob && blob.size > 0 && blob.size <= IMAGE_MAX_BYTES) return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  }
  return null;
}

/** HEIC que el navegador no sabe leer (todos menos Safari): se decodifica con el mismo decodificador que usa el visor (se descarga sólo en este momento). */
async function heicToJpeg(file: File): Promise<File | null> {
  const { decodeHeic, HeicDecodeError } = await import("./heic-decode");
  let photo: Awaited<ReturnType<typeof decodeHeic>>;
  try {
    photo = await decodeHeic(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // Un HEIC que el decodificador no puede leer tampoco se podría abrir, mostrar en miniatura ni incluir en un reporte: no se sube.
    throw error instanceof HeicDecodeError ? new UnreadablePhotoError(UNREADABLE_HEIC_MESSAGE) : error;
  }
  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(photo.rgba), photo.width, photo.height), 0, 0);
  return toJpegFile(canvas, file);
}

/**
 * La foto lista para subir: convertida a JPEG si hace falta y se puede; si no, la original. Lanza `UnreadablePhotoError` (con un texto para la persona) si el archivo no tiene forma de foto o es un HEIC
 * que ni el navegador ni el decodificador propio pueden leer: nada de eso se guarda como foto.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  assertLooksLikePhoto(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  if (!needsClientConversion(file)) return file;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const converted = await toJpegFile(bitmap, file);
        if (converted) return converted;
      } finally {
        bitmap.close();
      }
    } catch {
      // El navegador no sabe leer esta foto: si es HEIC se prueba con el decodificador propio; si no, se sube la original.
    }
  }
  if (isHeic(file)) {
    const converted = await heicToJpeg(file);
    if (converted) return converted;
    // Se pudo leer pero no reducir por debajo del tope: se devuelve la original y la revisión de tamaño explica el problema.
  }
  return file;
}
