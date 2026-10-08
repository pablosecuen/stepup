import Link from "@/components/nav/private-link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArrowRightIcon,
  BanknotesIcon,
  BellIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { FirstSteps } from "@/components/dashboard/first-steps";
import { Avatar } from "@/components/ui/avatar";
import { avatarToneFor } from "@/lib/ui/avatar-tone";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatInstantDayShort, formatInstantTime } from "@/lib/format/date-format";
import { buildFirstSteps, buildGreeting, homeDateLabel, resolveHomeStage, type HomeWelcome } from "@/lib/dashboard/home-welcome";
import type { ReminderCategoryKind } from "@/lib/dashboard/reminders-center";
import type { HomeData } from "@/lib/dashboard/load-home-data";

const MAX_VISIBLE_PENDING = 3;

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function lessonLabel(item: HomeData["todayLessons"][number]): string {
  if (item.title?.trim()) return item.title.trim();
  if (item.participantIds.length > 1) return `Clase grupal · ${item.participantIds.length} alumnos`;
  return item.studentName || "Sin alumnos";
}

/** Avatar de una clase: la inicial del alumno (individual) o un ícono (grupal o sin alumnos). Decorativo: el nombre va al lado en texto. */
function LessonAvatar({ item }: { item: HomeData["todayLessons"][number] }) {
  const isGroup = item.participantIds.length > 1;
  if (!isGroup && item.studentName.trim()) {
    return <Avatar initial={item.studentName.trim().charAt(0).toLocaleUpperCase("es")} tone={avatarToneFor(item.participantIds[0] ?? item.id)} size="m" />;
  }
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill tf-av-5">
      <UserGroupIcon className="h-4 w-4" />
    </span>
  );
}

const REMINDER_ICONS: Record<ReminderCategoryKind, { icon: IconComponent; tone: BadgeTone }> = {
  clases_sin_alumnos: { icon: UserGroupIcon, tone: "warn" },
  clases_sin_registrar: { icon: ClipboardDocumentCheckIcon, tone: "warn" },
  pagos_por_vencer: { icon: BanknotesIcon, tone: "warn" },
  pagos_vencidos: { icon: ExclamationCircleIcon, tone: "bad" },
};

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

