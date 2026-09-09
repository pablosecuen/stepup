import { FIXTURE_TODAY_LESSONS } from "@/lib/fixtures";

export const metadata = { title: "Calendario · TeacherFlow" };

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Fase A: placeholder navegable y coherente — el motor real de recurrencias/
// series/entrenamientos se incorpora en una fase posterior. Se muestra la
// grilla semanal y las clases de hoy (datos ficticios) para dejar lista la
// estructura de la pantalla.
export default function CalendarioPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold text-textPrimary">Calendario</h1>
      <p className="mt-1 text-sm text-textMuted">
        Datos de ejemplo — la grilla semanal completa con series y entrenamientos se agrega en una
        fase posterior.
      </p>

      <div className="mt-6 grid grid-cols-7 gap-1 overflow-x-auto text-center">
        {WEEKDAYS.map((day) => (
          <div key={day} className="rounded-md border border-border bg-surface px-1 py-3 text-xs font-semibold text-textSecondary">
            {day}
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-textSecondary">Hoy</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {FIXTURE_TODAY_LESSONS.map((lesson) => (
            <li
              key={lesson.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
            >
              <p className="text-sm font-semibold text-textPrimary">{lesson.studentName}</p>
              <span className="text-sm font-semibold text-brandBlue">{lesson.time}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
