/**
 * Cabeceras de la ruta que entrega un adjunto de clase al navegador (mismo origen). PURO. Nunca confía en el tipo guardado: sólo una lista cerrada de
 * tipos; lo demás se entrega como binario (y `nosniff` lo pone la configuración global), así que un archivo no se interpreta nunca como página.
 */

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

export function safeContentType(mime: string | null | undefined): string {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return ALLOWED_MIME.has(base) ? base : "application/octet-stream";
}

/** Nombre apto para una cabecera: sin rutas, sin caracteres de control, sin comillas, con un largo razonable. */
export function safeDownloadName(name: string | null | undefined, fallback = "archivo"): string {
  const cleaned = (name ?? "")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f-\u009f"]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned === "" ? fallback : cleaned;
}

export function contentDisposition(name: string | null | undefined, download: boolean): string {
  const safe = safeDownloadName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function lessonFileHeaders({ mime, name, size, download }: { mime: string | null | undefined; name: string | null | undefined; size: number; download: boolean }): Record<string, string> {
  return {
    "Content-Type": safeContentType(mime),
    "Content-Length": String(size),
    "Content-Disposition": contentDisposition(name, download),
    // Datos privados de la profesora: nunca en cachés compartidas.
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