function Kpi({ label, value, hint, href, icon: Icon }: { label: string; value: number; hint: string; href?: string; icon: IconComponent }) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-1 text-[12.5px] font-[650] leading-tight text-textMuted nav:text-[13px]">
        {label}
        <Icon className="hidden h-4 w-4 shrink-0 nav:block" aria-hidden />
      </span>
      <span className="mt-1.5 block font-display text-[30px] font-medium leading-none tracking-tight tf-num nav:text-[40px]">{value}</span>
      <span className="mt-1.5 block text-[12px] leading-tight text-textMuted nav:text-[13px]">{hint}</span>
    </>
  );
  const cls = `${CARD} block min-h-11 min-w-0 px-3 py-3 nav:px-[18px] nav:py-4`;
  return href ? (
    <Link href={href} className={`min-h-11 ${cls} transition-colors hover:border-ink`}>
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

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 nav:px-10 nav:py-[30px]">
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
          <p className="mt-1.5 font-display text-[24px] font-semibold leading-[1.15] tracking-tight [overflow-wrap:anywhere]">{lessonLabel(data.nextClass.item)}</p>
          <p className="mt-1 text-[15px] opacity-95">
            {formatInstantTime(data.nextClass.item.start)} · {MODALITY_LABEL[data.nextClass.item.modality]}
          </p>
        </section>
      )}

      {/* Cuenta sin clases: primeros pasos reales en lugar de una agenda vacía */}
      {onboarding && <FirstSteps steps={buildFirstSteps({ activeStudentCount: data.activeStudentCount, hasAnyClass: welcome.hasAnyClass === true })} />}

      {/* Resumen del día (sólo con datos ya cargados) */}
      {!onboarding && (
        <section aria-label="Resumen del día" className="mt-6 grid grid-cols-3 gap-2.5 nav:gap-3.5">
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

      <div className={`mt-6 grid grid-cols-1 items-start gap-5 ${onboarding ? "" : "nav:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]"}`}>
        <div className="flex min-w-0 flex-col gap-5">
          {/* Agenda del día */}
          {!onboarding && (
            <section className={CARD}>
              <div className="px-4 pb-1.5 pt-4 nav:px-5">
                <h2 className="font-display text-card font-semibold">Clases de hoy</h2>
              </div>
              {todayCount === 0 ? (
                <div className="px-4 pb-4 nav:px-5">
                  <EmptyState message="No hay clases agendadas para hoy." />
                </div>
              ) : (
                <ul>
                  {data.todayLessons.map((item) => {
                    const isNext = data.nextClass?.item.id === item.id;
                    const live = isNext && data.nextClass?.timing === "in_progress";
                    return (
                      <li
                        key={item.id}
                        className={`grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 first:border-t-0 nav:grid-cols-[78px_minmax(0,1fr)_auto] nav:gap-x-4 nav:px-5 ${
                          live ? "bg-accentSoft" : ""
                        }`}
                      >
                        <div className="font-display text-[19px] font-semibold leading-none tf-num nav:text-[21px]">
                          {formatInstantTime(item.start)}
                          <span className="mt-1 block font-sans text-[12.5px] font-medium text-textMuted">
                            <span className="sr-only">hasta </span>
                            {formatInstantTime(item.end)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-3">
                          <LessonAvatar item={item} />
                          <div className="min-w-0">
                            <p className="font-display text-[17px] font-semibold leading-tight [overflow-wrap:anywhere] nav:text-[18px]">{lessonLabel(item)}</p>
                            <p className="mt-0.5 text-[13.5px] text-textMuted">{MODALITY_LABEL[item.modality]}</p>
                          </div>
                        </div>
                        {isNext && (
                          <div className="col-start-2 justify-self-start nav:col-start-auto">
                            <Badge tone={live ? "accent" : "warn"} dot={live}>
                              {live ? "En curso" : "Sigue"}
                            </Badge>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
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

        <div className="flex min-w-0 flex-col gap-5">
          {/* Clases por registrar */}
          {data.pendingLessons.length > 0 && (
            <SectionCard title="Clases por registrar" count={data.pendingLessons.length}>
              <ul>
                {visiblePending.map(({ item, registrationState, completedParticipants, totalParticipants }) => (
                  <li key={item.id} className="flex items-center gap-3 border-t border-border px-4 py-3 nav:px-5">
                    <LessonAvatar item={item} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold leading-snug [overflow-wrap:anywhere]">{lessonLabel(item)}</p>
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

          {/* Cobros — resumen compacto, sin montos ni nombres. Sin alumnos no hay nada que cobrar: no se muestra un "0 y 0" vacío. */}
          {stage !== "empty" && (
            <Link href="/cobros" className={`${CARD} flex min-h-11 items-center gap-3 p-4 transition-colors hover:border-ink nav:px-5`}>
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

          {/* Recordatorios existentes (las cuatro categorías reales; la campana de arriba lleva al detalle) */}
          {remindersCount > 0 && (
            <SectionCard
              title="Recordatorios"
              count={remindersCount}
              action={
                <Link href="/recordatorios" className={linkClass()}>
                  Ver
                  <ArrowRightIcon className="h-4 w-4" aria-hidden />
                </Link>
              }
            >
              <ul>
                {data.remindersSummary.categories.map((category) => {
                  const { icon: Icon, tone } = REMINDER_ICONS[category.kind];
                  return (
                    <li key={category.kind} className="flex items-center gap-3 border-t border-border px-4 py-3 nav:px-5">
                      <Icon className="h-5 w-5 shrink-0 text-textSecondary" aria-hidden />
                      <p className="min-w-0 flex-1 text-[14.5px] font-[650]">{category.label}</p>
                      <Badge tone={tone}>{category.items.length}</Badge>
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}

        </div>
      </div>
    </div>
  );
}
