import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listStudents } from "@/lib/repositories/students";
import { selectManageableRecurrenceSeries } from "@/lib/calendar/lineage";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SeriesStatusActions } from "./series-status-actions";

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
        <Link href="/calendario/series" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
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
  const manageable = selectManageableRecurrenceSeries(rulesForLineage, new Date().toISOString());

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/calendario" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver al Calendario
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Series</h1>
      <p className="mt-1.5 text-sm text-textMuted">{manageable.length} serie{manageable.length === 1 ? "" : "s"} vigente{manageable.length === 1 ? "" : "s"}.</p>

      {manageable.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="Todavía no hay series recurrentes." />
        </div>
      ) : (
        <ul className="mt-6 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          {manageable.map((rule) => {
            const participantNames = rule.participantIds.map((id) => studentsById.get(id)?.name ?? "Alumno").join(", ") || "Sin alumnos";
            const scheduleLabel =
              rule.weeks
                .flatMap((week) => week.sessions)
                .map((s) => `${WEEKDAY_LABELS[s.weekday]} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`)
                .join(" · ") || "Sin horario";

            return (
              <li key={rule.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">{rule.classTitle || participantNames}</p>
                    <p className="mt-0.5 text-xs text-textMuted">{participantNames}</p>
                  </div>
                  <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[rule.activityKind]}</span>
                </div>
                <p className="mt-2 text-xs text-textSecondary">
                  {scheduleLabel} · {MODALITY_LABEL[rule.modality]} · {rule.status === "active" ? "Activa" : rule.status === "paused" ? "Pausada" : "Finalizada"}
                </p>
                <SeriesStatusActions ruleId={rule.id} status={rule.status} weeks={rule.weeks} participantIds={rule.participantIds} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
