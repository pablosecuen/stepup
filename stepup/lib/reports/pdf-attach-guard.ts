/**
 * Lógica PURA de la única pregunta de seguridad real antes de borrar un
 * objeto de Storage recién subido cuando el UPDATE posterior de la fila
 * falla: ¿la fila vigente (releída después del fallo) quedó apuntando
 * exactamente a ese mismo path? Si sí, algún OTRO request concurrente ya
 * completó su propio UPDATE exitoso usando este mismo objeto — jamás hay
 * que borrarlo, aunque este request en particular haya fallado. Nunca se
 * decide esto interpretando el texto de un error de Storage.
 */
export function shouldCleanupUnreferencedPdf(uploadedPath: string, currentRecordPdfPath: string | null): boolean {
  return currentRecordPdfPath !== uploadedPath;
}
