"use client";

import type { PositionedItem } from "@/lib/calendar/layout";
import type { MobileCardText } from "@/lib/calendar/mobile-short-labels";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { resolveLessonColors } from "@/lib/calendar-theme";
import { ariaLabelOf, lessonTitle, type CardTip } from "./real-lesson-card";

/** Ancho máximo de una tarjeta de la vista Día en el teléfono: no se extiende por todo el ancho disponible. */
export const MOBILE_DAY_CARD_MAX_WIDTH_PX = 244;

/**
 * Tarjeta del teléfono. El bloque conserva la hora y la duración exactas y su zona táctil (`hitTop`/`hitHeight`, el mismo mecanismo que la tarjeta de escritorio). Sólo se dibuja con un `text` que
 * YA entra en el bloque (lo decide `planMobileDay`): el nombre en palabras completas, sin recortes; si no entra, la clase se dibuja como barra + rótulo. La hora no se repite: está en la columna horaria.
 */
export function MobileCalendarCard({ positioned, text, dayView, isElapsed, isActiveReplacement, isInProgress, onSelect, onTip, describedBy }: {
  positioned: PositionedItem; text: MobileCardText; dayView: boolean;
  isElapsed: boolean; isActiveReplacement: boolean; isInProgress: boolean;
  onSelect: () => void; onTip?: (tip: CardTip | null) => void; describedBy?: string;
}) {
  const { item, lane, laneCount, height, hitTop, hitHeight, blockOffset } = positioned;
  const title = lessonTitle(item);
  const colors = resolveLessonColors({ status: item.status, modality: item.modality, isElapsed, isActiveReplacement });
  const maxWidth = dayView && laneCount === 1 ? MOBILE_DAY_CARD_MAX_WIDTH_PX : undefined;
  const isGroup = item.participantIds.length > 1 || item.lessonType === "group";
  // Los grupos («PET A») van siempre centrados; en la vista Día los nombres de una clase individual se alinean a la izquierda.
  const alignment = dayView && !isGroup ? "items-start text-left" : "items-center text-center";
  const durationMinutes = Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000);
  const label = ariaLabelOf({ title, timeLabel: instantTimeLabel(item.start), durationMinutes, item, isElapsed, isActiveReplacement, isInProgress });
  const notHeld = item.status === "cancelled" || (item.status === "completed" && Boolean(item.closedOutcome));
  function tip(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    onTip?.({ id: `calendar-tip-${item.id}`, text: label, rect });
  }
  return <button type="button" data-grid-event data-mobile-calendar-card data-lane={lane} data-lane-count={laneCount}
    aria-label={label} aria-describedby={describedBy}
    className="group absolute min-w-0 text-center"
    style={{ top: hitTop, height: hitHeight, left: `calc(${lane * 100 / laneCount}% + 2px)`, width: `calc(${100 / laneCount}% - 4px)`, maxWidth }}
    onClick={() => { onTip?.(null); onSelect(); }} onMouseEnter={event => tip(event.currentTarget)} onMouseLeave={() => onTip?.(null)}
    onFocus={event => { if (event.currentTarget.matches(":focus-visible")) tip(event.currentTarget); }} onBlur={() => onTip?.(null)}>
    <span aria-hidden="true" lang="es" className={`absolute inset-x-0 flex flex-col justify-center overflow-hidden rounded-[7px] border ${alignment} ${dayView ? "px-2" : "px-0.5"}`}
      style={{ top: blockOffset, height, backgroundColor: colors.bg, borderColor: colors.border, color: colors.textPrimary, fontSize: text.fontPx, lineHeight: `${text.lineHeightPx}px`, fontWeight: 600 }}>
      {text.state && <span className="whitespace-nowrap font-extrabold" style={{ fontSize: text.fontPx - 1 }}>{text.state}</span>}
      {text.lines.map((line, index) => <span key={index} className="whitespace-nowrap" style={{ textDecorationLine: item.status === "cancelled" ? "line-through" : undefined }}>{line}</span>)}
      {notHeld && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]" style={{ backgroundImage: `repeating-linear-gradient(135deg, ${colors.border} 0 2px, transparent 2px 4px)` }} />}
    </span>
  </button>;
}
