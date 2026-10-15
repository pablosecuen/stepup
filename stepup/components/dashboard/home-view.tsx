import { PAGE_WIDTH } from "@/components/ui/page-header";
import Link from "@/components/nav/private-link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArrowRightIcon,
  BanknotesIcon,
  BellIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  SunIcon,
} from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { FirstSteps } from "@/components/dashboard/first-steps";
import { LessonAvatar, TodayAgenda } from "@/components/dashboard/today-agenda";
import { agendaLessonLabel } from "@/lib/dashboard/lesson-label";
import { Badge } from "@/components/ui/badge";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";
import { buildFirstSteps, buildGreeting, homeDateLabel, resolveHomeStage, type HomeWelcome } from "@/lib/dashboard/home-welcome";
import { REMINDER_ICONS } from "@/components/reminders/reminder-icons";
import type { HomeData } from "@/lib/dashboard/load-home-data";

const MAX_VISIBLE_PENDING = 3;

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const CARD = "rounded-lg border-[1.5px] border-border bg-surface shadow-card";

function SectionCard({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-4 nav:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="font-display text-card font-semibold">{title}</h2>
          {count !== undefined && <Badge>{count}</Badge>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Indicador de la franja de resumen: compacto (≈ 73 px de alto en escritorio) y con poco protagonismo frente a la agenda. En móvil
 * (< 480 px) cada uno es una fila de 44 px (nombre a la izquierda, cifra a la derecha) para no volver a ser tres tarjetas enormes.
 */
function Kpi({ label, value, hint, href, icon: Icon }: { label: string; value: number; hint: string; href?: string; icon: IconComponent }) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-[650] leading-tight text-textMuted">
        <Icon className="hidden h-3.5 w-3.5 shrink-0 min-[480px]:block" aria-hidden />
        {label}
      </span>
      <span className="flex shrink-0 items-baseline gap-1.5 min-[480px]:mt-0.5">
        <span className="font-display text-[22px] font-medium leading-none tracking-tight tf-num min-[480px]:text-[26px]">{value}</span>
        <span className="text-[12px] leading-tight text-textMuted">{hint}</span>
      </span>
    </>
  );
  const cls =
    "flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border-[1.5px] border-border bg-surface px-3.5 py-2 shadow-subtle min-[480px]:flex-col min-[480px]:items-start min-[480px]:justify-center min-[480px]:py-2.5";
  return href ? (
    <Link href={href} className={`min-h-11 ${cls} transition-colors hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Vista de Inicio: sólo presentación (recibe los datos ya cargados), para poder probarla sin base de datos. */
export function HomeView({ data, welcome }: { data: HomeData; welcome: HomeWelcome }) {
  const visiblePending = data.pendingLessons.slice(0, MAX_VISIBLE_PENDING);
  const remindersCount = data.remindersSummary.totalCount;
  const stage = resolveHomeStage({ studentCount: data.studentCount, hasAnyClass: welcome.hasAnyClass });
  const onboarding = stage !== "active";
  const greeting = buildGreeting(data.localHour, welcome.displayName);
  const [greetingLead, ...greetingRest] = greeting.split(", ");
  const todayCount = data.todayLessons.length;
  const showCollections = stage !== "empty";
  const showReminders = remindersCount > 0 || !onboarding;

  return (
    <div className={PAGE_WIDTH.wide}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-[650] text-textMuted">
            <SunIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="first-letter:uppercase">{homeDateLabel(data.todayDateKey)}</span>
          </p>
          <h1 className="mt-1 font-display text-[34px] font-medium leading-[1.06] tracking-[-0.03em] text-textPrimary max-[360px]:text-[30px] nav:text-[44px]">
            {greetingLead}
            {greetingRest.length > 0 && (
              <>
                , <em className="font-normal text-accentDark">{greetingRest.join(", ")}</em>
              </>
            )}
          </h1>
          {!onboarding && todayCount > 0 && (
            <p className="mt-2 text-base text-textSecondary">
              Hoy tenés <b className="text-textPrimary">{todayCount === 1 ? "1 clase" : `${todayCount} clases`}</b>.
            </p>
          )}
        </div>
        <Link
          href="/recordatorios"
          aria-label={remindersCount > 0 ? `${remindersCount} recordatorios pendientes` : "Recordatorios"}
          className="relative flex h-11 w-11 items-center justify-center rounded-full shrink-0 border-[1.5px] border-borderMid bg-surface text-textSecondary transition-colors hover:bg-paperDeep hover:text-ink"
        >
          <BellIcon className="h-5 w-5" aria-hidden />
          {remindersCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill border-2 border-background bg-accent px-1 text-[11px] font-bold text-white">
              {remindersCount > 99 ? "99+" : remindersCount}
            </span>
          )}
        </Link>
      </div>

      {/* Accesos rápidos (en una cuenta sin clases lo ofrecen los primeros pasos) */}
      {!onboarding && (
        <section className="mt-4">
          <PrivateButtonLink href="/calendario/nueva" variant="accent" className="w-full nav:w-auto">
            <PlusIcon className="h-5 w-5" aria-hidden />
            Nueva clase
          </PrivateButtonLink>
        </section>
      )}

      {/* Próxima clase / en curso */}
      {data.nextClass && (
        <section
          className={`mt-6 rounded-lg border-[1.5px] p-4 shadow-card nav:p-5 ${
            data.nextClass.timing === "in_progress" ? "border-accent bg-accent text-white" : "border-accentLine bg-accentSoft text-accentText"
          }`}
        >
          <p className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em]">
            {data.nextClass.timing === "in_progress" && <PlayIcon className="h-3.5 w-3.5" aria-hidden />}
            {data.nextClass.timing === "in_progress" ? "Clase en curso" : "Próxima clase"}
          </p>
          <p className="mt-1.5 font-display text-[24px] font-semibold leading-[1.15] tracking-tight [overflow-wrap:anywhere]">{agendaLessonLabel(data.nextClass.item)}</p>
          <p className="mt-1 text-[15px] opacity-95">
            {formatInstantTime(data.nextClass.item.start)} · {MODALITY_LABEL[data.nextClass.item.modality]}
          </p>
        </section>
      )}

      {/* Cuenta sin clases: primeros pasos reales en lugar de una agenda vacía */}
      {onboarding && <FirstSteps steps={buildFirstSteps({ activeStudentCount: data.activeStudentCount, hasAnyClass: welcome.hasAnyClass === true })} />}

      {/* Franja de resumen del día (sólo con datos ya cargados) */}
      {!onboarding && (
        <section aria-label="Resumen del día" className="mt-5 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3 nav:gap-3.5">
          <Kpi label="Clases de hoy" value={todayCount} hint={todayCount === 1 ? "clase" : "clases"} icon={CalendarDaysIcon} />
          <Kpi
            label="Por registrar"
            value={data.pendingLessons.length}
            hint={data.pendingLessons.length === 1 ? "clase" : "clases"}
            href="/registro"
            icon={ClipboardDocumentCheckIcon}
          />
          <Kpi label="Recordatorios" value={remindersCount} hint={remindersCount === 1 ? "pendiente" : "pendientes"} href="/recordatorios" icon={BellIcon} />
        </section>
      )}

      <div className={`mt-5 grid grid-cols-1 items-start gap-5 ${onboarding ? "" : "nav:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]"}`}>
        {/* Columna principal: la agenda COMPLETA del día y, debajo, Cobros y Recordatorios compactos */}
        <div className="flex min-w-0 flex-col gap-5">
          {!onboarding && (
            <section aria-labelledby="clases-de-hoy" className={CARD}>
              <div className="px-4 pb-1.5 pt-4 nav:px-5">
                <h2 id="clases-de-hoy" className="font-display text-card font-semibold">
                  Clases de hoy
                </h2>
              </div>
              {data.todayAgenda.length === 0 ? (
                <p className="mx-4 mb-4 mt-1.5 max-w-[540px] rounded-md border-2 border-dashed border-borderMid px-4 py-3 text-[14.5px] text-textMuted nav:mx-5">No hay clases agendadas para hoy.</p>
              ) : (
                <TodayAgenda entries={data.todayAgenda} allItems={data.todayAllItems} nowIso={data.nowIso} nextId={data.nextClass?.item.id ?? null} />
              )}
            </section>
          )}

          {(showCollections || showReminders) && (
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
              {/* Cobros — resumen compacto, sin montos ni nombres. Sin alumnos no hay nada que cobrar: no se muestra un "0 y 0" vacío. */}
              {showCollections && (
                <Link href="/cobros" className={`${CARD} flex min-h-11 items-center gap-3 p-3.5 transition-colors hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 nav:px-4`}>
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-accentSoft text-accentText">
                    <BanknotesIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-card font-semibold">Cobros</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-textMuted">
                      <span>
                        {data.collectionsUrgency.dueToday} vence{data.collectionsUrgency.dueToday === 1 ? "" : "n"} hoy
                      </span>
                      <span aria-hidden>·</span>
                      <span className={data.collectionsUrgency.overdueCount > 0 ? "font-bold text-bad" : ""}>
                        {data.collectionsUrgency.overdueCount} vencido{data.collectionsUrgency.overdueCount === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[14px] font-[650] text-accentDark">
                    Ver
                    <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  </span>
                </Link>
              )}

              {/* Recordatorios — el total y el resumen real por categoría (la campana de arriba lleva al mismo detalle) */}
              {showReminders && (
                <section aria-labelledby="recordatorios-resumen" className={CARD}>
                  <div className="flex items-center justify-between gap-3 px-3.5 pb-1 pt-3.5 nav:px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 id="recordatorios-resumen" className="font-display text-card font-semibold">
                        Recordatorios
                      </h2>
                      <Badge>{remindersCount}</Badge>
                    </div>
                    <Link href="/recordatorios" className={linkClass()}>
                      Ver
                      <ArrowRightIcon className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                  {remindersCount === 0 ? (
                    <p className="px-3.5 pb-3.5 text-[13.5px] text-textMuted nav:px-4">No hay recordatorios pendientes.</p>
                  ) : (
                    <ul>
                      {data.remindersSummary.categories.map((category) => {
                        const { icon: Icon, tone } = REMINDER_ICONS[category.kind];
                        return (
                          <li key={category.kind} className="flex items-center gap-3 border-t border-border px-3.5 py-2 nav:px-4">
                            <Icon className="h-5 w-5 shrink-0 text-textSecondary" aria-hidden />
                            <p className="min-w-0 flex-1 text-[14px] font-[650]">{category.label}</p>
                            <Badge tone={tone}>{category.items.length}</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Columna lateral: Clases por registrar (y avisos de clases sin alumnos) */}
        <div className="flex min-w-0 flex-col gap-5">
          {data.pendingLessons.length > 0 && (
            <SectionCard title="Clases por registrar" count={data.pendingLessons.length}>
              <ul>
                {visiblePending.map(({ item, registrationState, completedParticipants, totalParticipants }) => (
                  <li key={item.id} className="flex items-center gap-3 border-t border-border px-4 py-3 nav:px-5">
                    <LessonAvatar item={item} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold leading-snug [overflow-wrap:anywhere]">{agendaLessonLabel(item)}</p>
                      <p className="mt-0.5 text-[13px] text-textMuted">
                        {formatInstantDayShort(item.start)} · {formatInstantTime(item.start)}
                        {item.participantIds.length > 1 && registrationState === "in_progress" ? ` · ${completedParticipants} de ${totalParticipants} completados` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {data.pendingLessons.length > MAX_VISIBLE_PENDING && (
                <div className="border-t border-border px-4 nav:px-5">
                  <Link href="/registro" className={linkClass()}>
                    Ver todas ({data.pendingLessons.length})
                    <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {/* Sin pendientes (cuenta con actividad): se dice en texto, sin tarjeta vacía */}
          {!onboarding && data.pendingLessons.length === 0 && (
            <section className={`${CARD} flex items-center gap-3 px-4 py-4 text-textSecondary nav:px-5`}>
              <CheckCircleIcon className="h-6 w-6 shrink-0 text-ok" aria-hidden />
              <p>No hay clases pendientes de registrar.</p>
            </section>
          )}

          {/* Clases sin alumnos */}
          {data.emptyClasses.items.length > 0 && (
            <section className="rounded-lg border-[1.5px] border-warnLine bg-[#FFF8E5] p-4 nav:p-5">
              <p className="flex items-start gap-2 text-[15px] font-bold text-textPrimary">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
                {data.emptyClasses.items.length} clase{data.emptyClasses.items.length === 1 ? "" : "s"} sin alumnos asignados
              </p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-7">
                {data.emptyClasses.items.slice(0, 3).map((item) => (
                  <li key={item.key} className="text-[13.5px] text-textSecondary [overflow-wrap:anywhere]">
                    {item.title} · {formatInstantDayShort(item.startIso)}
                  </li>
                ))}
              </ul>
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
