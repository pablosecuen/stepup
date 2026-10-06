import { calculateAverageGrade, normalizeSkillGradeValue } from "@/lib/lessons/grades";
import { SKILL_LABEL, type Skill } from "@/lib/lessons/skills";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import { EmptyState } from "@/components/ui/states";
import { formatInstantDate } from "@/lib/format/date-format";
import { skillAveragesFromEvaluations } from "@/lib/students/profile-overview";

/**
 * Progreso real — promedio calculado con `calculateAverageGrade` (0 nunca
 * cuenta, sólo notas reales) sobre las evaluaciones de clases finalizadas.
 */
export function ProgresoTabContent({ entries }: { entries: { registration: LessonRegistrationRecord; evaluation: LessonRegistrationEvaluationRecord }[] }) {
  if (entries.length === 0) {
    return <EmptyState message="Todavía no hay evaluaciones registradas." action={{ label: "Ir a Registro", href: "/registro" }} />;
  }
  const average = calculateAverageGrade(entries.map((e) => e.evaluation.generalGrade));
  const skillAverages = skillAveragesFromEvaluations(entries.map((e) => e.evaluation));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-textMuted">Promedio general</p>
        <p className="mt-1 text-2xl font-bold text-textPrimary">{average != null ? average.toFixed(1) : "Sin calificar"}</p>
      </div>
      {skillAverages.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-textPrimary">Promedio por habilidad</h2>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {skillAverages.map((skill) => (
              <li key={skill.skill} className="flex items-center justify-between text-sm">
                <span className="text-textSecondary">{skill.label}</span>
                <span className="font-semibold text-textPrimary">{skill.averageGrade.toFixed(1)}/10</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="flex flex-col gap-2">
        {entries
          .filter((e) => e.evaluation.generalGrade != null || e.evaluation.individualObservation || Object.keys(e.evaluation.skillGrades).length > 0)
          .map((entry) => {
            const skillEntries = (Object.entries(entry.evaluation.skillGrades) as [Skill, number][])
              .map(([skill, value]) => [skill, normalizeSkillGradeValue(value)] as const)
              .filter((pair): pair is [Skill, number] => pair[1] != null);
            return (
              <li key={entry.registration.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-textPrimary">
                    {formatInstantDate(entry.registration.scheduledStartAt ?? entry.registration.actualStartedAt ?? entry.registration.createdAt, "Sin fecha")}
                  </p>
                  <p className="text-sm font-bold text-brandBlueDark">{entry.evaluation.generalGrade ?? "—"}</p>
                </div>
                {entry.evaluation.individualObservation && <p className="mt-1 text-xs text-textSecondary">{entry.evaluation.individualObservation}</p>}
                {skillEntries.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skillEntries.map(([skill, value]) => (
                      <span key={skill} className="rounded-pill bg-background px-2 py-0.5 text-xs font-medium text-textSecondary">
                        {SKILL_LABEL[skill]}: {value}/10
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
