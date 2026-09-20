import type { StudentStatus } from "@/lib/db/database.types";
import { STUDENT_STATUS_LABEL } from "@/lib/students/constants";

// Mismo criterio que StatusPill: un estado importante nunca se comunica
// sólo por color — siempre va acompañado de texto.
const STATUS_STYLES: Record<StudentStatus, string> = {
  activo: "bg-statusVerde/10 text-statusVerde",
  pausado: "bg-statusAmarillo/10 text-statusAmarillo",
  inactivo: "bg-statusSinDatos/10 text-textSecondary",
  archivado: "bg-textMuted/10 text-textMuted",
};

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return (
    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold tracking-tight ${STATUS_STYLES[status]}`}>
      {STUDENT_STATUS_LABEL[status]}
    </span>
  );
}
