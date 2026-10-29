"use client";

import { Fragment, useState } from "react";
import { ArrowRightIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { RealLessonDetailModal } from "@/components/calendar/real-lesson-detail-modal";

import { MODALITY_LABEL } from "@/lib/students/constants";
import { lessonStatusLabel, STATUS_LABELS } from "@/lib/calendar-theme";
import { formatInstantTime } from "@/lib/format/date-format";
import { getCancelledSlotReuseDecision } from "@/lib/calendar/mutations";
import { agendaLessonLabel } from "@/lib/dashboard/lesson-label";
import { formatStartsIn } from "@/lib/dashboard/day-format";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import type { TodayAgendaEntry } from "@/lib/dashboard/today-agenda";

interface StateBadge {
  label: string;
  tone: BadgeTone;
  dot?: boolean;
}

/** Estados REALES de una clase (nunca inventados): el de la clase (cancelada, reprogramada, completada) y su relación con el reloj. */
function stateBadges(entry: TodayAgendaEntry, isNext: boolean): StateBadge[] {
  const { item, timing } = entry;
  if (item.status === "cancelled") return [{ label: STATUS_LABELS.cancelled, tone: "warn" }];
  const badges: StateBadge[] = [];
  if (item.status === "rescheduled") badges.push({ label: STATUS_LABELS.rescheduled, tone: "neutral" });
  if (item.status === "completed") badges.push({ label: lessonStatusLabel(item), tone: item.closedOutcome ? "neutral" : "ok" });
  if (timing === "in_progress") badges.push({ label: "En curso", tone: "accent", dot: true });
  else if (timing === "upcoming" && isNext) badges.push({ label: "Sigue", tone: "warn" });
  else if (timing === "finished" && item.status !== "completed") badges.push({ label: "Pasada", tone: "neutral" });
  return badges;
}

/** Grupos de clases con el MISMO inicio (simultáneas): la hora se dice una vez y las filas se apilan. */
function groupByStart(entries: readonly TodayAgendaEntry[]): TodayAgendaEntry[][] {
  const groups: TodayAgendaEntry[][] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last[0].item.start === entry.item.start) last.push(entry);
    else groups.push([entry]);
  }
  return groups;
}


/**
 * Próxima clase (franja compacta, ≈ 120 px) y «Tu día» (línea de tiempo vertical con TODAS las clases del día, de la primera a la
 * última). Ambos abren el detalle existente de la clase del Calendario. Estados reales; las simultáneas comparten hora; una marca
 * «Ahora» separa lo que ya pasó de lo que sigue. Sin animaciones constantes: sólo la entrada suave y el hover.
 */
