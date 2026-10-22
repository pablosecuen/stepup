"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import type { PlannedItem } from "@/lib/calendar/short-labels";
import { LABEL_FONT_PX } from "@/lib/calendar/short-labels";
import { CARD_TEXT_COLORS } from "@/lib/calendar-theme";
import type { CardTip } from "./real-lesson-card";

/**
 * Barra exacta + rótulo de una clase corta. La barra conserva la hora y la duración reales (sin altura mínima inventada) y lleva sólo el número de asociación cuando hay
 * simultáneas; el rótulo lleva el mismo número, la hora, el estado y el nombre en letra de 11 px. El rótulo es sólo visual (`aria-hidden`): el nombre accesible lo da la barra, que es el botón.
 */
export function ShortBar({
  positioned,
  planned,
  colors,
  ariaLabel,
  tipText,
  onSelect,
  onTip,
  describedBy,
}: {
  positioned: PositionedItem;
  planned: PlannedItem;
  colors: { bg: string; border: string; textPrimary?: string | null };
  ariaLabel: string;
  tipText: string;
  onSelect: () => void;
  onTip?: (tip: CardTip | null) => void;
  describedBy?: string;
}) {
  const { height, hitTop, hitHeight, blockOffset } = positioned;
  const showNumber = planned.number !== null && planned.barWidth >= 12;
  const tipId = `calendar-tip-${positioned.item.id}`;
  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    onTip?.({ id: tipId, text: tipText, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
  };
  return (
    <button
      type="button"
      onClick={() => {
        onTip?.(null);
        onSelect();
      }}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => onTip?.(null)}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget);
      }}
      onBlur={() => onTip?.(null)}
      data-grid-event
      data-presentation="bar"
      data-short-bar={positioned.item.id}
      className="group absolute min-w-0 text-left"
      style={{ top: hitTop, height: hitHeight, left: planned.barLeft, width: planned.barWidth }}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 flex items-center justify-center overflow-hidden rounded-[3px] border shadow-subtle transition-[filter] duration-150 group-hover:brightness-95"
        style={{ top: blockOffset, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border }}
      >
        {showNumber && (
          <span className="text-[9px] font-extrabold leading-none" style={{ color: colors.textPrimary ?? CARD_TEXT_COLORS.primary }}>
            {planned.number}
          </span>
        )}
      </span>
    </button>
  );
}

export function ShortLabel({
  planned,
  colors,
  title,
  timeText,
  stateText,
  strike,
  onSelect,
}: {
  planned: PlannedItem;
  colors: { bg: string; border: string; textPrimary?: string | null; textSecondary?: string | null };
  title: string;
  timeText: string;
  stateText: string | null;
  strike: boolean;
  onSelect: () => void;
}) {
  const { label } = planned;
  const text = colors.textPrimary ?? CARD_TEXT_COLORS.primary;
  const secondary = colors.textSecondary ?? CARD_TEXT_COLORS.secondary;
  return (
    // Un <div> y no un <button>: el rótulo es sólo visual (aria-hidden, sin foco) y los botones tienen 44 px de alto mínimo por regla global; el botón accesible es la barra.
    <div
      aria-hidden="true"
      onClick={onSelect}
      data-short-label={planned.id}
      className="absolute flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-[3px] border-l-[3px] pl-1 pr-0.5 text-left"
      style={{ left: label.x, top: label.y, width: label.width, height: label.height, backgroundColor: colors.bg, borderColor: colors.border, fontSize: LABEL_FONT_PX, lineHeight: `${label.height}px` }}
    >
      {planned.number !== null && (
        <span className="inline-flex h-[11px] min-w-[11px] shrink-0 items-center justify-center rounded-[3px] text-[9px] font-extrabold leading-none" style={{ border: `1px solid ${colors.border}`, color: text }}>
          {planned.number}
        </span>
      )}
      <span className="shrink-0 font-semibold tf-num" style={{ color: secondary, fontSize: LABEL_FONT_PX - 1 }}>
        {timeText}
      </span>
      {stateText && (
        <span className="shrink-0 font-extrabold" style={{ color: text, fontSize: LABEL_FONT_PX - 1 }}>
          {stateText}
        </span>
      )}
      <span className="min-w-0 truncate font-bold" style={{ color: text, textDecorationLine: strike ? "line-through" : "none" }}>
        {title}
      </span>
    </div>
  );
}
