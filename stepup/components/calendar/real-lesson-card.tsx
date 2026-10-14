"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import { cardInsetPx, cardPresentation, cardWidthPx } from "@/lib/calendar/layout";
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
  /** Ancho real de la columna del día (px): con él y el alto del bloque se decide cuánto texto entra (`cardPresentation`). */
  columnWidthPx: number;
  onSelect: () => void;
  /** Tooltip con la información completa: al pasar el puntero o enfocar con el teclado (la grilla lo dibuja una sola vez). */
  onTip?: (tip: CardTip | null) => void;
  /** Id del tooltip visible de ESTA tarjeta (aria-describedby). */
  describedBy?: string;
}

export interface CardTip {
  id: string;
  text: string;
  rect: { left: number; top: number; bottom: number };
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
 *
 * El texto se adapta al tamaño real del bloque (`cardPresentation`): título y datos, sólo el título con elipsis, o un bloque de
 * color sin texto. Nunca se agranda el bloque ni se mueve la clase para hacer entrar texto, y nada se sale del bloque (todo va
 * dentro de un contenedor con `overflow-hidden` y cada línea se trunca). El nombre accesible es siempre el completo, y la información
 * completa se ve al pasar el puntero o enfocar con el teclado (tooltip).
 */
export function RealLessonCard({ positioned, isElapsed, isActiveReplacement, isInProgress = false, columnWidthPx, onSelect, onTip, describedBy }: RealLessonCardProps) {
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
  const inset = cardInsetPx(laneCount);
  const presentation = cardPresentation({ heightPx: height, widthPx: cardWidthPx(columnWidthPx, laneCount) });
  const padX = laneCount === 1 ? "px-2.5" : "px-1.5";
  const fullInfo = `${title} · ${timeLabel}–${instantTimeLabel(item.end)} · ${MODALITY_LABELS[item.modality]}${stateTexts.length ? ` · ${stateTexts.join(" · ")}` : ""}`;
  const tipId = `calendar-tip-${item.id}`;

  function showTip(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    onTip?.({ id: tipId, text: fullInfo, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
  }

  return (
    <button
      type="button"
      onClick={() => {
        onTip?.(null);
        onSelect();
      }}
      onMouseEnter={(event) => showTip(event.currentTarget)}
      onMouseLeave={() => onTip?.(null)}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) showTip(event.currentTarget);
      }}
      onBlur={() => onTip?.(null)}
      data-grid-event
      data-lane={lane}
      data-lane-count={laneCount}
      data-presentation={presentation}
      className="group absolute min-w-0 text-left"
      style={{
        top: hitTop,
        height: hitHeight,
        left: `calc(${(lane * 100) / laneCount}% + ${inset}px)`,
        width: `calc(${100 / laneCount}% - ${inset * 2}px)`,
      }}
      aria-label={ariaLabelOf({ title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress })}
      aria-describedby={describedBy}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 min-w-0 overflow-hidden rounded-md border-[1.5px] shadow-subtle transition-[box-shadow,filter] duration-150 ease-premium group-hover:shadow-cardHover group-hover:brightness-95 motion-reduce:transition-none"
        style={{ top: blockOffset, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border }}
      >
        {presentation === "full" && (
          <span className={`flex h-full min-w-0 flex-col justify-center overflow-hidden ${padX}`}>
            <span className="flex min-w-0 items-center gap-1 text-[12px] font-bold leading-snug" style={{ color: textColor, textDecorationLine: strike }}>
              {isTraining && <BarbellIcon className="h-3 w-3 shrink-0" />}
              <span className="min-w-0 truncate">{title}</span>
            </span>
            <span className="mt-0.5 block min-w-0 truncate text-[11px] font-medium leading-snug" style={{ color: secondaryColor }}>
              {metaParts.join(" · ")}
            </span>
          </span>
        )}
        {presentation === "title" && (
          <span className={`flex h-full min-w-0 items-center overflow-hidden ${padX}`}>
            <span className="block min-w-0 truncate text-[11px] font-bold leading-none" style={{ color: textColor, textDecorationLine: strike }}>
              {title}
            </span>
          </span>
        )}
      </span>
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
