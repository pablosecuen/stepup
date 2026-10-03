"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { resolveLessonColors, STATUS_LABELS } from "@/lib/calendar-theme";
import { BarbellIcon } from "./barbell-icon";

interface RealLessonCardProps {
  positioned: PositionedItem;
  isElapsed: boolean;
  isActiveReplacement: boolean;
  onSelect: () => void;
}

export function RealLessonCard({ positioned, isElapsed, isActiveReplacement, onSelect }: RealLessonCardProps) {
  const { item, top, height } = positioned;
  const colors = resolveLessonColors({ status: item.status, modality: item.modality, isElapsed, isActiveReplacement });
  const isCancelled = item.status === "cancelled";
  const isTraining = item.activityKind === "training";
  const start = new Date(item.start);
  const timeLabel = instantTimeLabel(item.start);
  const durationMinutes = Math.round((new Date(item.end).getTime() - start.getTime()) / 60_000);
  const title = item.title?.trim() || item.studentName || "Serie sin alumnos";

  const metaParts = [timeLabel];
  if (item.status !== "scheduled") {
    metaParts.push(STATUS_LABELS[item.status]);
  } else if (isTraining) {
    metaParts.push("Entren.");
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="absolute inset-x-1 rounded-md border px-2.5 py-1.5 text-left shadow-subtle transition-all duration-150 ease-premium hover:z-10 hover:shadow-cardHover hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      style={{ top, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border }}
      aria-label={`${title}, ${timeLabel}, ${durationMinutes} minutos${isCancelled ? ", cancelada" : ""}`}
    >
      <span
        className="flex items-start gap-1 text-[11px] font-bold leading-snug"
        style={{ color: colors.textPrimary ?? colors.border, textDecorationLine: isCancelled ? "line-through" : "none" }}
      >
        {isTraining && <BarbellIcon className="mt-0.5 h-2.5 w-2.5 shrink-0" />}
        <span>{title}</span>
      </span>
      <span className="mt-0.5 block text-[10px] font-medium leading-snug" style={{ color: colors.textSecondary ?? colors.border }}>
        {metaParts.join(" · ")}
      </span>
    </button>
  );
}
