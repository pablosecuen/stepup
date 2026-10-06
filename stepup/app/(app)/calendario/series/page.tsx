import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listStudents } from "@/lib/repositories/students";
import { listLineagePredecessors, selectManageableRecurrenceSeries } from "@/lib/calendar/lineage";
import { formatCivilDayMonth } from "@/lib/format/date-format";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SeriesStatusActions } from "./series-status-actions";
import { ScrollToLastSeries } from "@/components/calendar/scroll-to-last-series";
import { TrainingBillingConfigButton } from "@/components/payments/training-billing-config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Series · TeacherFlow" };

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export default async function SeriesPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let rules;
  let students;
  try {
    const ctx = await requireAuthenticatedDbContext();
    [rules, students] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx)]);
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar las series." />
        <Link href="/calendario/series" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  const studentsById = new Map(students.map((s) => [s.id, s]));
  // Agrupación por LINAJE real (supersedesRecurrenceId), NUNCA por
  // studentId — dos series del mismo alumno, o una serie sin alumno
  // principal, quedan siempre como tarjetas independientes.
  // `lineage.ts` usa `recurrenceId` (nombre del móvil); el repositorio usa
  // `id` (mismo criterio que el resto de la web) — se adapta acá, nunca se
  // renombra el campo real de la tabla.
  const rulesForLineage = rules.map((rule) => ({ ...rule, recurrenceId: rule.id }));
  const nowIso = new Date().toISOString();
  const manageable = selectManageableRecurrenceSeries(rulesForLineage, nowIso);
  const namesOf = (ids: string[]) => ids.map((id) => studentsById.get(id)?.name ?? "Alumno").join(", ") || "Sin alumnos";
  const scheduleOf = (weeks: (typeof rules)[number]["weeks"]) =>
    weeks
      .flatMap((week) => week.sessions)
      .map((s) => `${WEEKDAY_LABELS[s.weekday]} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`)
      .join(" · ") || "Sin horario";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/calendario" className="inline-flex min-h-11 items-center text-sm font-medium text-brandBlue hover:underline">
        ← Volver al Calendario
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Series</h1>
        {manageable.length > 4 && <ScrollToLastSeries lastRuleId={manageable[manageable.length - 1].id} />}
      </div>
      <p className="mt-1.5 text-sm text-textMuted">{manageable.length} serie{manageable.length === 1 ? "" : "s"} vigente{manageable.length === 1 ? "" : "s"}.</p>

      {manageable.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="Todavía no hay series recurrentes." action={{ label: "Crear una clase", href: "/calendario/nueva" }} />
        </div>
      ) : (
        <ul className="mt-6 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          {manageable.map((rule) => {
            const participantNames = namesOf(rule.participantIds);
            const scheduleLabel = scheduleOf(rule.weeks);
            // Tramos de un split "esta y las siguientes": la sucesora rige DESDE su fecha efectiva y la original HASTA su fin —
            // las dos se muestran, ninguna se oculta.
            const sinceLabel = rule.supersedesRecurrenceId && rule.effectiveFromDate ? `Desde ${formatCivilDayMonth(rule.effectiveFromDate)} · ` : "";
            const earlierSegments = listLineagePredecessors(rulesForLineage, { ...rule, recurrenceId: rule.id }, nowIso);

            return (
              <li key={rule.id} id={`series-${rule.id}`} className="rounded-lg border border-border bg-surface p-4 shadow-card scroll-mt-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">{rule.classTitle || participantNames}</p>
                    {rule.classTitle && <p className="mt-0.5 text-xs text-textMuted">{participantNames}</p>}
                  </div>
                  <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[rule.activityKind]}</span>
                </div>
                <p className="mt-2 text-xs text-textSecondary">
                  {sinceLabel}
                  {scheduleLabel} · {MODALITY_LABEL[rule.modality]} · {rule.status === "active" ? "Activa" : rule.status === "paused" ? "Pausada" : "Finalizada"}
                </p>
                {earlierSegments.map((segment) => (
                  <p key={segment.id} className="mt-1 text-xs text-textMuted">
                    Tramo anterior: {scheduleOf(segment.weeks)} · {segment.endDate ? `hasta ${formatCivilDayMonth(segment.endDate)}` : "sin fecha de fin"} · {namesOf(segment.participantIds)}
                  </p>
                ))}
                <SeriesStatusActions
                  ruleId={rule.id}
                  status={rule.status}
                  weeks={rule.weeks}
                  participantIds={rule.participantIds}
                  primaryStudentId={rule.primaryStudentId}
                  students={students}
                />
                {rule.activityKind === "training" && <TrainingBillingConfigButton recurrenceRuleId={rule.id} agreementId={rule.trainingBillingAgreementId} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
