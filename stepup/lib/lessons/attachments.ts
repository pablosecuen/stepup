import { formatDecimal } from "../format/number-format.ts";

/**
 * Adjuntos (PDF / fotos) y materiales de una clase: reglas PURAS compartidas entre el navegador (antes de subir), el servidor (antes de firmar la subida) y las pruebas. Mismos topes que la app
 * anterior (PDF hasta 20 MB, foto hasta 10 MB) y los mismos tipos que acepta el bucket privado `lesson-files`.
 */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Tope de lo que se intenta reducir en el navegador antes de subir una foto (cámaras de muchos megapíxeles): más que eso se rechaza sin intentarlo. */
export const IMAGE_PICK_MAX_BYTES = 80 * 1024 * 1024;
export const MAX_NAME_LENGTH = 200;
export const MAX_CAPTION_LENGTH = 500;

export type AttachmentKind = "pdf" | "image";

const IMAGE_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const EXTENSION_BY_MIME: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

export interface PickedFile {
  name: string;
  /** Tipo que informa el navegador; puede venir vacío (p. ej. HEIC en algunos navegadores). */
  type: string;
  size: number;
}

export type FileCheck = { ok: true; kind: AttachmentKind; mimeType: string } | { ok: false; message: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function megabytes(bytes: number): string {
  return formatDecimal(bytes / (1024 * 1024));
}

/**
 * Decide qué es el archivo y si se puede adjuntar. `expect` limita el tipo (un material sólo admite PDF; «Adjuntar PDF» sólo PDF; «Elegir foto» sólo fotos).
 * El tipo se toma del contenido declarado y, si el navegador no lo informa, de la extensión.
 */
export function checkPickedFile(file: PickedFile, expect: AttachmentKind | "any" = "any"): FileCheck {
  const extension = extensionOf(file.name);
  const declared = file.type.toLowerCase();
  const mimeType = declared !== "" && declared in EXTENSION_BY_MIME ? declared : extension === "pdf" ? "application/pdf" : (IMAGE_BY_EXTENSION[extension] ?? declared);
  const kind: AttachmentKind | null = mimeType === "application/pdf" ? "pdf" : mimeType in EXTENSION_BY_MIME ? "image" : null;
  if (kind === null) return { ok: false, message: expect === "pdf" ? "El archivo tiene que ser un PDF." : expect === "image" ? "La foto tiene que ser JPG, PNG, WebP o HEIC." : "Sólo se pueden adjuntar PDF o fotos (JPG, PNG, WebP o HEIC)." };
  if (expect !== "any" && kind !== expect) return { ok: false, message: expect === "pdf" ? "El archivo tiene que ser un PDF." : "La foto tiene que ser JPG, PNG, WebP o HEIC." };
  if (file.size <= 0) return { ok: false, message: "El archivo está vacío." };
  const max = kind === "pdf" ? PDF_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > max) return { ok: false, message: `${kind === "pdf" ? "El PDF" : "La foto"} pesa ${megabytes(file.size)} MB. El máximo permitido es ${max / (1024 * 1024)} MB.` };
  return { ok: true, kind, mimeType };
}

/** Nombre para mostrar: sin carpetas ni espacios sobrantes y con un tope de largo. */
export function cleanFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const trimmed = base.trim();
  return (trimmed === "" ? "archivo" : trimmed).slice(0, MAX_NAME_LENGTH);
}

export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

/** Ruta del archivo de un adjunto dentro del bucket: SIEMPRE bajo la carpeta de la cuenta, y única por adjunto (el identificador lo genera el navegador una sola vez). */
export function attachmentStoragePath(ownerId: string, registrationId: string, attachmentId: string, mimeType: string): string {
  return `${ownerId}/web/${registrationId}/${attachmentId}.${extensionForMime(mimeType)}`;
}

export function materialStoragePath(ownerId: string, materialId: string): string {
  return `${ownerId}/web-materials/${materialId}.pdf`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
