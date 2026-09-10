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
  const { lesson, top, height } = positioned;
  const colors = resolveLessonColors({
    status: lesson.status,
    modality: lesson.modality,
    isElapsed,
    isActiveReplacement,
  });
  const isCancelled = lesson.status === "cancelled";
  const isTraining = lesson.activityKind === "training";
  const timeLabel = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  // Prioridad de la línea secundaria — igual que el Day view de móvil
  // (CalendarLessonCard.tsx): si hay un estado que no es "programada" ese
  // estado reemplaza cualquier otra etiqueta; si no, y es entrenamiento, se
  // indica "Entren."; el ícono de mancuerna junto al nombre es aparte y
  // siempre se muestra para entrenamiento, sin importar el estado.
  const metaParts = [timeLabel];
  if (lesson.status !== "scheduled") {
    metaParts.push(STATUS_LABELS[lesson.status]);
  } else if (isTraining) {
    metaParts.push("Entren.");
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      // Siempre el ancho completo de la columna del día (corrección
      // 2026-09-10: se eliminó el diseño de carriles paralelos). Alto fijo
      // (no minHeight): layoutDayLessons ya lo acota al hueco real hasta la
      // próxima clase, así nunca invade la siguiente tarjeta. Sin
      // overflow-hidden ni truncate — el nombre completo queda visible,
      // envolviendo con el wrap normal del navegador (nunca "...", nunca
      // rotura de palabra).
      className="absolute inset-x-1 rounded-md border px-2.5 py-1.5 text-left shadow-subtle transition-all duration-150 ease-premium hover:z-10 hover:shadow-cardHover hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      style={{
        top,
        height,
        boxSizing: "border-box",
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
        <span>{lesson.title}</span>
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
