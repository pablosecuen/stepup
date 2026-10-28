import Link from "@/components/nav/private-link";
import { Suspense } from "react";
import { MonthlyFinancialSummary } from "@/components/dashboard/monthly-financial-summary";
import { ArrowRightIcon, BellIcon, CheckCircleIcon, ChevronRightIcon, ExclamationTriangleIcon, PlusIcon, SunIcon } from "@heroicons/react/24/outline";
import { DayPlanner } from "@/components/dashboard/day-planner";
import { FirstSteps } from "@/components/dashboard/first-steps";
import { DailyCollectionsNotice } from "@/components/dashboard/daily-collections-notice";
import { REMINDER_ICONS } from "@/components/reminders/reminder-icons";
import { Badge } from "@/components/ui/badge";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { PAGE_WIDTH } from "@/components/ui/page-header";
import { agendaLessonLabel } from "@/lib/dashboard/lesson-label";
import { buildFirstSteps, buildGreeting, homeDateLabel, resolveHomeStage, type HomeWelcome } from "@/lib/dashboard/home-welcome";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";
import { formatGrade, formatHours } from "@/lib/format/number-format";
import type { HomeData } from "@/lib/dashboard/load-home-data";

const MAX_VISIBLE_PENDING = 4;
const PANEL = "rounded-xl border-[1.5px] border-border bg-surface shadow-card";
const ROW = "flex min-h-14 items-center gap-3 border-t border-border px-4 py-2.5 transition-colors duration-200 hover:bg-surface2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink motion-reduce:transition-none nav:px-5";

