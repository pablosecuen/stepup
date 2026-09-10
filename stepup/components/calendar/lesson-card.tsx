"use client";

import type { PositionedLesson } from "@/lib/calendar-layout";
import { resolveLessonColors, STATUS_LABELS } from "@/lib/calendar-theme";
import { BarbellIcon } from "./barbell-icon";

interface LessonCardProps {
  positioned: PositionedLesson;
  start: Date;
  isElapsed: boolean;
  isActiveReplacement: boolean;
  onSelect: () => void;
}

export function LessonCard({ positioned, start, isElapsed, isActiveReplacement, onSelect }: LessonCardProps) {
  const { lesson, top, height, leftPercent, widthPercent } = positioned;
  const colors = resolveLessonColors({
    status: lesson.status,
    modality: lesson.modality,
    isElapsed,
    isActiveReplacement,
  });
  const isCancelled = lesson.status === "cancelled";
  const timeLabel = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const showStatusLabel = lesson.status !== "scheduled";
  const isNarrow = widthPercent < 60;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      style={{
        top,
        height,
        left: `calc(${leftPercent}% + 1px)`,
        width: `calc(${widthPercent}% - 2px)`,
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
      aria-label={`${lesson.title}, ${timeLabel}, ${lesson.durationMinutes} minutos${isCancelled ? ", cancelada" : ""}`}
    >
      <span
        className="flex items-center gap-1 text-[11px] font-bold leading-tight"
        style={{ color: colors.textPrimary ?? colors.border, textDecorationLine: isCancelled ? "line-through" : "none" }}
      >
        {lesson.activityKind === "training" && <BarbellIcon className="h-2.5 w-2.5 shrink-0" />}
        <span className="truncate">{isNarrow ? lesson.title.split(" ")[0] : lesson.title}</span>
      </span>
      <span
        className="block text-[10px] font-medium leading-tight"
        style={{ color: colors.textSecondary ?? colors.border }}
      >
        {timeLabel}
        {showStatusLabel ? ` · ${STATUS_LABELS[lesson.status]}` : ""}
      </span>
    </button>
  );
}
