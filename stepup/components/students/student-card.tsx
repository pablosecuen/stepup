import Link from "next/link";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { StudentStatusBadge } from "./student-status-badge";

export function StudentCard({ student }: { student: StudentRecord }) {
  return (
    <Link
      href={`/alumnos/${student.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
    >
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-textPrimary">{student.name}</p>
        <p className="mt-0.5 text-xs text-textMuted">
          {student.levels.length > 0 ? `Nivel ${student.levels.join(", ")}` : "Sin nivel"} · {MODALITY_LABEL[student.modality]}
        </p>
      </div>
      <StudentStatusBadge status={student.status} />
    </Link>
  );
}
