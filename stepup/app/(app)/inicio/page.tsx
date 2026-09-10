import { FIXTURE_TODAY_LESSONS } from "@/lib/fixtures";
import { EmptyState } from "@/components/ui/states";

export const metadata = { title: "Inicio · TeacherFlow" };

export default function InicioPage() {
  const hasLessons = FIXTURE_TODAY_LESSONS.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Inicio</h1>
      <p className="mt-1.5 text-sm text-textMuted">Datos de ejemplo — vista previa sin conexión real.</p>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-textSecondary">
          Clases de hoy
        </h2>
        {hasLessons ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIXTURE_TODAY_LESSONS.map((lesson) => (
              <li
                key={lesson.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
              >
                <div>
                  <p className="text-sm font-semibold text-textPrimary">{lesson.studentName}</p>
                  <p className="mt-0.5 text-xs text-textMuted">{lesson.modality}</p>
                </div>
                <span className="text-sm font-semibold text-brandBlue">{lesson.time}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3">
            <EmptyState message="No hay clases agendadas para hoy." />
          </div>
        )}
      </section>
    </div>
  );
}
