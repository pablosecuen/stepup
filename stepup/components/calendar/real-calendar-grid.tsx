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
  dayColumnMinWidth,
  groupItemsByDayKey,
  layoutDayItems,
} from "@/lib/calendar/layout";
import { dayOfMonth, formatCivilDayLabelShort, todayDateKey, weekdayIndexMondayFirst } from "@/lib/calendar/civil-calendar";
import { CURRENT_TIME_COLOR } from "@/lib/calendar-theme";
import { COMPACT_INITIAL_HOUR_HEIGHT_PX, fitHourHeight, hourHeightFor, type CalendarDensityKey, type HourFit } from "@/lib/calendar/density";
import { RealLessonAgendaRow, RealLessonCard } from "./real-lesson-card";
import { RealLessonDetailModal } from "./real-lesson-detail-modal";

interface RealCalendarGridProps {
  dayKeys: string[]; // 7 claves civiles YYYY-MM-DD (semana) o 1 (día) — nunca Date
  items: CalendarViewItem[];
  density: CalendarDensityKey;
}

/**
 * Escritorio (≥ 820 px): grilla horaria con una columna por día, dentro de una zona de agenda que ocupa el espacio que deja el
 * encabezado (la página no se desplaza). «Compacta» reparte ese espacio entre las horas del eje — se MIDE con `ResizeObserver`
 * (zona de agenda y encabezado de los días), así que se recalcula al cambiar ventana, zoom, Semana/Día, densidad o el encabezado — y
 * no se desplaza; «Media» y «Amplia» conservan 64 y 80 px por hora y se desplazan DENTRO de la zona, con los encabezados de los días
 * y la escala horaria fijos. Móvil (320–819 px): agenda agrupada por día — nunca se comprime la grilla. Las dos dibujan los mismos
 * datos y comparten el detalle de la clase; los colores salen de la escala congelada del calendario (`lib/calendar-theme.ts`).
 */
export function RealCalendarGrid({ dayKeys, items, density }: RealCalendarGridProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarViewItem | null>(null);
  const [fit, setFit] = useState<HourFit | null>(null);
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
    const region = regionRef.current;
    const scroller = scrollerRef.current;
    const header = headerRef.current;
    if (!region || !scroller || !header) return;
    function measure() {
      if (!region || !scroller || !header) return;
      const availablePx = region.clientHeight;
      if (availablePx <= 0) return; // zona oculta (móvil): se mide cuando vuelve a verse
      const next = fitHourHeight({ availablePx, fixedPx: header.offsetHeight + (scroller.offsetHeight - scroller.clientHeight), hours: HOURS.length });
      setFit((previous) => (previous && previous.hourHeightPx === next.hourHeightPx && previous.overflows === next.overflows ? previous : next));
    }
    measure();
    const observer = new ResizeObserver(measure);
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

  const fixedHourHeight = hourHeightFor(density);
  const hourHeightPx = fixedHourHeight ?? fit?.hourHeightPx ?? COMPACT_INITIAL_HOUR_HEIGHT_PX;
  // Media y Amplia se desplazan dentro de la zona; Compacta sólo si ni el piso de legibilidad entra.
  const scrollsVertically = fixedHourHeight !== null || fit?.overflows === true;

  const visible = visibleCalendarItems(items);
  const isWeek = dayKeys.length > 1;
  const hourGridlinesStyle = { backgroundImage: "linear-gradient(to bottom, #E6DAC4 1px, transparent 1px)", backgroundSize: `100% ${hourHeightPx}px` };

  const nowLineTop = now ? currentTimeTop(now, hourHeightPx) : null;
  // "Hoy" y el día de cada tarjeta se resuelven como claves civiles en la zona del calendario: igual en servidor (UTC) y navegador.
  const todayKey = now ? todayDateKey(now) : null;
  const itemsByDayKey = groupItemsByDayKey(visible);
  // Carriles de cada día: las clases que se tocan se reparten dentro de su columna (ninguna queda oculta); un día con muchos
  // carriles ensancha su columna en vez de comprimir las tarjetas.
  const positionedByDay = new Map(dayKeys.map((dayKey) => [dayKey, layoutDayItems(itemsByDayKey.get(dayKey) ?? [], hourHeightPx)]));
  const columnWidths = dayKeys.map((dayKey) => dayColumnMinWidth(positionedByDay.get(dayKey) ?? []));
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH_PX}px ${columnWidths.map((width) => `minmax(${width}px, 1fr)`).join(" ")}`;
  const gridMinWidth = TIME_COLUMN_WIDTH_PX + columnWidths.reduce((sum, width) => sum + width, 0);
  const nowMs = (now ?? new Date()).getTime();

  const stateOf = (item: CalendarViewItem) => ({
    isElapsed: item.status !== "cancelled" && new Date(item.end).getTime() <= nowMs,
    isActiveReplacement: isActiveReplacement(item, items),
    isInProgress: now !== null && new Date(item.start).getTime() <= nowMs && nowMs < new Date(item.end).getTime(),
  });

  return (
    <>
      {/* Escritorio: zona de agenda (ocupa el espacio disponible) con la grilla horaria */}
      <div ref={regionRef} data-calendar-region className="relative hidden min-h-0 flex-1 nav:block">
        <div
          ref={scrollerRef}
          data-calendar-scroller
          data-scrolls={scrollsVertically ? "true" : "false"}
          className={`absolute inset-x-0 top-0 max-h-full overflow-x-auto rounded-lg border-[1.5px] border-border bg-surface shadow-card ${scrollsVertically ? "overflow-y-auto" : "overflow-y-hidden"}`}
        >
          <div style={{ minWidth: gridMinWidth }}>
            <div ref={headerRef} data-calendar-days-header className="sticky top-0 z-20 grid border-b-[1.5px] border-border bg-surface" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 bg-surface" />
              {dayKeys.map((dayKey) => {
                const today = todayKey === dayKey;
                return (
                  <div key={dayKey} className={`flex flex-col items-center gap-0.5 py-1.5 text-center ${today ? "bg-accentSoft" : ""}`}>
                    {isWeek && <span className={`text-label font-bold ${today ? "text-accentText" : "text-textMuted"}`}>{WEEKDAY_SHORT[weekdayIndexMondayFirst(dayKey)]}</span>}
                    <span className={`font-display text-[22px] font-semibold leading-none tracking-tight ${today ? "text-accentDark" : "text-textPrimary"}`}>
                      {dayOfMonth(dayKey)}
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
                  <div key={dayKey} className={`relative z-0 border-l border-border ${today ? "bg-accent/[0.04]" : ""}`} style={hourGridlinesStyle}>
                    {today && nowLineTop !== null && (
                      <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowLineTop }}>
                        <div className="relative h-0.5" style={{ backgroundColor: CURRENT_TIME_COLOR }}>
                          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ backgroundColor: CURRENT_TIME_COLOR }} />
                        </div>
                      </div>
                    )}

                    {positioned.map((positionedItem) => (
                      <RealLessonCard key={positionedItem.item.id} positioned={positionedItem} {...stateOf(positionedItem.item)} onSelect={() => setSelected(positionedItem.item)} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Móvil: agenda agrupada por día */}
      <div className="flex flex-col gap-6 nav:hidden">
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

      {selected && (
        <RealLessonDetailModal
          item={selected}
          canReuseSlot={now ? getCancelledSlotReuseDecision(selected, items, now).eligible : false}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
