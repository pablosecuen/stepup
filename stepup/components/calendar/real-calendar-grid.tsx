"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { isActiveReplacement, visibleCalendarItems } from "@/lib/calendar/occurrences";
import { getCancelledSlotReuseDecision } from "@/lib/calendar/mutations";
import {
  HOURS,
  TIME_COLUMN_WIDTH_PX,
  WEEKDAY_SHORT,
  currentTimeTop,
  dayColumnWidthPx,
  gridFitsWidth,
  groupItemsByDayKey,
  layoutDayItems,
} from "@/lib/calendar/layout";
import { dayOfMonth, formatCivilDayLabelShort, todayDateKey, weekdayIndexMondayFirst } from "@/lib/calendar/civil-calendar";
import { CURRENT_TIME_COLOR } from "@/lib/calendar-theme";
import { COMPACT_INITIAL_HOUR_HEIGHT_PX, fitHourHeight, hourHeightFor, type CalendarDensityKey, type HourFit } from "@/lib/calendar/density";
import { RealLessonAgendaRow, RealLessonCard, type CardTip } from "./real-lesson-card";
import { RealLessonDetailModal } from "./real-lesson-detail-modal";
import PrivateLink from "@/components/nav/private-link";
import { mobileCalendarHourFit } from "@/lib/calendar/mobile-density";

interface RealCalendarGridProps {
  dayKeys: string[]; // 7 claves civiles YYYY-MM-DD (semana) o 1 (día) — nunca Date
  items: CalendarViewItem[];
  density: CalendarDensityKey;
  /** Avisa si la grilla horaria entra con columnas legibles (si no, se muestra la agenda por día también en escritorio). */
  onGridFitChange?: (fits: boolean) => void;
  /** Clase cuyo diálogo se abre directo en «Reprogramar» (resultado «Reprogramada» del registro). */
  rescheduleItemId?: string;
  dayHrefs?: Record<string, string>;
}

/**
 * Escritorio (≥ 820 px): grilla horaria con una columna por día, dentro de una zona de agenda que ocupa el espacio que deja el
 * encabezado (la página no se desplaza). «Compacta» reparte ese espacio entre las horas del eje — se MIDE con `ResizeObserver`
 * (zona de agenda y encabezado de los días), así que se recalcula al cambiar ventana, zoom, Semana/Día, densidad o el encabezado — y
 * no se desplaza; «Media» y «Amplia» conservan 64 y 80 px por hora y se desplazan DENTRO de la zona, con los encabezados de los días
 * y la escala horaria fijos. Móvil conserva la grilla de Semana y Día del origen, con su geometría propia y scroll dentro del
 * espacio útil del teléfono. La alternativa de lista sólo queda en escritorio angosto. Todos comparten datos, colores y detalle.
 */
