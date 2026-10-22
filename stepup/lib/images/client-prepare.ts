import { IMAGE_MAX_BYTES } from "../lessons/attachments.ts";

/**
 * Foto elegida o tomada en el navegador → lo que se sube. Igual que la app anterior (que re-comprimía la foto a JPEG con calidad 0,9 al elegirla), una foto HEIC (la de las cámaras de iPhone) o una que pasa
 * del tope de 10 MB (cámaras de muchos megapíxeles) se convierte a JPEG ANTES de subir cuando el navegador sabe leerla; si no sabe (p. ej. HEIC fuera de Safari) se sube tal cual y el servidor
 * la convierte al mirarla o al armar un reporte. Nunca falla por esto: ante cualquier problema devuelve el archivo original. No toca la foto del carrete. Las decisiones puras se prueban sin navegador.
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

async function encode(bitmap: ImageBitmap, step: { quality: number; maxEdgePx: number }): Promise<Blob | null> {
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

/** La foto lista para subir: convertida a JPEG si hace falta y se puede; si no, la original. */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!needsClientConversion(file) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      for (const step of JPEG_STEPS) {
        const blob = await encode(bitmap, step);
        if (blob && blob.size > 0 && blob.size <= IMAGE_MAX_BYTES) return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // El navegador no sabe leer esta foto: se sube la original.
  }
  return file;
}
