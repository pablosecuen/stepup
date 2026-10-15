"use client";

import { useState } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { RealLessonDetailModal } from "@/components/calendar/real-lesson-detail-modal";
import { avatarToneFor } from "@/lib/ui/avatar-tone";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { STATUS_LABELS } from "@/lib/calendar-theme";
import { formatInstantTime } from "@/lib/format/date-format";
import { getCancelledSlotReuseDecision } from "@/lib/calendar/mutations";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import type { TodayAgendaEntry } from "@/lib/dashboard/today-agenda";
import { agendaLessonLabel } from "@/lib/dashboard/lesson-label";

/** Avatar de una clase: la inicial del alumno (individual) o un ícono (grupal o sin alumnos). Decorativo: el nombre va al lado en texto. */
export function LessonAvatar({ item }: { item: CalendarViewItem }) {
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

interface StateBadge {
  label: string;
  tone: BadgeTone;
  dot?: boolean;
}

/** Estados REALES de una clase (nunca inventados): el de la clase (cancelada, reprogramada, completada) y su relación con el reloj. */
function stateBadges(entry: TodayAgendaEntry, isNext: boolean): StateBadge[] {
  const { item, timing } = entry;
  const badges: StateBadge[] = [];
  if (item.status === "cancelled") return [{ label: STATUS_LABELS.cancelled, tone: "warn" }];
  if (item.status === "rescheduled") badges.push({ label: STATUS_LABELS.rescheduled, tone: "neutral" });
  if (item.status === "completed") badges.push({ label: STATUS_LABELS.completed, tone: "ok" });
  if (timing === "in_progress") badges.push({ label: "En curso", tone: "accent", dot: true });
  else if (timing === "upcoming" && isNext) badges.push({ label: "Sigue", tone: "warn" });
  else if (timing === "finished" && item.status !== "completed") badges.push({ label: "Pasada", tone: "neutral" });
  return badges;
}

/**
 * «Clases de hoy»: TODAS las clases del día, de la primera a la última y en orden cronológico (sin límite ni «Ver todas»). Cada fila
 * completa es un botón que abre el detalle de la clase del Calendario (`RealLessonDetailModal`, con las mismas acciones); la hora, el
 * alumno o título, la modalidad y el estado salen de lo ya cargado. La escala de estados es la del Calendario: una cancelada se
 * tacha y se dice «Cancelada», lo transcurrido dice «Pasada», lo que está sucediendo «En curso» y la siguiente «Sigue».
 */
export function TodayAgenda({ entries, allItems, nowIso, nextId }: { entries: readonly TodayAgendaEntry[]; allItems: CalendarViewItem[]; nowIso: string; nextId: string | null }) {
  const [selected, setSelected] = useState<CalendarViewItem | null>(null);
  const now = new Date(nowIso);

  return (
    <>
      <ul data-today-agenda>
        {entries.map((entry) => {
          const { item } = entry;
          const isNext = nextId === item.id;
          const badges = stateBadges(entry, isNext);
          const live = entry.timing === "in_progress" && item.status !== "cancelled";
          const cancelled = item.status === "cancelled";
          const finished = entry.timing === "finished" && !cancelled;
          return (
            <li key={item.id} className="border-t border-border first:border-t-0">
              <button
                type="button"
                onClick={() => setSelected(item)}
                aria-haspopup="dialog"
                className={`grid min-h-14 w-full grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-surface2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink motion-reduce:transition-none nav:grid-cols-[78px_minmax(0,1fr)_auto] nav:gap-x-4 nav:px-5 ${live ? "bg-accentSoft hover:bg-accentSoft" : ""}`}
              >
                <span className={`font-display text-[19px] font-semibold leading-none tf-num nav:text-[21px] ${finished || cancelled ? "text-textSecondary" : ""}`}>
                  {formatInstantTime(item.start)}
                  <span className="mt-1 block font-sans text-[12.5px] font-medium text-textMuted">
                    <span className="sr-only">hasta </span>
                    {formatInstantTime(item.end)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <LessonAvatar item={item} />
                  <span className="min-w-0">
                    <span className={`block font-display text-[17px] font-semibold leading-tight [overflow-wrap:anywhere] nav:text-[18px] ${cancelled ? "text-textSecondary line-through" : finished ? "text-textSecondary" : ""}`}>
                      {agendaLessonLabel(item)}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] text-textMuted">{MODALITY_LABEL[item.modality]}</span>
                  </span>
                </span>
                {badges.length > 0 && (
                  <span className="col-start-2 flex flex-wrap items-center gap-1.5 justify-self-start nav:col-start-auto nav:justify-self-end">
                    {badges.map((badge) => (
                      <Badge key={badge.label} tone={badge.tone} dot={badge.dot}>
                        {badge.label}
                      </Badge>
                    ))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <RealLessonDetailModal item={selected} canReuseSlot={getCancelledSlotReuseDecision(selected, allItems, now).eligible} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
