import { AcademicCapIcon } from "@heroicons/react/24/outline";
import { calculateAverageGrade, normalizeSkillGradeValue } from "@/lib/lessons/grades";
import { SKILL_LABEL, type Skill } from "@/lib/lessons/skills";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatInstantDate } from "@/lib/format/date-format";
import { formatGrade } from "@/lib/format/number-format";
import { skillAveragesFromEvaluations } from "@/lib/students/profile-overview";

/**
 * Progreso real — promedio calculado con `calculateAverageGrade` (0 nunca
 * cuenta, sólo notas reales) sobre las evaluaciones de clases finalizadas.
 */
export function ProgresoTabContent({ entries }: { entries: { registration: LessonRegistrationRecord; evaluation: LessonRegistrationEvaluationRecord }[] }) {
  if (entries.length === 0) {
    return <EmptyState icon={AcademicCapIcon} message="Todavía no hay evaluaciones registradas." action={{ label: "Ir a Registro", href: "/registro" }} />;
  }
  const average = calculateAverageGrade(entries.map((e) => e.evaluation.generalGrade));
  const skillAverages = skillAveragesFromEvaluations(entries.map((e) => e.evaluation));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-label font-bold uppercase text-textMuted">Promedio general</p>
        <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight tf-num text-textPrimary">{average != null ? formatGrade(average) : "Sin calificar"}</p>
      </Card>
      {skillAverages.length > 0 && (
        <section>
         <Card>
          <h2 className="font-display text-card font-semibold">Promedio por habilidad</h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {skillAverages.map((skill) => (
              <li key={skill.skill} className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-[15px] last:border-b-0">
                <span className="text-textSecondary">{skill.label}</span>
                <span className="font-[650] tf-num text-textPrimary">{formatGrade(skill.averageGrade)}/10</span>
              </li>
            ))}
          </ul>
         </Card>
        </section>
      )}
      <ul className="flex flex-col gap-3">
        {entries
          .filter((e) => e.evaluation.generalGrade != null || e.evaluation.individualObservation || Object.keys(e.evaluation.skillGrades).length > 0)
          .map((entry) => {
            const skillEntries = (Object.entries(entry.evaluation.skillGrades) as [Skill, number][])
              .map(([skill, value]) => [skill, normalizeSkillGradeValue(value)] as const)
              .filter((pair): pair is [Skill, number] => pair[1] != null);
            return (
              <li key={entry.registration.id}>
                <Card className="!p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display text-[19px] font-semibold tracking-tight text-textPrimary">
                      {formatInstantDate(entry.registration.scheduledStartAt ?? entry.registration.actualStartedAt ?? entry.registration.createdAt, "Sin fecha")}
                    </p>
                    <p className="font-display text-[22px] font-semibold tf-num text-accentDark">{entry.evaluation.generalGrade ?? "—"}</p>
                  </div>
                  {entry.evaluation.individualObservation && <p className="mt-1.5 text-[14.5px] text-textSecondary [overflow-wrap:anywhere]">{entry.evaluation.individualObservation}</p>}
                  {skillEntries.length > 0 && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {skillEntries.map(([skill, value]) => (
                        <li key={skill} className="inline-flex min-h-[26px] items-center rounded-pill border border-border bg-paperDeep px-2.5 text-[12.5px] font-[650] text-textSecondary">
                          {SKILL_LABEL[skill]}: {value}/10
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
