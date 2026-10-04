import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { listRegistrationProgressForCalendarLessonIds } from "@/lib/repositories/lesson-registrations";
import { buildPendingLessons } from "@/lib/lessons/pending";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StartRegistrationButton } from "./start-registration-button";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases por registrar · TeacherFlow" };

// Ventana de búsqueda de pendientes: 90 días atrás — una clase sin
// registrar nunca "vence" en el móvil, pero acotar el rango evita generar
// ocurrencias virtuales sin límite; documentado como decisión de alcance
// real en docs/WEB_PARITY_PLAN.md, no un comportamiento fabricado.
const LOOKBACK_DAYS = 90;

export default async function RegistroPendientesPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let pending: ReturnType<typeof buildPendingLessons> = [];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const now = new Date();
    const rangeStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const rangeEnd = now;
    const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
    const calendarLessonIds = items.map((i) => i.materializedLessonId).filter((id): id is string => !!id);
    const registrations = await listRegistrationProgressForCalendarLessonIds(ctx, calendarLessonIds);
    pending = buildPendingLessons({ calendarItems: items, now, registrations });
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar las clases por registrar." />
        <Link href="/registro" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Clases por registrar</h1>
          <p className="mt-1.5 text-sm text-textMuted">
            {pending.length} actividad{pending.length === 1 ? "" : "es"} pendiente{pending.length === 1 ? "" : "s"} de registrar.
          </p>
        </div>
        <Link
          href="/registro/nuevo"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-textPrimary shadow-card transition-colors duration-150 hover:border-brandBlue/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          + Registrar clase no programada
        </Link>
      </div>

      {pending.length === 0 ? (
        <div className="mt-6">
          <EmptyState message="No hay clases ni entrenamientos pendientes de registrar." />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {pending.map(({ item, registrationState, completedParticipants, totalParticipants }) => {
            const dateLabel = formatInstantDayShort(item.start);
            const timeLabel = formatInstantTime(item.start);
            const isGroup = item.participantIds.length > 1;
            return (
              <li key={item.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">{item.title?.trim() || item.studentName || "Sin alumnos"}</p>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {dateLabel} · {timeLabel} · {MODALITY_LABEL[item.modality]}
                    </p>
                  </div>
                  <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[item.activityKind]}</span>
                </div>
                {isGroup && (
                  <p className="mt-2 text-xs text-textSecondary">
                    {registrationState === "in_progress" ? `${completedParticipants} de ${totalParticipants} alumnos completados` : `${totalParticipants} alumnos`}
                  </p>
                )}
                <div className="mt-3">
                  <StartRegistrationButton
                    calendarLessonId={item.materializedLessonId}
                    recurrenceId={item.recurrenceId}
                    occurrenceKey={item.occurrenceKey}
                    recurrenceIndex={null}
                    label={registrationState === "in_progress" ? "Continuar registro" : "Registrar"}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
