"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { CARD_TEXT_COLORS, MODALITY_LABELS, resolveLessonColors, STATUS_LABELS } from "@/lib/calendar-theme";
import { BarbellIcon } from "./barbell-icon";

// Colores de las tarjetas: SIEMPRE de `lib/calendar-theme.ts` (escala congelada del calendario). Este archivo sólo decide la
// forma (grilla de escritorio o fila de agenda) y los textos; el estado nunca depende sólo del color.

interface RealLessonCardProps {
  positioned: PositionedItem;
  isElapsed: boolean;
  isActiveReplacement: boolean;
  /** Empezó y todavía no terminó (según el reloj del navegador). */
  isInProgress?: boolean;
  onSelect: () => void;
}

/** Textos de estado de una tarjeta, iguales en la grilla y en la agenda. */
function stateParts(input: { item: CalendarViewItem; isElapsed: boolean; isActiveReplacement: boolean; isInProgress: boolean }): string[] {
  const { item, isElapsed, isActiveReplacement, isInProgress } = input;
  const isCancelled = item.status === "cancelled";
  const isTraining = item.activityKind === "training";
  const parts: string[] = [];
  if (item.status !== "scheduled") {
    parts.push(STATUS_LABELS[item.status]);
  } else if (isTraining) {
    parts.push("Entren.");
  }
  // El estado nunca depende sólo del color: reemplazo activo, clase en curso y clase ya transcurrida también se dicen con texto.
  const isElapsedActive = isElapsed && !isCancelled;
  if (isActiveReplacement && !isElapsed && !isCancelled) parts.push("Reemplazo");
  if (isInProgress && !isElapsed && !isCancelled) parts.push("En curso");
  if (isElapsedActive && item.status === "scheduled") parts.push("Pasada");
  return parts;
}

function ariaLabelOf(input: { title: string; timeLabel: string; durationMinutes: number; item: CalendarViewItem; isElapsed: boolean; isActiveReplacement: boolean; isInProgress: boolean }): string {
  const { title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress } = input;
  const isCancelled = item.status === "cancelled";
  const isElapsedActive = isElapsed && !isCancelled;
  return `${title}, ${timeLabel}, ${durationMinutes} minutos${isCancelled ? ", cancelada" : ""}${isActiveReplacement && !isCancelled && !isElapsed ? ", reemplazo" : ""}${isInProgress && !isElapsed && !isCancelled ? ", en curso" : ""}${isElapsedActive ? ", ya transcurrida" : ""}`;
}

function lessonTitle(item: CalendarViewItem): string {
  return item.title?.trim() || item.studentName || "Serie sin alumnos";
}

/**
 * Tarjeta de la grilla horaria (escritorio). El BLOQUE VISUAL (color, borde y alto) marca la hora y la duración reales; el
 * botón es la ZONA INTERACTIVA, de al menos 44 px de alto, que puede ser más alta que el bloque. Las clases que se tocan se
 * reparten en carriles (`lane`/`laneCount`): ninguna zona pisa a otra ni deja una clase sin acceso.
 */