export function RealCalendarGrid({ dayKeys, items, density, onGridFitChange, rescheduleItemId, dayHrefs }: RealCalendarGridProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarViewItem | null>(() => (rescheduleItemId ? (items.find((item) => item.id === rescheduleItemId) ?? null) : null));
  // Sólo la clase abierta por el enlace directo arranca en «Reprogramar»; cualquier otra que se elija después abre las acciones de siempre.
  const [startInReschedule, setStartInReschedule] = useState(() => Boolean(rescheduleItemId && items.some((item) => item.id === rescheduleItemId)));
  const [fit, setFit] = useState<HourFit | null>(null);
  const [areaWidthPx, setAreaWidthPx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [tip, setTip] = useState<CardTip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Espacio real de la zona de agenda y de lo que NO es el eje (encabezado de los días, bordes, barra horizontal si existe).
  useEffect(() => {
    const wrap = wrapRef.current;
    const region = regionRef.current;
    const scroller = scrollerRef.current;
    const header = headerRef.current;
    if (!wrap || !region || !scroller || !header) return;
    function measure() {
      if (!wrap || !region || !scroller || !header) return;
      // Ancho útil: decide si la grilla entra con columnas legibles y cuánto mide cada columna (y por lo tanto cada carril).
      const widthPx = wrap.clientWidth;
      if (widthPx > 0) setAreaWidthPx((previous) => (previous === widthPx ? previous : widthPx));
      const mobile = window.matchMedia("(max-width: 819px)").matches;
      setIsMobile(mobile);
      const availablePx = region.clientHeight;
      if (availablePx <= 0) return;
      const fixedPx = header.offsetHeight + (scroller.offsetHeight - scroller.clientHeight);
      const next = mobile ? mobileCalendarHourFit(availablePx - fixedPx, dayKeys.length)
        : fitHourHeight({ availablePx, fixedPx, hours: HOURS.length });
      setFit((previous) => (previous && previous.hourHeightPx === next.hourHeightPx && previous.overflows === next.overflows ? previous : next));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(region);
    observer.observe(scroller);
    observer.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [density, dayKeys.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const gridFits = isMobile || areaWidthPx === null ? true : gridFitsWidth(areaWidthPx, dayKeys.length);
  // Antes de medir (primer dibujo) se supone un ancho razonable para que el texto no «salte» al medir: una columna de semana ronda los 150 px y la vista de un día es ancha.
  const columnWidthPx = areaWidthPx === null ? (dayKeys.length === 1 ? 640 : 150) : dayColumnWidthPx(areaWidthPx, dayKeys.length);

  useEffect(() => {
    onGridFitChange?.(gridFits);
  }, [gridFits, onGridFitChange]);

  // El tooltip se cierra con Escape (sin mover el foco ni cerrar nada más).
  useEffect(() => {
    if (!tip) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setTip(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [tip]);

  const fixedHourHeight = hourHeightFor(density);
  const hourHeightPx = isMobile ? fit?.hourHeightPx ?? (dayKeys.length > 1 ? 50 : 34)
    : fixedHourHeight ?? fit?.hourHeightPx ?? COMPACT_INITIAL_HOUR_HEIGHT_PX;
  // Media y Amplia se desplazan dentro de la zona; Compacta sólo si ni el piso de legibilidad entra.
  const scrollsVertically = isMobile || fixedHourHeight !== null || fit?.overflows === true;

  const visible = visibleCalendarItems(items);
  const isWeek = dayKeys.length > 1;
  const hourGridlinesStyle = { backgroundImage: "linear-gradient(to bottom, #E6DAC4 1px, transparent 1px)", backgroundSize: `100% ${hourHeightPx}px` };

  const nowLineTop = now ? currentTimeTop(now, hourHeightPx) : null;
  // "Hoy" y el día de cada tarjeta se resuelven como claves civiles en la zona del calendario: igual en servidor (UTC) y navegador.
  const todayKey = now ? todayDateKey(now) : null;
  const itemsByDayKey = groupItemsByDayKey(visible);
  // Carriles de cada día: las clases que se tocan se reparten dentro de su columna (ninguna queda oculta) y cada carril divide el
  // ancho disponible: los carriles NUNCA ensanchan la columna ni la grilla; la tarjeta pasa a un modo más compacto si no le cabe el texto.
  const positionedByDay = new Map(dayKeys.map((dayKey) => [dayKey, layoutDayItems(itemsByDayKey.get(dayKey) ?? [], hourHeightPx)]));
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH_PX}px repeat(${dayKeys.length}, minmax(0, 1fr))`;
  const nowMs = (now ?? new Date()).getTime();

  const stateOf = (item: CalendarViewItem) => ({
    isElapsed: item.status !== "cancelled" && new Date(item.end).getTime() <= nowMs,
    isActiveReplacement: isActiveReplacement(item, items),
    isInProgress: now !== null && new Date(item.start).getTime() <= nowMs && nowMs < new Date(item.end).getTime(),
  });

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col">
      {/* Grilla horaria: Semana y Día en escritorio y móvil. */}
      <div ref={regionRef} data-calendar-region className={`relative min-h-0 flex-1 ${gridFits ? "nav:block" : "nav:hidden"}`}>
        <div
          ref={scrollerRef}
          data-calendar-scroller
          data-scrolls={scrollsVertically ? "true" : "false"}
          className={`absolute inset-x-0 top-0 max-h-full overflow-x-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card ${scrollsVertically ? "overflow-y-auto" : "overflow-y-hidden"}`}
        >
          <div>
            <div ref={headerRef} data-calendar-days-header className="sticky top-0 z-20 grid border-b-[1.5px] border-border bg-surface" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 bg-surface" />
              {dayKeys.map((dayKey) => {
                const today = todayKey === dayKey;
                return (
                  <div key={dayKey} className={`flex flex-col items-center gap-0.5 py-1.5 text-center ${today ? "bg-accentSoft" : ""}`}>
                    {isWeek && <span className={`text-[10px] font-bold nav:text-label ${today ? "text-accentText" : "text-textMuted"}`}>{WEEKDAY_SHORT[weekdayIndexMondayFirst(dayKey)]}</span>}
                    <span className={`font-display text-[22px] font-semibold leading-none tracking-tight ${today ? "text-accentDark" : "text-textPrimary"}`}>
                      {dayHrefs?.[dayKey] ? <><PrivateLink href={dayHrefs[dayKey]} aria-label={`Ver día ${formatCivilDayLabelShort(dayKey)}`} className="inline-flex min-h-11 min-w-8 items-center justify-center nav:hidden">{dayOfMonth(dayKey)}</PrivateLink><span className="hidden nav:inline">{dayOfMonth(dayKey)}</span></> : dayOfMonth(dayKey)}
                      {today && <span className="sr-only"> (hoy)</span>}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="grid" style={{ gridTemplateColumns, height: HOURS.length * hourHeightPx }}>
              <div className="sticky left-0 z-10 bg-surface">
                {HOURS.map((hour, index) => (
                  <div key={hour} className="relative" style={{ height: hourHeightPx }}>
                    {/* La primera hora va adentro de su celda: arriba la taparía el encabezado fijo de los días. */}
                    <span className={`absolute right-1.5 text-[11px] font-medium text-textMuted tf-num ${index === 0 ? "top-0.5" : "-top-2"}`}>{String(hour).padStart(2, "0")}:00</span>
                  </div>
                ))}
              </div>

              {dayKeys.map((dayKey) => {
                const today = todayKey === dayKey;
                const positioned = positionedByDay.get(dayKey) ?? [];

                return (
                  <div key={dayKey} className={`relative z-0 min-w-0 border-l border-border ${today ? "bg-accent/[0.04]" : ""}`} style={hourGridlinesStyle}>
                    {today && nowLineTop !== null && (
                      <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowLineTop }}>
                        <div className="relative h-0.5" style={{ backgroundColor: CURRENT_TIME_COLOR }}>
                          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ backgroundColor: CURRENT_TIME_COLOR }} />
                        </div>
                      </div>
                    )}

                    {positioned.map((positionedItem) => (
                      <RealLessonCard
                        key={positionedItem.item.id}
                        positioned={positionedItem}
                        mobile={isMobile}
                        dayRow={isMobile && !isWeek}
                        {...stateOf(positionedItem.item)}
                        columnWidthPx={columnWidthPx}
                        onSelect={() => setSelected(positionedItem.item)}
                        onTip={setTip}
                        describedBy={tip?.id === `calendar-tip-${positionedItem.item.id}` ? TIP_ID : undefined}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Alternativa para escritorio angosto: nunca sustituye la grilla del teléfono. */}
      <div data-calendar-agenda className={`hidden flex-col gap-6 ${gridFits ? "nav:hidden" : "nav:flex nav:min-h-0 nav:flex-1 nav:overflow-y-auto"}`}>
        {dayKeys.map((dayKey) => {
          const today = todayKey === dayKey;
          const dayItems = (positionedByDay.get(dayKey) ?? []).map((p) => p.item);
          return (
            <section key={dayKey} aria-label={formatCivilDayLabelShort(dayKey)}>
              {/* En la vista de un solo día el título de la barra ya dice el día: acá sólo el recuento. */}
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={isWeek ? `font-display text-[22px] font-semibold leading-tight tracking-tight first-letter:uppercase ${today ? "text-accentDark" : "text-textPrimary"}` : "sr-only"}>
                  {formatCivilDayLabelShort(dayKey)}
                  {today && <span> · hoy</span>}
                </h3>
                <p className={`text-[13.5px] text-textMuted ${isWeek ? "shrink-0" : ""}`}>
                  {dayItems.length === 0 ? "Sin clases" : dayItems.length === 1 ? "1 clase" : `${dayItems.length} clases`}
                  {!isWeek && today && " · hoy"}
                </p>
              </div>
              {dayItems.length === 0 ? (
                <p className="mt-2 rounded-md border-2 border-dashed border-borderMid px-4 py-3.5 text-[14.5px] text-textMuted">Día libre.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {dayItems.map((item) => (
                    <li key={item.id}>
                      <RealLessonAgendaRow item={item} {...stateOf(item)} onSelect={() => setSelected(item)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {tip && (
        <div
          id={TIP_ID}
          role="tooltip"
          className="pointer-events-none fixed z-[60] max-w-[280px] rounded-md bg-ink px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-background shadow-panel"
          style={tooltipPosition(tip)}
        >
          {tip.text}
        </div>
      )}

      {selected && (
        <RealLessonDetailModal
          item={selected}
          startInReschedule={startInReschedule && selected.id === rescheduleItemId}
          canReuseSlot={now ? getCancelledSlotReuseDecision(selected, items, now).eligible : false}
          onClose={() => {
            setSelected(null);
            setStartInReschedule(false);
          }}
        />
      )}
    </div>
  );
}

const TIP_ID = "calendar-card-tip";

/** Debajo de la tarjeta (o arriba si no hay lugar), alineado a su borde izquierdo y dentro de la ventana. */
function tooltipPosition(tip: CardTip): { left: number; top: number; transform?: string } {
  const left = Math.max(8, Math.min(tip.rect.left, (typeof window === "undefined" ? 1200 : window.innerWidth) - 288));
  const below = tip.rect.bottom + 6;
  if (typeof window !== "undefined" && below + 64 > window.innerHeight) return { left, top: tip.rect.top - 6, transform: "translateY(-100%)" };
  return { left, top: below };
}
