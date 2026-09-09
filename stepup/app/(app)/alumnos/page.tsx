import { FIXTURE_STUDENTS } from "@/lib/fixtures";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";

export const metadata = { title: "Alumnos · TeacherFlow" };

export default function AlumnosPage() {
  const hasStudents = FIXTURE_STUDENTS.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold text-textPrimary">Alumnos</h1>
      <p className="mt-1 text-sm text-textMuted">Datos de ejemplo — vista previa sin conexión real.</p>

      {hasStudents ? (
        <ul className="mt-6 flex flex-col gap-2">
          {FIXTURE_STUDENTS.map((student) => (
            <li
              key={student.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-textPrimary">{student.name}</p>
                <p className="text-xs text-textMuted">Nivel {student.level}</p>
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
