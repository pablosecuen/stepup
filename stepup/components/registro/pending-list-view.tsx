import { ClipboardDocumentCheckIcon, PlusIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PrivateButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PAGE_WIDTH, PageHeader } from "@/components/ui/page-header";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import type { PendingLessonItem } from "@/lib/lessons/pending";
import { StartRegistrationButton } from "@/app/(app)/registro/start-registration-button";

/**
 * Clases por registrar (presentación). La página calcula la lista de pendientes (`buildPendingLessons`); esta vista sólo la
 * dibuja. Cada fila dice día, hora, modalidad y tipo en texto; las grupales muestran el avance de los alumnos completados.
 */
export function PendingListView({ pending }: { pending: PendingLessonItem[] }) {
  return (
    <div className={PAGE_WIDTH.medium}>
      <PageHeader
        title="Clases por registrar"
        subtitle={`${pending.length} actividad${pending.length === 1 ? "" : "es"} pendiente${pending.length === 1 ? "" : "s"} de registrar.`}
        action={
          <PrivateButtonLink href="/registro/nuevo" variant="secondary">
            <PlusIcon className="h-5 w-5" aria-hidden />
            Registrar clase no programada
          </PrivateButtonLink>
        }
      />

      {pending.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={ClipboardDocumentCheckIcon} message="No hay clases ni entrenamientos pendientes de registrar." />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {pending.map(({ item, registrationState, completedParticipants, totalParticipants }) => {
            const dateLabel = formatInstantDayShort(item.start);
            const timeLabel = formatInstantTime(item.start);
            const isGroup = item.participantIds.length > 1;
            const title = item.title?.trim() || item.studentName || "Sin alumnos";
            const inProgress = registrationState === "in_progress";
            return (
              <li key={item.id}>
                <Card className="!p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      {isGroup || !item.studentName ? (
                        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-paperDeep text-textSecondary">
                          <UserGroupIcon className="h-6 w-6" />
                        </span>
                      ) : (
                        <Avatar initial={avatarInitials(item.studentName)} tone={avatarToneFor(item.participantIds[0] ?? item.id)} size="l" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <p className="min-w-0 font-display text-[20px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{title}</p>
                          <Badge tone={item.activityKind === "training" ? "accent" : "neutral"}>{ACTIVITY_KIND_LABEL[item.activityKind]}</Badge>
                        </div>
                        <p className="mt-0.5 text-[14.5px] text-textMuted">
                          {dateLabel} · {timeLabel} · {MODALITY_LABEL[item.modality]}
                        </p>
                        {isGroup && (
                          <>
                            <p className="mt-2 text-[14px] text-textSecondary">{inProgress ? `${completedParticipants} de ${totalParticipants} alumnos completados` : `${totalParticipants} alumnos`}</p>
                            {inProgress && totalParticipants > 0 && (
                              <div aria-hidden className="mt-1.5 h-2 max-w-[320px] overflow-hidden rounded-pill bg-paperDeep">
                                <div className="h-full rounded-pill bg-accent" style={{ width: `${Math.min(100, Math.round((completedParticipants / totalParticipants) * 100))}%` }} />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <StartRegistrationButton
                      calendarLessonId={item.materializedLessonId}
                      recurrenceId={item.recurrenceId}
                      occurrenceKey={item.occurrenceKey}
                      recurrenceIndex={null}
                      label={inProgress ? "Continuar registro" : "Registrar"}
                      variant={inProgress ? "primary" : "secondary"}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