export function DayPlanner({
  entries,
  allItems,
  nowIso,
  next,
}: {
  entries: readonly TodayAgendaEntry[];
  allItems: CalendarViewItem[];
  nowIso: string;
  next: { item: CalendarViewItem; timing: "in_progress" | "upcoming" } | null;
}) {
  const [selected, setSelected] = useState<CalendarViewItem | null>(null);
  const now = new Date(nowIso);
  const groups = groupByStart(entries);
  const firstOpenIndex = entries.findIndex((entry) => entry.timing !== "finished");
  const nowLabel = formatInstantTime(nowIso);

  return (
    <>
      {/* Próxima clase */}
      {next ? (
        <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSelected(next.item)}
          aria-haspopup="dialog"
          data-enter="2"
          className={`tf-enter group flex min-h-[112px] w-full items-center justify-between gap-4 rounded-xl bg-side px-5 py-4 text-left text-white shadow-card transition-colors duration-200 hover:bg-side2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 nav:px-6`}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-sideText">
              {next.timing === "in_progress" && <span aria-hidden className="h-2 w-2 rounded-pill bg-sideAccent" />}
              {next.timing === "in_progress" ? "Clase en curso" : "Próxima clase"}
            </span>
            <span className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <span className="font-display text-[34px] font-medium leading-none tracking-tight tf-num">{formatInstantTime(next.item.start)}</span>
              <span className="min-w-0 font-display text-[21px] font-semibold leading-tight [overflow-wrap:anywhere]">{agendaLessonLabel(next.item)}</span>
            </span>
            <span className="mt-1.5 block text-[14px] text-sideText">
              {MODALITY_LABEL[next.item.modality]} · {next.timing === "in_progress" ? `Termina a las ${formatInstantTime(next.item.end)}` : formatStartsIn(new Date(next.item.start).getTime(), now.getTime())}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[14px] font-[650] text-white">
            Ver detalle
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </span>
        </button>
        </div>
      ) : (
        <div data-enter="2" className={`tf-enter flex min-h-[72px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-[1.5px] border-dashed border-borderMid px-5 py-3.5`}>
          <p className="text-[15px] text-textSecondary">{entries.length === 0 ? "No hay clases agendadas para hoy." : "No tenés más clases hoy."}</p>
          <PrivateLink href="/calendario" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-[650] text-accentDark hover:underline">
            <CalendarDaysIcon className="h-4 w-4" aria-hidden />
            Ver Calendario
          </PrivateLink>
        </div>
      )}

      {/* Tu día (sin clases, la franja de arriba ya lo dice: no se repite en una segunda caja) */}
      {entries.length > 0 && (
      <section aria-labelledby="tu-dia" data-enter="2" className={`tf-enter rounded-xl border-[1.5px] border-border bg-surface shadow-card`}>
        <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4 nav:px-6">
          <h2 id="tu-dia" className="font-display text-[24px] font-semibold leading-tight tracking-tight">
            Tu día
          </h2>
          <p className="text-[13px] font-medium text-textMuted tf-num">{entries.length === 1 ? "1 clase" : `${entries.length} clases`}</p>
        </div>
        {(
          <ol data-today-agenda className="relative pb-2">
            <span aria-hidden className="absolute bottom-2 left-[6.5rem] top-2 w-px bg-border nav:left-[6.75rem]" />
            {(() => {
              let index = 0;
              return groups.map((group) => (
                <Fragment key={group[0].item.id}>
                  {group.map((entry, position) => {
                    const here = index++;
                    const { item } = entry;
                    const isNext = next?.item.id === item.id;
                    const badges = stateBadges(entry, isNext);
                    const cancelled = item.status === "cancelled";
                    const live = entry.timing === "in_progress" && !cancelled;
                    const finished = entry.timing === "finished" && !cancelled;
                    return (
                      <Fragment key={item.id}>
                        {here === firstOpenIndex && <NowMarker label={nowLabel} />}
                        <li className="relative">
                          <button
                            type="button"
                            onClick={() => setSelected(item)}
                            aria-haspopup="dialog"
                            className={`grid min-h-14 w-full grid-cols-[4.25rem_1rem_minmax(0,1fr)] items-center gap-x-2 px-5 py-2.5 text-left transition-colors duration-200 hover:bg-surface2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink motion-reduce:transition-none nav:px-6 ${live ? "bg-accentSoft/60 hover:bg-accentSoft" : ""}`}
                          >
                            <span className={`text-right font-display text-[19px] font-semibold leading-none tf-num ${finished || cancelled ? "text-textSecondary" : "text-textPrimary"}`}>
                              {position === 0 ? (
                                <>
                                  {formatInstantTime(item.start)}
                                  <span className="mt-1 block font-sans text-[12px] font-medium text-textMuted">
                                    <span className="sr-only">hasta </span>
                                    {formatInstantTime(item.end)}
                                  </span>
                                </>
                              ) : (
                                <span className="sr-only">
                                  {formatInstantTime(item.start)} hasta {formatInstantTime(item.end)}, a la misma hora
                                </span>
                              )}
                            </span>
                            <span aria-hidden className="relative z-10 flex justify-center">
                              <span
                                className={`h-[11px] w-[11px] rounded-pill border-2 ${
                                  live ? "border-accent bg-accent ring-4 ring-accent/20" : finished ? "border-borderStrong bg-borderStrong" : cancelled ? "border-borderStrong bg-surface" : "border-ink bg-surface"
                                }`}
                              />
                            </span>
                            <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                              <span className="min-w-0">
                                <span className={`block font-display text-[18px] font-semibold leading-tight [overflow-wrap:anywhere] ${cancelled ? "text-textSecondary line-through" : finished ? "text-textSecondary" : ""}`}>
                                  {agendaLessonLabel(item)}
                                </span>
                                <span className="mt-0.5 block text-[13.5px] text-textMuted">
                                  {MODALITY_LABEL[item.modality]}
                                  {position > 0 && <span> · a la misma hora que la anterior</span>}
                                </span>
                              </span>
                              {badges.length > 0 && (
                                <span className="flex flex-wrap items-center gap-1.5">
                                  {badges.map((badge) => (
                                    <span key={badge.label} className={badge.label === "En curso" ? "tf-current-class" : undefined}><Badge tone={badge.tone} dot={badge.dot}>
                                      {badge.label}
                                    </Badge></span>
                                  ))}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      </Fragment>
                    );
                  })}
                </Fragment>
              ));
            })()}
            {firstOpenIndex === -1 && <NowMarker label={nowLabel} />}
          </ol>
        )}
      </section>
      )}


      {selected && <RealLessonDetailModal item={selected} canReuseSlot={getCancelledSlotReuseDecision(selected, allItems, now).eligible} onClose={() => setSelected(null)} />}
    </>
  );
}

/** Marca «Ahora» entre lo que ya pasó y lo que sigue (informativa: no es interactiva). */
function NowMarker({ label }: { label: string }) {
  return (
    <li aria-label={`Ahora, ${label}`} className="relative z-10 grid grid-cols-[4.25rem_1rem_minmax(0,1fr)] items-center gap-x-2 px-5 py-1 nav:px-6">
      <span className="text-right text-[12px] font-bold uppercase tracking-[0.08em] text-accentDark tf-num">Ahora</span>
      <span aria-hidden className="flex justify-center">
        <span className="h-[7px] w-[7px] rounded-pill bg-accent" />
      </span>
      <span aria-hidden className="flex items-center gap-2 text-[12px] font-medium text-accentDark tf-num">
        {label}
        <span className="h-px flex-1 bg-accent/40" />
      </span>
    </li>
  );
}
