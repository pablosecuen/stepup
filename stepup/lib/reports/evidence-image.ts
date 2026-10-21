import { decodeHeic } from "../images/heic-decode.ts";
import { planPhotoPreview } from "../images/photo-preview.ts";

/**
 * Foto de una evidencia → JPEG reducido para el PDF del reporte: se endereza, se reduce a 900 px de ancho (la miniatura del reporte no necesita la foto original) y las fotos HEIC se convierten acá.
 * Decide por los bytes reales (nunca por el nombre). Lanza si no es una foto que se pueda leer. No modifica ningún archivo.
 */
const MAX_WIDTH = 900;
const JPEG_QUALITY = 78;

export async function toReportJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const plan = planPhotoPreview(bytes);
  if (plan.mode === "heic") {
    const photo = await decodeHeic(bytes);
    return new Uint8Array(await sharp(Buffer.from(photo.rgba.buffer, photo.rgba.byteOffset, photo.rgba.byteLength), { raw: { width: photo.width, height: photo.height, channels: 4 } }).resize({ width: MAX_WIDTH, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY }).toBuffer());
  }
  if (plan.mode !== "native") throw new Error("not_an_image");
  return new Uint8Array(await sharp(bytes).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY }).toBuffer());
}

