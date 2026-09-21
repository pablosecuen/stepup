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
