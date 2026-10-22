import { decodeHeic } from "../images/heic-decode.ts";
import { planPhotoPreview } from "../images/photo-preview.ts";

/**
 * Foto de una evidencia → JPEG reducido: se endereza, se reduce de ancho (el reporte y las miniaturas no necesitan la foto original) y las fotos HEIC se convierten acá.
 * Decide por los bytes reales (nunca por el nombre). Lanza si no es una foto que se pueda leer. No modifica ningún archivo.
 */
const MAX_WIDTH = 900;
const JPEG_QUALITY = 78;
/** Miniatura de la lista de evidencias (cuadrada, recortada al centro). */
export const THUMBNAIL_SIZE_PX = 160;
const THUMBNAIL_QUALITY = 70;

async function toJpeg(bytes: Uint8Array, shape: (image: import("sharp").Sharp) => import("sharp").Sharp, quality: number): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const plan = planPhotoPreview(bytes);
  if (plan.mode === "heic") {
    const photo = await decodeHeic(bytes);
    const raw = sharp(Buffer.from(photo.rgba.buffer, photo.rgba.byteOffset, photo.rgba.byteLength), { raw: { width: photo.width, height: photo.height, channels: 4 } });
    return new Uint8Array(await shape(raw).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer());
  }
  if (plan.mode !== "native") throw new Error("not_an_image");
  return new Uint8Array(await shape(sharp(bytes).rotate()).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer());
}

export function toReportJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  return toJpeg(bytes, (image) => image.resize({ width: MAX_WIDTH, withoutEnlargement: true }), JPEG_QUALITY);
}

export function toThumbnailJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  return toJpeg(bytes, (image) => image.resize({ width: THUMBNAIL_SIZE_PX, height: THUMBNAIL_SIZE_PX, fit: "cover", position: "centre" }), THUMBNAIL_QUALITY);
}
