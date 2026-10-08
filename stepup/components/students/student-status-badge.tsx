import type { StudentStatus } from "@/lib/db/database.types";
import { STUDENT_STATUS_LABEL } from "@/lib/students/constants";
import { Badge, type BadgeTone } from "@/components/ui/badge";

// Mismo criterio que el resto de la app: un estado importante nunca se comunica sólo por color — siempre va con punto y texto.
const STATUS_TONE: Record<StudentStatus, BadgeTone> = {
  activo: "ok",
  pausado: "warn",
  inactivo: "neutral",
  archivado: "neutral",
};

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STUDENT_STATUS_LABEL[status]}
    </Badge>
  );
}