export function RealLessonCard({ positioned, isElapsed, isActiveReplacement, isInProgress = false, onSelect }: RealLessonCardProps) {
  const { item, height, hitTop, hitHeight, blockOffset, lane, laneCount } = positioned;
  const colors = resolveLessonColors({ status: item.status, modality: item.modality, isElapsed, isActiveReplacement });
  const isCancelled = item.status === "cancelled";
  const isTraining = item.activityKind === "training";
  const start = new Date(item.start);
  const timeLabel = instantTimeLabel(item.start);
  const durationMinutes = Math.round((new Date(item.end).getTime() - start.getTime()) / 60_000);
  const title = lessonTitle(item);
  const stateTexts = stateParts({ item, isElapsed, isActiveReplacement, isInProgress });
  const metaParts = [timeLabel, ...stateTexts];

  const textColor = colors.textPrimary ?? CARD_TEXT_COLORS.primary;
  const secondaryColor = colors.textSecondary ?? CARD_TEXT_COLORS.secondary;
  const strike = isCancelled ? "line-through" : "none";
  // Cuánto texto entra en el bloque exacto: dos líneas, una línea, o (bloque muy corto) debajo de él, en la zona de toque.
  const layout = height >= 40 ? "two" : height >= 22 ? "one" : "below";
  const inset = laneCount === 1 ? 4 : 2;
  // Con varios carriles el ancho es corto: menos relleno y se corta sólo la palabra que no entra (nunca una que sí cabe).
  const padX = laneCount === 1 ? "px-2.5" : "px-1.5";
  const wrap = laneCount === 1 ? "[overflow-wrap:anywhere]" : "[overflow-wrap:break-word]";
  const fullInfo = `${title} · ${timeLabel}–${instantTimeLabel(item.end)} · ${MODALITY_LABELS[item.modality]}${stateTexts.length ? ` · ${stateTexts.join(" · ")}` : ""}`;
  const oneLineText = (
    <span className="block truncate text-[11px] font-bold leading-snug" style={{ color: textColor, textDecorationLine: strike }}>
      {title} · {metaParts.join(" · ")}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      data-grid-event
      data-lane={lane}
      data-lane-count={laneCount}
      className="group absolute text-left"
      style={{
        top: hitTop,
        height: hitHeight,
        left: `calc(${(lane * 100) / laneCount}% + ${inset}px)`,
        width: `calc(${100 / laneCount}% - ${inset * 2}px)`,
      }}
      aria-label={ariaLabelOf({ title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress })}
      title={fullInfo}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 overflow-hidden rounded-md border-[1.5px] shadow-subtle transition-[box-shadow,filter] duration-150 ease-premium group-hover:shadow-cardHover group-hover:brightness-95"
        style={{ top: blockOffset, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border }}
      />
      {layout === "two" && (
        <span className={`absolute inset-x-0 overflow-hidden ${padX} py-1`} style={{ top: blockOffset, height }}>
          <span className="flex items-start gap-1 text-[12px] font-bold leading-snug" style={{ color: textColor, textDecorationLine: strike }}>
            {isTraining && <BarbellIcon className="mt-0.5 h-3 w-3 shrink-0" />}
            <span className={`min-w-0 ${wrap}`}>{title}</span>
          </span>
          <span className="mt-0.5 block text-[11px] font-medium leading-snug" style={{ color: secondaryColor }}>
            {metaParts.join(" · ")}
          </span>
        </span>
      )}
      {layout === "one" && (
        <span className={`absolute inset-x-0 flex items-center overflow-hidden ${padX}`} style={{ top: blockOffset, height }}>
          {oneLineText}
        </span>
      )}
      {layout === "below" && (
        <span className="absolute inset-x-0 flex items-center overflow-hidden px-1" style={{ top: blockOffset + height + 1, bottom: 0 }}>
          {oneLineText}
        </span>
      )}
    </button>
  );
}

/** Fila de la agenda por día (móvil, 320–819 px): hora de inicio y fin, título, modalidad y estado en texto. Mínimo 56 px de alto. */
export function RealLessonAgendaRow({
  item,
  isElapsed,
  isActiveReplacement,
  isInProgress = false,
  onSelect,
}: {
  item: CalendarViewItem;
  isElapsed: boolean;
  isActiveReplacement: boolean;
  isInProgress?: boolean;
  onSelect: () => void;
}) {
  const colors = resolveLessonColors({ status: item.status, modality: item.modality, isElapsed, isActiveReplacement });
  const isCancelled = item.status === "cancelled";
  const isTraining = item.activityKind === "training";
  const start = new Date(item.start);
  const timeLabel = instantTimeLabel(item.start);
  const durationMinutes = Math.round((new Date(item.end).getTime() - start.getTime()) / 60_000);
  const title = lessonTitle(item);
  const metaParts = [`${timeLabel}–${instantTimeLabel(item.end)}`, MODALITY_LABELS[item.modality], ...stateParts({ item, isElapsed, isActiveReplacement, isInProgress })];

  return (
    <button
      type="button"
      onClick={onSelect}
      data-grid-event
      className="flex min-h-14 w-full flex-col justify-center rounded-md border-[1.5px] px-3.5 py-2.5 text-left shadow-subtle transition-[box-shadow,filter] duration-150 ease-premium hover:shadow-cardHover hover:brightness-95"
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
      aria-label={ariaLabelOf({ title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress })}
    >
      <span
        className="flex items-start gap-1.5 text-[15px] font-bold leading-snug"
        style={{ color: colors.textPrimary ?? CARD_TEXT_COLORS.primary, textDecorationLine: isCancelled ? "line-through" : "none" }}
      >
        {isTraining && <BarbellIcon className="mt-1 h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
      </span>
      <span className="mt-0.5 block text-[13px] font-medium leading-snug [overflow-wrap:anywhere]" style={{ color: colors.textSecondary ?? CARD_TEXT_COLORS.secondary }}>
        {metaParts.join(" · ")}
      </span>
    </button>
  );
}