/** Indicador editorial del resumen del día: cifra en serifa y una palabra, sin tarjeta. Los enlazados suben de tono al pasar el puntero. */
function Figure({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="block font-display text-[34px] font-medium leading-none tracking-tight tf-num max-[420px]:text-[28px]">{value}</span>
      <span className="mt-1 block text-[13px] font-medium leading-tight text-textMuted">{label}</span>
    </>
  );
  const cls = "block min-h-11 min-w-0 px-4 py-1 first:pl-0 nav:px-7 nav:first:pl-0";
  return href ? (
    <Link href={href} className={`min-h-11 ${cls} rounded-md transition-colors duration-200 hover:text-accentDark focus:outline-none focus-visible:ring-2 focus-visible:ring-ink`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Cifra con texto (horas, promedio, «Sin datos»): mismo estilo que `Figure`, pero acepta texto. */
function TextFigure({ value, label }: { value: string; label: string }) {
  return (
    <div className="block min-h-11 min-w-0 py-1 nav:px-7 nav:first:pl-0">
      <span className="block font-display text-[26px] font-medium leading-none tracking-tight tf-num max-[420px]:text-[22px]">{value}</span>
      <span className="mt-1 block text-[13px] font-medium leading-tight text-textMuted">{label}</span>
    </div>
  );
}

function PanelHeader({ id, title, count, href, linkLabel }: { id: string; title: string; count?: number; href?: string; linkLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-2.5 pt-3.5 nav:px-5">
      <div className="flex items-center gap-2">
        <h2 id={id} className="font-display text-[20px] font-semibold leading-tight tracking-tight">
          {title}
        </h2>
        {count !== undefined && <Badge>{count}</Badge>}
      </div>
      {href && (
        <Link href={href} className={`${linkClass()} shrink-0`}>
          {linkLabel ?? "Ver todo"}
          <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Inicio (rediseño): una pantalla amplia que se entiende de un vistazo. Arriba, fecha, saludo, «Nueva clase» y la campana; después un
 * resumen editorial del día (sin tarjetas); a la izquierda la franja de «Próxima clase» y «Tu día» (línea de tiempo con TODAS las
 * clases del día civil de Argentina) y a la derecha los pendientes: clases por registrar, recordatorios y cobros de hoy. Sólo
 * presentación sobre lo que `HomeData` ya carga: ninguna consulta nueva, ningún dato inventado.
 */
export function HomeView({ data, welcome }: { data: HomeData; welcome: HomeWelcome }) {
  const remindersCount = data.remindersSummary.totalCount;
  const stage = resolveHomeStage({ studentCount: data.studentCount, hasAnyClass: welcome.hasAnyClass });
  const onboarding = stage !== "active";
  const greeting = buildGreeting(data.localHour, welcome.displayName);
  const [greetingLead, ...greetingRest] = greeting.split(", ");
  const todayCount = data.todayLessons.length;
  const pending = data.pendingLessons;
  const showCollections = stage !== "empty";
  const urgency = data.collectionsUrgency;

  return (
    <div data-tf-groups="" className={`${PAGE_WIDTH.wide}`}>
      <header data-enter="1" className={`tf-enter flex flex-wrap items-end justify-between gap-x-6 gap-y-3`}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-[650] text-textMuted">
            <SunIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="first-letter:uppercase">{homeDateLabel(data.todayDateKey)}</span>
          </p>
          <h1 className="mt-1 font-display text-[36px] font-medium leading-[1.06] tracking-[-0.03em] text-textPrimary max-[360px]:text-[30px] nav:text-[44px]">
            {greetingLead}
            {greetingRest.length > 0 && (
              <>
                , <em className="font-normal text-accentDark">{greetingRest.join(", ")}</em>
              </>
            )}
          </h1>
        </div>
        <div className="flex w-full items-center gap-3 nav:w-auto">
          {!onboarding && (
            <PrivateButtonLink href="/calendario/nueva" variant="accent" className="flex-1 nav:flex-none">
              <PlusIcon className="h-5 w-5" aria-hidden />
              Nueva clase
            </PrivateButtonLink>
          )}
          <Link
            href="/recordatorios"
            aria-label={remindersCount > 0 ? `${remindersCount} recordatorios pendientes` : "Recordatorios"}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-borderMid bg-surface text-textSecondary transition-colors duration-200 hover:bg-paperDeep hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            <BellIcon className="h-5 w-5" aria-hidden />
            {remindersCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill border-2 border-background bg-accent px-1 text-[11px] font-bold text-white">
                {remindersCount > 99 ? "99+" : remindersCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {!onboarding && (
        <section aria-label="Resumen del día" data-enter="2" className={`tf-enter mt-5 flex items-stretch divide-x divide-border border-y border-border py-3`}>
          <Figure value={todayCount} label={todayCount === 1 ? "clase hoy" : "clases hoy"} />
          <Figure value={pending.length} label={pending.length === 1 ? "clase por registrar" : "clases por registrar"} href="/registro" />
          <Figure value={remindersCount} label={remindersCount === 1 ? "recordatorio" : "recordatorios"} href="/recordatorios" />
        </section>
      )}

      {!onboarding && <DailyCollectionsNotice summary={data.collectionsUrgency} todayDateKey={data.todayDateKey} />}
      {!onboarding && <Suspense fallback={<p role="status" className="mt-5 text-sm">Cargando resumen del mes…</p>}><MonthlyFinancialSummary /></Suspense>}

      {!onboarding && (
        <section aria-label="Indicadores" data-enter="2" className="tf-enter mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-3 nav:flex nav:items-stretch nav:divide-x nav:divide-border nav:gap-0">
          <TextFigure value={String(data.stats.activeStudents)} label={data.stats.activeStudents === 1 ? "alumno activo" : "alumnos activos"} />
          <TextFigure value={String(data.stats.lessonsThisWeek)} label={data.stats.lessonsThisWeek === 1 ? "clase esta semana" : "clases esta semana"} />
          <TextFigure value={data.stats.hoursTaughtThisMonth === null ? "Sin datos" : formatHours(data.stats.hoursTaughtThisMonth)} label="enseñadas este mes" />
          <TextFigure value={data.stats.averageGrade === null ? "Sin datos" : formatGrade(data.stats.averageGrade)} label="promedio de evaluaciones" />
        </section>
      )}

      {onboarding && (
        <div className="tf-enter" data-enter="2">
          <FirstSteps steps={buildFirstSteps({ activeStudentCount: data.activeStudentCount, hasAnyClass: welcome.hasAnyClass === true })} />
        </div>
      )}

      <div className={`mt-5 grid grid-cols-1 items-start gap-5 ${onboarding ? "" : "nav:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"}`}>
        {!onboarding && (
          <div className="flex min-w-0 flex-col gap-5">
            <DayPlanner entries={data.todayAgenda} allItems={data.todayAllItems} nowIso={data.nowIso} next={data.nextClass} />
          </div>
        )}

        {/* Pendientes: clases por registrar → recordatorios → cobros de hoy */}
        <div className="flex min-w-0 flex-col gap-5">
          {pending.length > 0 ? (
            <section aria-labelledby="por-registrar" data-enter="3" className={`tf-enter ${PANEL}`}>
              <PanelHeader id="por-registrar" title="Clases por registrar" count={pending.length} href="/registro" linkLabel={`Ver todas${pending.length > MAX_VISIBLE_PENDING ? ` (${pending.length})` : ""}`} />
              <ul>
                {pending.slice(0, MAX_VISIBLE_PENDING).map(({ item, registrationState, completedParticipants, totalParticipants }) => (
                  <li key={item.id}>
                    <Link href="/registro" className={`min-h-14 ${ROW}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold leading-snug [overflow-wrap:anywhere]">{agendaLessonLabel(item)}</span>
                        <span className="mt-0.5 block text-[13px] text-textMuted tf-num">
                          {formatInstantDayShort(item.start)} · {formatInstantTime(item.start)}
                          {item.participantIds.length > 1 && registrationState === "in_progress" ? ` · ${completedParticipants} de ${totalParticipants} completados` : ""}
                        </span>
                      </span>
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            !onboarding && (
              <section data-enter="3" className={`tf-enter ${PANEL} flex items-center gap-3 px-4 py-4 text-textSecondary nav:px-5`}>
                <CheckCircleIcon className="h-6 w-6 shrink-0 text-ok" aria-hidden />
                <p>No hay clases pendientes de registrar.</p>
              </section>
            )
          )}

          {(remindersCount > 0 || !onboarding) && (
            <section aria-labelledby="recordatorios-resumen" data-enter="3" className={`tf-enter ${PANEL}`}>
              <PanelHeader id="recordatorios-resumen" title="Recordatorios" count={remindersCount} href="/recordatorios" />
              {remindersCount === 0 ? (
                <p className="border-t border-border px-4 py-3 text-[14px] text-textMuted nav:px-5">No hay recordatorios pendientes.</p>
              ) : (
                <ul>
                  {data.remindersSummary.categories.map((category) => {
                    const { icon: Icon, tone } = REMINDER_ICONS[category.kind];
                    return (
                      <li key={category.kind}>
                        <Link href="/recordatorios" className={`min-h-14 ${ROW}`}>
                          <Icon className="h-5 w-5 shrink-0 text-textSecondary" aria-hidden />
                          <span className="min-w-0 flex-1 text-[14.5px] font-[650]">{category.label}</span>
                          <Badge tone={tone}>{category.items.length}</Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {showCollections && (
            <section aria-labelledby="cobros-hoy" data-enter="3" className={`tf-enter ${PANEL}`}>
              <PanelHeader id="cobros-hoy" title="Cobros de hoy" href="/cobros" linkLabel="Ver cobros" />
              <Link href="/cobros" className="min-h-14 grid grid-cols-2 divide-x divide-border border-t border-border transition-colors duration-200 hover:bg-surface2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink motion-reduce:transition-none">
                <span className="block min-h-14 px-4 py-3 nav:px-5">
                  <span className="block font-display text-[28px] font-medium leading-none tracking-tight tf-num">{urgency.dueToday}</span>
                  <span className="mt-1 block text-[13px] font-medium text-textMuted">{urgency.dueToday === 1 ? "vence hoy" : "vencen hoy"}</span>
                </span>
                <span className="block min-h-14 px-4 py-3 nav:px-5">
                  <span className={`flex items-center gap-1.5 font-display text-[28px] font-medium leading-none tracking-tight tf-num ${urgency.overdueCount > 0 ? "text-bad" : ""}`}>
                    {urgency.overdueCount}
                    {urgency.overdueCount > 0 && <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />}
                  </span>
                  <span className="mt-1 block text-[13px] font-medium text-textMuted">{urgency.overdueCount === 1 ? "vencido" : "vencidos"}</span>
                </span>
              </Link>
            </section>
          )}

          {data.emptyClasses.items.length > 0 && (
            <section data-enter="3" className={`tf-enter rounded-xl border-[1.5px] border-warnLine bg-[#FFF8E5] p-4 nav:p-5`}>
              <p className="flex items-start gap-2 text-[15px] font-bold text-textPrimary">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
                {data.emptyClasses.items.length} clase{data.emptyClasses.items.length === 1 ? "" : "s"} sin alumnos asignados
              </p>
              <Link href="/calendario/series" className={`${linkClass()} mt-1 pl-7`}>
                Revisar en Series
                <ArrowRightIcon className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
