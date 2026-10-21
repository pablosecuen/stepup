// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.
/**
 * Formato REAL de un archivo por sus primeros bytes (no por su nombre ni por lo que declaró la app). Puro y sin dependencias: se copia tal cual al teléfono.
 *
 * Por qué importa: la app guarda las fotos elegidas de la galería con `quality: 0.9` (el selector las transcodifica a JPEG) pero conserva el nombre original
 * («.HEIC») y el tipo declarado (`image/heic`); el archivo se guarda como `<id>.jpg`. Subirlo como `image/heic` / `.heic` sería mentirle al navegador. La extracción
 * sube cada copia con su formato real y conserva, además, lo que la app declaraba.
 */

export type SniffedKind = "jpeg" | "png" | "webp" | "heic" | "pdf" | "unknown";

export const MIME_BY_KIND: Record<Exclude<SniffedKind, "unknown">, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"]);

const ascii = (bytes: Uint8Array, from: number, to: number): string => {
  let out = "";
  for (let i = from; i < to && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "png";
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "pdf";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return "heic";
  return "unknown";
}

/** Tipo declarado normalizado (heif → heic) para compararlo con el real. */
export function normalizeMime(mime: string): string {
  return mime === "image/heif" ? "image/heic" : mime;
}
