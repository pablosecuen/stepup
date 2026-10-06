import Link from "@/components/nav/private-link";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from "@/lib/lessons/attendance";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { EmptyState } from "@/components/ui/states";
import { formatInstantDayLong, formatInstantTime } from "@/lib/format/date-format";

function statusLabel(registration: LessonRegistrationRecord): string {
  if (!registration.countsAsClass) return ADHOC_OUTCOME_LABEL[registration.outcome];
  return registration.status === "completed" ? "Finalizada" : "En curso";
}

/** Día de la clase: el horario programado; si no tuvo (registro sin reserva), el inicio real y, en último caso, el alta del registro. */
function registrationAnchor(registration: LessonRegistrationRecord): string {
  return registration.scheduledStartAt ?? registration.actualStartedAt ?? registration.createdAt;
}

/**
 * Historial real de clases/entrenamientos del alumno — nunca fixtures. Un alumno archivado conserva todo su historial acá.
 * La asistencia es la de ESTE alumno (sólo existe en las clases finalizadas).
 */
export function ClasesTabContent({
  registrations,
  attendanceByRegistrationId,
}: {
  registrations: LessonRegistrationRecord[];
  attendanceByRegistrationId: Record<string, AttendanceStatus>;
}) {
  if (registrations.length === 0) {
    return <EmptyState message="Todavía no hay clases registradas para este alumno." action={{ label: "Ir a Registro", href: "/registro" }} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {registrations.map((registration) => {
        const attendance = attendanceByRegistrationId[registration.id];
        const modality = registration.modality ? MODALITY_LABEL[registration.modality as keyof typeof MODALITY_LABEL] : undefined;
        const timeRange = registration.scheduledStartAt
          ? registration.scheduledEndAt
            ? `${formatInstantTime(registration.scheduledStartAt)} a ${formatInstantTime(registration.scheduledEndAt)}`
            : formatInstantTime(registration.scheduledStartAt)
          : null;
        return (
          <li key={registration.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-textPrimary">{formatInstantDayLong(registrationAnchor(registration), "Sin fecha")}</p>
              <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[registration.activityKind]}</span>
            </div>
            <p className="mt-1 text-xs text-textMuted">
              {[statusLabel(registration), timeRange, modality, attendance ? `Asistencia: ${ATTENDANCE_STATUS_LABEL[attendance]}` : null].filter(Boolean).join(" · ")}
            </p>
            <Link
              href={registration.calendarLessonId ? `/registro/${registration.calendarLessonId}` : `/registro/libre/${registration.id}`}
              className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-brandBlue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
            >
              Ver registro →
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
