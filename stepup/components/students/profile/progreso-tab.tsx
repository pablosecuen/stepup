import { calculateAverageGrade } from "@/lib/lessons/grades";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import { EmptyState } from "@/components/ui/states";

/**
 * Progreso real — promedio calculado con `calculateAverageGrade` (0 nunca
 * cuenta, sólo notas reales) sobre las evaluaciones de clases finalizadas.
 */
export function ProgresoTabContent({ entries }: { entries: { registration: LessonRegistrationRecord; evaluation: LessonRegistrationEvaluationRecord }[] }) {
  if (entries.length === 0) {
    return <EmptyState message="Todavía no hay evaluaciones registradas." />;
  }
  const average = calculateAverageGrade(entries.map((e) => e.evaluation.generalGrade));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-textMuted">Promedio general</p>
        <p className="mt-1 text-2xl font-bold text-textPrimary">{average != null ? average.toFixed(1) : "Sin calificar"}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {entries
          .filter((e) => e.evaluation.generalGrade != null || e.evaluation.individualObservation)
          .map((entry) => (
            <li key={entry.registration.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-textPrimary">
                  {entry.registration.scheduledStartAt ? new Date(entry.registration.scheduledStartAt).toLocaleDateString("es-AR") : "Sin fecha"}
                </p>
                <p className="text-sm font-bold text-brandBlueDark">{entry.evaluation.generalGrade ?? "—"}</p>
              </div>
              {entry.evaluation.individualObservation && <p className="mt-1 text-xs text-textSecondary">{entry.evaluation.individualObservation}</p>}
            </li>
          ))}
      </ul>
    </div>
  );
}
