/**
 * Compartir el PDF de un reporte desde el navegador (puerto de `reportSharing.ts` del original, que abre SIEMPRE el selector del sistema y deja que la profesora elija el medio y el contacto).
 *
 * - Nunca se envía solo, ni a un contacto elegido por el programa, ni se sube a un servidor intermedio: el PDF se descarga con un enlace firmado de corta vida y se entrega al selector del sistema
 *   (`navigator.share({ files })`). No se publica ninguna URL duradera.
 * - Nunca se afirma que el envío se completó: el selector se abrió y la profesora eligió (o canceló).
 * - Si el navegador no puede compartir archivos, el resultado lo dice para que la pantalla ofrezca la alternativa (descargar, copiar el mensaje, abrir WhatsApp Web).
 */

export const REPORT_SHARE_PRIVACY_NOTICE = "Revisá el contenido antes de compartirlo. El reporte puede contener información educativa e imágenes seleccionadas.";
export const REPORT_SHARE_UNSUPPORTED_MESSAGE = "Este navegador no permite compartir el archivo directamente. Descargalo y adjuntalo donde quieras enviarlo.";
export const REPORT_SHARE_FETCH_FAILED_MESSAGE = "No se pudo preparar el archivo para compartir. Intentá de nuevo o descargalo.";
export const REPORT_SHARE_FAILED_MESSAGE = "No se pudo compartir el reporte. Intentá nuevamente.";

export type ShareReportOutcome = { status: "shared" } | { status: "cancelled" } | { status: "unsupported"; message: string } | { status: "fetch_failed"; message: string } | { status: "error"; message: string };

export interface ShareCapableNavigator {
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

/** `true` si el navegador puede abrir el selector del sistema con un archivo PDF (se prueba con un archivo vacío del mismo tipo; no descarga nada). */
export function canShareReportFiles(nav: ShareCapableNavigator | undefined, makeFile: (name: string, type: string) => File): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [makeFile("reporte.pdf", "application/pdf")] }) === true;
  } catch {
    return false;
  }
}

export function reportPdfFileName(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "reporte"}.pdf`;
}

/** Mensaje sugerido para acompañar el archivo. Es una alternativa de la web: el original no tiene un texto sugerido. No incluye datos del contenido del reporte, sólo su título y período. */
export function buildReportShareMessage(input: { studentName: string; title: string; periodLabel: string }): string {
  const firstName = input.studentName.trim().split(/\s+/)[0] ?? "";
  const who = firstName ? ` de ${firstName}` : "";
  return `Hola, te comparto el reporte${who}: ${input.title} (${input.periodLabel}).`;
}

export async function shareReportPdf(input: {
  nav: ShareCapableNavigator | undefined;
  fetchPdf: () => Promise<Blob>;
  makeFile: (blob: Blob, name: string, type: string) => File;
  fileName: string;
  title: string;
  text: string;
}): Promise<ShareReportOutcome> {
  const nav = input.nav;
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return { status: "unsupported", message: REPORT_SHARE_UNSUPPORTED_MESSAGE };
  let blob: Blob;
  try {
    blob = await input.fetchPdf();
  } catch {
    return { status: "fetch_failed", message: REPORT_SHARE_FETCH_FAILED_MESSAGE };
  }
  const file = input.makeFile(blob, input.fileName, "application/pdf");
  let allowed = false;
  try {
    allowed = nav.canShare({ files: [file] }) === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return { status: "unsupported", message: REPORT_SHARE_UNSUPPORTED_MESSAGE };
  try {
    await nav.share({ files: [file], title: input.title, text: input.text });
    return { status: "shared" };
  } catch (error) {
    // Cerrar el selector sin elegir nada no es un error.
    if (error instanceof Error && error.name === "AbortError") return { status: "cancelled" };
    return { status: "error", message: REPORT_SHARE_FAILED_MESSAGE };
  }
}
