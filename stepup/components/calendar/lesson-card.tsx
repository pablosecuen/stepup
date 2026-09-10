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
  const isTraining = lesson.activityKind === "training";
  const timeLabel = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const metaParts = [timeLabel];
  if (isTraining) metaParts.push("Entren.");
  if (lesson.status !== "scheduled") metaParts.push(STATUS_LABELS[lesson.status]);

  return (
    <button
      type="button"
      onClick={onSelect}
      // Sin overflow-hidden ni truncate: el nombre completo siempre es
      // visible, envolviendo a más de una línea si hace falta — nunca "...".
      // minHeight (no height fijo) deja que la tarjeta crezca si el
      // contenido lo necesita, para no cortar un eventual tercer renglón.
      className="absolute rounded-md border px-2 py-1.5 text-left shadow-subtle transition-all duration-150 ease-premium hover:z-10 hover:shadow-cardHover hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      style={{
        top,
        minHeight: height,
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
      aria-label={`${lesson.title}, ${timeLabel}, ${lesson.durationMinutes} minutos${isCancelled ? ", cancelada" : ""}`}
    >
      <span
        className="flex items-start gap-1 text-[11px] font-bold leading-snug"
        style={{ color: colors.textPrimary ?? colors.border, textDecorationLine: isCancelled ? "line-through" : "none" }}
      >
        {isTraining && <BarbellIcon className="mt-0.5 h-2.5 w-2.5 shrink-0" />}
        <span className="break-words">{lesson.title}</span>
      </span>
      <span
        className="mt-0.5 block text-[10px] font-medium leading-snug"
        style={{ color: colors.textSecondary ?? colors.border }}
      >
        {metaParts.join(" · ")}
      </span>
    </button>
  );
}
