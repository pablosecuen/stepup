import { FIXTURE_STUDENTS } from "@/lib/fixtures";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alumnos · TeacherFlow" };

export default function AlumnosPage() {
  const hasStudents = FIXTURE_STUDENTS.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Alumnos</h1>
      <p className="mt-1.5 text-sm text-textMuted">Datos de ejemplo — vista previa sin conexión real.</p>

      {hasStudents ? (
        <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIXTURE_STUDENTS.map((student) => (
            <li
              key={student.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
            >
              <div>
                <p className="text-sm font-semibold text-textPrimary">{student.name}</p>
                <p className="mt-0.5 text-xs text-textMuted">Nivel {student.level}</p>
              </div>
              <StatusPill status={student.status} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState message="Todavía no hay alumnos cargados." />
        </div>
      )}
    </div>
  );
}
