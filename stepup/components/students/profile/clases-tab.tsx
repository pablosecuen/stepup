import Link from "@/components/nav/private-link";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from "@/lib/lessons/attendance";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { linkClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { formatInstantDayLong, formatInstantTime } from "@/lib/format/date-format";
import { OriginIncidentNote } from "@/components/registro/origin-incidents-card";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { SessionCorrection } from "@/components/registro/session-correction";

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
  incidentsByRegistrationId = {},
}: {
  registrations: LessonRegistrationRecord[];
  attendanceByRegistrationId: Record<string, AttendanceStatus>;
  /** Incidencias heredadas del traslado por clase registrada (opcional: sin ellas la lista queda como siempre). */
  incidentsByRegistrationId?: Record<string, OriginIncidentView[]>;
}) {
  if (registrations.length === 0) {
    return <EmptyState icon={CalendarDaysIcon} message="Todavía no hay clases registradas para este alumno." action={{ label: "Ir a Registro", href: "/registro" }} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {registrations.map((registration) => {
        const attendance = attendanceByRegistrationId[registration.id];
        const modality = registration.modality ? MODALITY_LABEL[registration.modality as keyof typeof MODALITY_LABEL] : undefined;
        const timeRange = registration.scheduledStartAt
          ? registration.scheduledEndAt
            ? `${formatInstantTime(registration.scheduledStartAt)} a ${formatInstantTime(registration.scheduledEndAt)}`
            : formatInstantTime(registration.scheduledStartAt)
          : null;
        return (
          <li key={registration.id}>
            <Card className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <p className="min-w-0 font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">
                  {formatInstantDayLong(registrationAnchor(registration), "Sin fecha")}
                </p>
                <Badge>{ACTIVITY_KIND_LABEL[registration.activityKind]}</Badge>
              </div>
              <p className="mt-1.5 text-[14px] text-textMuted [overflow-wrap:anywhere]">
                {[statusLabel(registration), timeRange, modality, attendance ? `Asistencia: ${ATTENDANCE_STATUS_LABEL[attendance]}` : null].filter(Boolean).join(" · ")}
              </p>
              <OriginIncidentNote incidents={incidentsByRegistrationId[registration.id] ?? []} />
              <SessionCorrection registration={registration} />
              <Link href={registration.calendarLessonId ? `/registro/${registration.calendarLessonId}` : `/registro/libre/${registration.id}`} className={`mt-1 ${linkClass()}`}>
                Ver registro →
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
