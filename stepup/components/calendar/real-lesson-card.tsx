"use client";

import { NoSymbolIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import type { PositionedItem } from "@/lib/calendar/layout";
import { cardInsetPx, cardPresentation, cardWidthPx, microFontPx } from "@/lib/calendar/layout";
import { estimateBoldTextWidthPx, firstWord, INLINE_META_FONT_PX, inlineMetaNeedPx, LANE_MAX_WITH_META_PX, mobileNameFontPx, SINGLE_LINE_ICON_PX, mobileNameWords, narrowMeta, nameForWidth, TWO_NAME_LINES_MIN_HEIGHT_PX, wideMeta } from "@/lib/calendar/card-text";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { CARD_TEXT_COLORS, lessonStatusLabel, MODALITY_LABELS, resolveLessonColors } from "@/lib/calendar-theme";
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
  mobile?: boolean;
  dayRow?: boolean;
  /** Propuesta de rótulos: ancho (px) al que se angosta esta clase larga para no tapar un rótulo. */
  widthOverridePx?: number;
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
    parts.push(lessonStatusLabel(item));
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

/** Estado de una clase completada que no se dictó (cancelada tarde, ausente, feriado), para el nombre accesible. */
function closedSuffix(item: CalendarViewItem): string {
  return item.status === "completed" && item.closedOutcome ? ", " + lessonStatusLabel(item).toLowerCase() : "";
}

export function ariaLabelOf(input: { title: string; timeLabel: string; durationMinutes: number; item: CalendarViewItem; isElapsed: boolean; isActiveReplacement: boolean; isInProgress: boolean }): string {
  const { title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress } = input;
  const isCancelled = item.status === "cancelled";
  const isElapsedActive = isElapsed && !isCancelled;
  return `${title}, ${timeLabel}, ${durationMinutes} minutos${isCancelled ? ", cancelada" : ""}${closedSuffix(item)}${isActiveReplacement && !isCancelled && !isElapsed ? ", reemplazo" : ""}${isInProgress && !isElapsed && !isCancelled ? ", en curso" : ""}${isElapsedActive ? ", ya transcurrida" : ""}`;
}

export function lessonTitle(item: CalendarViewItem): string {
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
export function RealLessonCard({ positioned, isElapsed, isActiveReplacement, isInProgress = false, columnWidthPx, onSelect, onTip, describedBy, mobile = false, dayRow = false, widthOverridePx }: RealLessonCardProps) {
  const { item, height, hitTop, hitHeight, blockOffset, lane, laneCount } = positioned;
  const colors = resolveLessonColors({ status: item.status, modality: item.modality, isElapsed, isActiveReplacement });
  const isCancelled = item.status === "cancelled";
  const isTraining = item.activityKind === "training";
  const start = new Date(item.start);
  const timeLabel = dayRow ? `${instantTimeLabel(item.start)}–${instantTimeLabel(item.end)}` : instantTimeLabel(item.start);
  const durationMinutes = Math.round((new Date(item.end).getTime() - start.getTime()) / 60_000);
  const title = lessonTitle(item);
  const stateTexts = stateParts({ item, isElapsed, isActiveReplacement, isInProgress });
  if (dayRow) {
    if (stateTexts.length === 0) stateTexts.push(lessonStatusLabel(item));
    stateTexts.unshift(MODALITY_LABELS[item.modality]);
  }
  const stateFacts = { status: item.status, closedOutcome: item.closedOutcome ?? null, isElapsed, isActiveReplacement, isInProgress };
  // Grupal: cuántos alumnos son (se ve en la tarjeta ancha, con el ícono en las angostas, y siempre en el cuadro de información).
  const groupSize = item.participantIds.length > 1 ? item.participantIds.length : null;

  const textColor = colors.textPrimary ?? CARD_TEXT_COLORS.primary;
  const secondaryColor = colors.textSecondary ?? CARD_TEXT_COLORS.secondary;
  const strike = isCancelled ? "line-through" : "none";
  // Semana en el teléfono: la tarjeta de la app (esquina de 5 px, franja de color a la izquierda, primera palabra del nombre y la hora). Día usa la fila ancha.
  const mobileWeek = mobile && !dayRow;
  const inset = cardInsetPx(laneCount, mobile);
  const cardWidth = cardWidthPx(columnWidthPx, laneCount, mobile);
  // Semana en el teléfono: el ancho de cada columna se calcula para la tarjeta de dos líneas (`stack`, letra de 10,5/9,5 px); la completa (letra de 12 px) no entra en ese ancho, así que no se usa.
  const sizedPresentation = cardPresentation({ heightPx: height, widthPx: cardWidth });
  const presentation = mobile && !dayRow && sizedPresentation === "full" ? "stack" : sizedPresentation;
  // Semana en el teléfono: palabras enteras en texto horizontal (la columna del día se ensancha para que entren, `mobileWeekColumns`); nunca iniciales, texto girado ni palabras partidas.
  const shownWords = mobileWeek ? mobileNameWords(title, height) : [];
  const narrowName = mobileWeek ? shownWords.join(" ") : nameForWidth(title, cardWidth);
  const padX = laneCount === 1 ? "px-2.5" : "px-1.5";
  // Desde 38 px de alto entran dos líneas de nombre (10,5 px / 12) + la línea de la hora (9,5 px / 12) + el borde: «Juan Pablo», «Grupo B2».
  const twoNameLines = mobileWeek && presentation === "stack" && height >= TWO_NAME_LINES_MIN_HEIGHT_PX;
  // Nombres de 8 letras o más bajan un punto de letra para que entren enteros.
  const nameFontPx = mobileWeek ? mobileNameFontPx(shownWords) : undefined;
  // Clase de ~15 minutos (`micro`): una línea de la altura del bloque; en el teléfono nunca más grande que la letra de la semana.
  const microFont = Math.min(microFontPx(height), nameFontPx ?? 10);
  // Tarjetas de UNA línea (clases cortas): la hora de inicio o el estado importante van ANTES del nombre cuando entran con la palabra completa (el teléfono ensancha la columna para eso: `mobileLaneNeedPx`).
  // Clase cerrada que no se dictó (cancelada tarde, ausencias, feriado): además del texto de la tarjeta ancha y del detalle, un ícono «no se dictó» que acompaña a la hora en las angostas (el estado nunca va sólo por color ni sólo por tooltip).
  const notHeld = item.status === "completed" && !!item.closedOutcome;
  const singleLineMeta = narrowMeta({ timeLabel, facts: stateFacts });
  // Escritorio: el ícono de grupo/entrenamiento (si el carril lo muestra) también gasta ancho delante del nombre.
  const inlineNeedPx = inlineMetaNeedPx(mobileWeek ? shownWords : [firstWord(narrowName)], mobileWeek ? (nameFontPx ?? 10.5) : 11, singleLineMeta, (mobileWeek ? 12 : 16) + ((groupSize || isTraining || notHeld) && (mobileWeek || cardWidth >= 36) ? SINGLE_LINE_ICON_PX : 0));
  const showInlineMeta = mobileWeek ? cardWidth + 2 >= inlineNeedPx && inlineNeedPx <= LANE_MAX_WITH_META_PX : cardWidth >= inlineNeedPx;
  // Sólo la tarjeta completa lleva el borde de 1,5 px; las de una o dos líneas bajas usan 1 px para no gastar alto de lectura.
  // La de ~15 minutos (`micro`) dibuja su borde hacia adentro con una sombra: así el borde no gasta alto y toda la altura exacta del bloque es de la letra.
  const micro = presentation === "micro";
  const borderClass = micro ? (mobileWeek ? "rounded-[5px]" : "rounded-md") : mobileWeek ? "rounded-[5px] border border-l-[3px]" : `rounded-md ${presentation === "full" ? "border-[1.5px]" : "border"}`;
  const microEdge = micro ? { boxShadow: `inset 0 0 0 1px ${colors.border}${mobileWeek ? `, inset 3px 0 0 0 ${colors.border}` : ""}` } : undefined;
  const fullInfo = `${title}${groupSize ? ` (${groupSize} alumnos)` : ""} · ${instantTimeLabel(item.start)}–${instantTimeLabel(item.end)} · ${MODALITY_LABELS[item.modality]}${stateTexts.length ? ` · ${stateTexts.filter((tag) => tag !== MODALITY_LABELS[item.modality]).join(" · ")}` : ""}`;
  const iconSize = presentation === "full" ? "h-3 w-3" : "h-2.5 w-2.5";
  // En un carril de menos de 36 px las iniciales valen más que el ícono (el grupo y el entrenamiento siguen en el cuadro de información y en el nombre accesible).
  const icons =
    cardWidth < 36 ? null : (
      <>
        {notHeld && <NoSymbolIcon className={`${iconSize} shrink-0`} aria-hidden />}
        {groupSize && <UserGroupIcon className={`${iconSize} shrink-0`} aria-hidden />}
        {isTraining && <BarbellIcon className={`${iconSize} shrink-0`} />}
      </>
    );
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
        left: widthOverridePx === undefined ? `calc(${(lane * 100) / laneCount}% + ${inset}px)` : inset,
        width: widthOverridePx === undefined ? `calc(${100 / laneCount}% - ${inset * 2}px)` : widthOverridePx,
      }}
      aria-label={ariaLabelOf({ title, timeLabel, durationMinutes, item, isElapsed, isActiveReplacement, isInProgress })}
      aria-describedby={describedBy}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 min-w-0 overflow-hidden ${borderClass} shadow-subtle transition-[box-shadow,filter] duration-150 ease-premium group-hover:shadow-cardHover group-hover:brightness-95 motion-reduce:transition-none`}
        style={{ top: blockOffset, height, boxSizing: "border-box", backgroundColor: colors.bg, borderColor: colors.border, ...microEdge }}
      >
        {presentation === "full" && (
          <span className={`flex h-full min-w-0 flex-col justify-center overflow-hidden ${padX}`}>
            <span className="flex min-w-0 items-center gap-1 text-[12px] font-bold leading-[14px]" style={{ color: textColor, textDecorationLine: strike }}>
              {icons}
              <span className="min-w-0 truncate">{narrowName}</span>
            </span>
            <span className="block min-w-0 truncate text-[11px] font-medium leading-[13px]" style={{ color: secondaryColor }}>
              {wideMeta({ timeLabel, groupSize, tags: stateTexts })}
            </span>
          </span>
        )}
        {presentation === "stack" && (
          <span className={`flex h-full min-w-0 flex-col justify-center overflow-hidden ${mobileWeek ? "px-[3px]" : cardWidth < 44 ? "px-0.5" : "px-1"}`}>
            <span className={`flex min-w-0 gap-0.5 font-bold ${twoNameLines ? "items-start leading-[12px]" : `items-center leading-[13px]${mobileWeek ? "" : " text-[11px]"}`}`} style={{ color: textColor, textDecorationLine: strike, fontSize: nameFontPx }}>
              {!mobileWeek && icons}
              {twoNameLines ? (
                // Hasta dos palabras en hasta dos líneas, cortando sólo entre palabras (la columna ya mide lo que necesita la más larga).
                <span className="min-w-0 flex-1" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", hyphens: "none", wordBreak: "normal", overflowWrap: "normal" }}>
                  {narrowName}
                </span>
              ) : (
                <span className="min-w-0 truncate">{narrowName}</span>
              )}
            </span>
            <span className={`flex min-w-0 items-center gap-0.5 font-semibold leading-3 text-[10px]`} style={{ color: secondaryColor }}>
              {mobileWeek && icons}
              <span className="min-w-0 truncate">{narrowMeta({ timeLabel, facts: stateFacts })}</span>
            </span>
          </span>
        )}
        {presentation === "title" && (
          <span className={`flex h-full min-w-0 items-center gap-1 overflow-hidden ${mobileWeek ? "px-[3px]" : "px-1.5"}`}>
            {/* Teléfono: el ícono de grupo/entrenamiento sólo si sobra lugar después del nombre entero (el nombre manda; el dato sigue en el cuadro de información y en el nombre accesible). */}
            {(!mobileWeek || cardWidth + 2 >= (showInlineMeta ? inlineNeedPx : estimateBoldTextWidthPx(narrowName, nameFontPx ?? 10.5) + 12 + SINGLE_LINE_ICON_PX)) && icons}
            {showInlineMeta && (
              <span className="shrink-0 text-[10.5px] font-semibold leading-[13px]" style={{ color: secondaryColor, textDecorationLine: strike, fontSize: mobileWeek ? INLINE_META_FONT_PX : undefined }}>
                {singleLineMeta}
              </span>
            )}
            <span className="min-w-0 truncate text-[11px] font-bold leading-[13px]" style={{ color: textColor, textDecorationLine: strike, fontSize: nameFontPx }}>
              {narrowName}
            </span>
          </span>
        )}
        {presentation === "micro" && (
          // Clase de ~15 minutos: el bloque conserva su alto exacto y el nombre va en UNA línea de letra chica (del alto del bloque menos los bordes); la hora se suma si el carril es ancho.
          <span className={`flex h-full min-w-0 items-center gap-1 overflow-hidden ${mobileWeek ? "pl-1.5 pr-[3px]" : "px-1"}`} style={{ color: textColor, textDecorationLine: strike }}>
            {showInlineMeta && (
              <span className="shrink-0 font-semibold leading-none" style={{ color: secondaryColor, fontSize: Math.min(microFont, INLINE_META_FONT_PX) }}>
                {singleLineMeta}
              </span>
            )}
            {notHeld && cardWidth >= 36 && <NoSymbolIcon className="h-2.5 w-2.5 shrink-0" aria-hidden />}
            <span className="min-w-0 truncate font-bold leading-none" style={{ fontSize: microFont }}>
              {narrowName}
            </span>
          </span>
        )}
        {presentation === "vertical" && (
          <span className="flex h-full w-full items-center justify-center overflow-hidden py-0.5">
            <span className="block min-h-0 truncate text-[10px] font-bold leading-[11px]" style={{ writingMode: "vertical-rl", maxHeight: "100%", color: textColor, textDecorationLine: strike }}>
              {firstWord(title)}
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
  const groupSize = item.participantIds.length > 1 ? item.participantIds.length : null;
  const metaParts = [`${timeLabel}–${instantTimeLabel(item.end)}`, ...(groupSize ? [`${groupSize} alumnos`] : []), MODALITY_LABELS[item.modality], ...stateParts({ item, isElapsed, isActiveReplacement, isInProgress })];

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
