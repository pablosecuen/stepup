import Link from "next/link";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { EmptyState } from "@/components/ui/states";

function statusLabel(registration: LessonRegistrationRecord): string {
  if (!registration.countsAsClass) return ADHOC_OUTCOME_LABEL[registration.outcome];
  return registration.status === "completed" ? "Finalizada" : "En curso";
}

/** Historial real de clases/entrenamientos dictados — nunca fixtures. Un alumno archivado conserva todo su historial acá. */
export function ClasesTabContent({ registrations }: { registrations: LessonRegistrationRecord[] }) {
  if (registrations.length === 0) {
    return <EmptyState message="Todavía no hay clases registradas para este alumno." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {registrations.map((registration) => (
        <li key={registration.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-textPrimary">
              {registration.scheduledStartAt
                ? new Date(registration.scheduledStartAt).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
                : "Sin fecha"}
            </p>
            <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[registration.activityKind]}</span>
          </div>
          <p className="mt-1 text-xs text-textMuted">{statusLabel(registration)}</p>
          <Link
            href={registration.calendarLessonId ? `/registro/${registration.calendarLessonId}` : `/registro/libre/${registration.id}`}
            className="mt-2 inline-block text-xs font-semibold text-brandBlue hover:underline"
          >
            Ver registro →
          </Link>
        </li>
      ))}
    </ul>
  );
}
