/**
 * A quién pertenece un adjunto de una clase. `studentId === null` = común a toda la clase (sale en el reporte de todos los participantes); con un alumno, es SÓLO de ese alumno (clases grupales).
 * PURO: la misma regla decide qué evidencias se ofrecen en el reporte de un alumno y cuáles nunca pueden salir en él.
 */
export function attachmentBelongsToStudent(attachmentStudentId: string | null, reportStudentId: string): boolean {
  return attachmentStudentId === null || attachmentStudentId === reportStudentId;
}
