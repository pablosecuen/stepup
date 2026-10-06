import Link from "@/components/nav/private-link";
import { BellIcon } from "@heroicons/react/24/outline";
import { FirstSteps } from "@/components/dashboard/first-steps";
import { EmptyState } from "@/components/ui/states";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";
import { buildFirstSteps, buildGreeting, homeDateLabel, resolveHomeStage, type HomeWelcome } from "@/lib/dashboard/home-welcome";
import type { HomeData } from "@/lib/dashboard/load-home-data";

const MAX_VISIBLE_PENDING = 3;

function lessonLabel(item: HomeData["todayLessons"][number]): string {
  if (item.title?.trim()) return item.title.trim();
  if (item.participantIds.length > 1) return `Clase grupal · ${item.participantIds.length} alumnos`;
  return item.studentName || "Sin alumnos";
}

/** Vista de Inicio: sólo presentación (recibe los datos ya cargados), para poder probarla sin base de datos. */
export function HomeView({ data, welcome }: { data: HomeData; welcome: HomeWelcome }) {
  const visiblePending = data.pendingLessons.slice(0, MAX_VISIBLE_PENDING);
  const remindersCount = data.remindersSummary.totalCount;
  const stage = resolveHomeStage({ studentCount: data.studentCount, hasAnyClass: welcome.hasAnyClass });
  const onboarding = stage !== "active";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">{buildGreeting(data.localHour, welcome.displayName)}</h1>
          <p className="mt-1 text-sm text-textMuted first-letter:uppercase">{homeDateLabel(data.todayDateKey)}</p>
        </div>
        <Link
          href="/recordatorios"
          aria-label={remindersCount > 0 ? `${remindersCount} recordatorios pendientes` : "Recordatorios"}
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-textSecondary transition-colors hover:border-brandBlue/30 hover:text-brandBlue"
        >
          <BellIcon className="h-5 w-5" aria-hidden />
          {remindersCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill bg-statusRojo px-1 text-[11px] font-bold text-white">
              {remindersCount > 99 ? "99+" : remindersCount}
            </span>
          )}
        </Link>
      </div>

      {/* Próxima clase / en curso */}
      {data.nextClass && (
        <section className="mt-6 rounded-lg border border-brandBlue/30 bg-brandBlue/5 p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-brandBlue">
            {data.nextClass.timing === "in_progress" ? "Clase en curso" : "Próxima clase"}
          </p>
          <p className="mt-1 text-base font-semibold text-textPrimary">{lessonLabel(data.nextClass.item)}</p>
          <p className="mt-0.5 text-sm text-textMuted">
            {formatInstantTime(data.nextClass.item.start)} · {MODALITY_LABEL[data.nextClass.item.modality]}
          </p>
        </section>
      )}

      {/* Cuenta sin clases: primeros pasos reales en lugar de una agenda vacía */}
      {onboarding && <FirstSteps steps={buildFirstSteps({ activeStudentCount: data.activeStudentCount, hasAnyClass: welcome.hasAnyClass === true })} />}

      {/* Agenda del día */}
      {!onboarding && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-textSecondary">Clases de hoy</h2>
          {data.todayLessons.length === 0 ? (
            <div className="mt-3">
              <EmptyState message="No hay clases agendadas para hoy." />
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.todayLessons.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
                >
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">{lessonLabel(item)}</p>
                    <p className="mt-0.5 text-xs text-textMuted">{MODALITY_LABEL[item.modality]}</p>
                  </div>
                  <span className="text-sm font-semibold text-brandBlue">{formatInstantTime(item.start)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Clases sin alumnos */}
      {data.emptyClasses.items.length > 0 && (
        <section className="mt-8 rounded-lg border border-statusAmarillo/30 bg-statusAmarillo/5 p-4">
          <p className="text-sm font-semibold text-textPrimary">
            {data.emptyClasses.items.length} clase{data.emptyClasses.items.length === 1 ? "" : "s"} sin alumnos asignados
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.emptyClasses.items.slice(0, 3).map((item) => (
              <li key={item.key} className="text-xs text-textSecondary">
                {item.title} · {formatInstantDayShort(item.startIso)}
              </li>
            ))}
          </ul>
          <Link href="/calendario/series" className="mt-2 inline-block text-xs font-semibold text-brandBlue hover:underline">
            Revisar en Series →
          </Link>
        </section>
      )}

      {/* Clases por registrar */}
      {data.pendingLessons.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-textSecondary">Clases por registrar</h2>
            <span className="rounded-pill bg-background px-2 py-0.5 text-xs font-semibold text-textSecondary">{data.pendingLessons.length}</span>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {visiblePending.map(({ item, registrationState, completedParticipants, totalParticipants }) => (
              <li key={item.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
                <p className="text-sm font-semibold text-textPrimary">{lessonLabel(item)}</p>
                <p className="mt-0.5 text-xs text-textMuted">
                  {formatInstantDayShort(item.start)} · {formatInstantTime(item.start)}
                  {item.participantIds.length > 1 && registrationState === "in_progress" ? ` · ${completedParticipants} de ${totalParticipants} completados` : ""}
                </p>
              </li>
            ))}
          </ul>
          {data.pendingLessons.length > MAX_VISIBLE_PENDING && (
            <Link href="/registro" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
              Ver todas ({data.pendingLessons.length}) →
            </Link>
          )}
        </section>
      )}

      {/* Accesos rápidos (en una cuenta sin clases lo ofrecen los primeros pasos) */}
      {!onboarding && (
        <section className="mt-8">
          <Link
            href="/calendario/nueva"
            className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-5 py-3 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98]"
          >
            + Nueva clase
          </Link>
        </section>
      )}

      {/* Cobros — resumen compacto, sin montos ni nombres. Sin alumnos no hay nada que cobrar: no se muestra un "0 y 0" vacío. */}
      {stage !== "empty" && (
        <Link
          href="/cobros"
          className="mt-8 flex items-center justify-between rounded-lg border border-border bg-surface p-4 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
        >
          <div>
            <p className="text-sm font-semibold text-textPrimary">Cobros</p>
            <p className="mt-0.5 text-xs text-textMuted">
              {data.collectionsUrgency.dueToday} vence{data.collectionsUrgency.dueToday === 1 ? "" : "n"} hoy · {data.collectionsUrgency.overdueCount} vencido
              {data.collectionsUrgency.overdueCount === 1 ? "" : "s"}
            </p>
          </div>
          <span className="text-sm font-semibold text-brandBlue">Ver →</span>
        </Link>
      )}
    </div>
  );
}
