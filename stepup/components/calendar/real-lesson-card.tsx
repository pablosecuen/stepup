"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { CARD_TEXT_COLORS, resolveLessonColors, STATUS_LABELS } from "@/lib/calendar-theme";
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
  // El estado nunca depende sólo del color: reemplazo activo y clase ya transcurrida también se dicen con texto.
  const isElapsedActive = isElapsed && !isCancelled;
  if (isActiveReplacement && !isElapsed && !isCancelled) metaParts.push("Reemplazo");
  if (isElapsedActive && item.status === "scheduled") metaParts.push("Pasada");

  return (
    <button
      type="button"
      onClick={onSelect}
      data-grid-event
      className="absolute inset-x-1 rounded-md border px-2.5 py-1.5 text-left shadow-subtle transition-all duration-150 ease-premium hover:z-10 hover:shadow-cardHover hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      style={{ top, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border }}
      aria-label={`${title}, ${timeLabel}, ${durationMinutes} minutos${isCancelled ? ", cancelada" : ""}${isActiveReplacement && !isCancelled && !isElapsed ? ", reemplazo" : ""}${isElapsedActive ? ", ya transcurrida" : ""}`}
    >
      <span
        className="flex items-start gap-1 text-[11px] font-bold leading-snug"
        style={{ color: colors.textPrimary ?? CARD_TEXT_COLORS.primary, textDecorationLine: isCancelled ? "line-through" : "none" }}
      >
        {isTraining && <BarbellIcon className="mt-0.5 h-2.5 w-2.5 shrink-0" />}
        <span>{title}</span>
      </span>
      <span className="mt-0.5 block text-[10px] font-medium leading-snug" style={{ color: colors.textSecondary ?? CARD_TEXT_COLORS.secondary }}>
        {metaParts.join(" · ")}
      </span>
    </button>
  );
}
