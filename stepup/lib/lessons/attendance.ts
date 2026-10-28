export type AttendanceStatus = "presente" | "ausente" | "tarde" | "ausente_aviso" | "sin_registrar";

/**
 * Puerto exacto de `hasResolvedAttendanceStatus` (móvil). `undefined` y
 * `'sin_registrar'` (legado — ya no es un botón elegible, sólo puede
 * persistir en registros viejos) NUNCA cuentan como resueltos.
 */
export function hasResolvedAttendanceStatus(status: AttendanceStatus | null | undefined): boolean {
  return status === "presente" || status === "ausente" || status === "tarde" || status === "ausente_aviso";
}

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  presente: "Presente",
  ausente: "Ausente",
  tarde: "Tarde",
  ausente_aviso: "Ausente con aviso",
  sin_registrar: "Sin registrar",
};

export type BulkAttendanceMode = "present" | "clear";

/**
 * «Marcar todos presentes» / «Limpiar asistencia» de una clase grupal (equivalente al botón del registro de la app original). Se aplican a todos los participantes que todavía NO se
 * completaron u omitieron: la asistencia de un alumno ya guardado como completo no se toca en silencio (para cambiarla se reabre ese alumno). Limpiar deja la asistencia sin elegir y
 * borra los minutos de demora. `needsConfirmation` es verdadero cuando ya había asistencia cargada que se va a reemplazar o borrar (se pide confirmar antes).
 */
export function planBulkAttendance(
  participants: ReadonlyArray<{ studentId: string }>,
  attendanceByStudentId: Readonly<Record<string, AttendanceStatus | null | undefined>>,
  statusByStudentId: Readonly<Record<string, string | undefined>>,
  mode: BulkAttendanceMode
): { studentIds: string[]; patch: { attendanceStatus: AttendanceStatus | null; lateMinutes: string }; needsConfirmation: boolean; skippedCompleted: number } {
  const editable = participants.filter((p) => statusByStudentId[p.studentId] !== "completed" && statusByStudentId[p.studentId] !== "omitted");
  const target = mode === "present" ? "presente" : null;
  const needsConfirmation = editable.some((p) => {
    const current = attendanceByStudentId[p.studentId] ?? null;
    return hasResolvedAttendanceStatus(current) && current !== target;
  });
  return {
    studentIds: editable.map((p) => p.studentId),
    patch: { attendanceStatus: target, lateMinutes: "" },
    needsConfirmation,
    skippedCompleted: participants.length - editable.length,
  };
}
