"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveGridScroll, restoreGridScroll } from "@/lib/calendar/grid-scroll";
import { newLessonSlotHref, slotAriaLabel } from "@/lib/calendar/slot-link";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { isActiveReplacement, visibleCalendarItems } from "@/lib/calendar/occurrences";
import { getCancelledSlotReuseDecision } from "@/lib/calendar/mutations";
import {
  HOURS,
  MOBILE_TIME_COLUMN_WIDTH_PX,
  TIME_COLUMN_WIDTH_PX,
  WEEKDAY_SHORT,
  currentTimeTop,
  dayColumnWidthPx,
  gridFitsWidth,
  groupItemsByDayKey,
  layoutDayItems,
  mobileWeekColumns,
} from "@/lib/calendar/layout";
import { compactStateTag, desktopLaneNeedPx, mobileLaneNeedPx, narrowMeta, SINGLE_LINE_ICON_PX } from "@/lib/calendar/card-text";
import { fitWeekColumns, planShortLabels, shortLabelsNeedPx, type DayLabelPlan, type LabelSource } from "@/lib/calendar/short-labels";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { dayOfMonth, formatCivilDayLabelShort, todayDateKey, weekdayIndexMondayFirst } from "@/lib/calendar/civil-calendar";
import { CURRENT_TIME_COLOR } from "@/lib/calendar-theme";
import { COMPACT_INITIAL_HOUR_HEIGHT_PX, fitHourHeight, hourHeightFor, type CalendarDensityKey, type HourFit } from "@/lib/calendar/density";
import { ariaLabelOf, lessonTitle, RealLessonAgendaRow, RealLessonCard, type CardTip } from "./real-lesson-card";
import { ShortBar, ShortLabel } from "./real-short-label";
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
  /** PROPUESTA (entorno de revisión): clases cortas como barra exacta + rótulo de 11 px. Apagado por defecto: nada cambia en producción. */
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
  const router = useRouter();
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

  // Al volver de «Nueva clase» (Cancelar o guardar) la grilla recupera su desplazamiento, una sola vez, cuando ya tiene su alto definitivo.
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current || !fit) return;
    scrollRestoredRef.current = true;
    const scroller = scrollerRef.current;
    restoreGridScroll(`${window.location.pathname}${window.location.search}`, scroller);
  }, [fit]);

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
  // Teléfono: columna de horas angosta y la grilla a ras de los bordes (sin marco), para que cada día tenga todo el ancho posible (≈ 50 px por día en un iPhone de 390 px).
  const timeColumnPx = isMobile ? MOBILE_TIME_COLUMN_WIDTH_PX : TIME_COLUMN_WIDTH_PX;
  const columnWidthPx = areaWidthPx === null ? (dayKeys.length === 1 ? 640 : isMobile ? 50 : 150) : dayColumnWidthPx(areaWidthPx, dayKeys.length, timeColumnPx, isMobile ? 0 : 3);

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
  const nowMs = (now ?? new Date()).getTime();
  const stateOf = (item: CalendarViewItem) => ({
    isElapsed: item.status !== "cancelled" && new Date(item.end).getTime() <= nowMs,
    isActiveReplacement: isActiveReplacement(item, items),
    isInProgress: now !== null && new Date(item.start).getTime() <= nowMs && nowMs < new Date(item.end).getTime(),
  });

  // Dato que se pide ANTES del nombre en una tarjeta de una línea: en un carril solo, la hora o el estado; en carriles compartidos sólo el ESTADO.
  const laneMetaFor = (p: { item: CalendarViewItem; laneCount: number }) => {
    const facts = { status: p.item.status, ...stateOf(p.item) };
    const tag = compactStateTag(facts, true);
    return tag ?? (p.laneCount === 1 ? narrowMeta({ timeLabel: instantTimeLabel(p.item.start), facts }) : undefined);
  };
  // Rótulos de las clases cortas (barra exacta + nombre, hora y estado en letra de 11 px; ver `short-labels.ts`): texto de cada una y, por día, quiénes llevan rótulo (con un ancho holgado) para no contar su carril en el ancho que pide la columna.
  const labelSources = new Map<string, LabelSource>();
  for (const item of visible) {
    const facts = { status: item.status, ...stateOf(item) };
    labelSources.set(item.id, { id: item.id, title: lessonTitle(item), timeText: instantTimeLabel(item.start), stateText: compactStateTag(facts, true) });
  }
  const gridHeightPx = HOURS.length * hourHeightPx;
  const labeledIdsByDay = new Map<string, Set<string>>();
  for (const dayKey of dayKeys) {
    const probe = planShortLabels(positionedByDay.get(dayKey) ?? [], labelSources, 600, gridHeightPx);
    labeledIdsByDay.set(dayKey, new Set(probe ? Array.from(probe.items.keys()) : []));
  }
  // Semana en el teléfono: cada día ensancha su columna lo que necesitan sus carriles para escribir los nombres sin girarlos ni cortarlos; si la suma pasa del ancho de la pantalla, la grilla se desplaza
  // hacia los costados (la columna de horas y el encabezado de los días quedan fijos). Un día sin clases simultáneas conserva el ancho común.
  const mobileColumns =
    isMobile && isWeek && areaWidthPx !== null
      ? mobileWeekColumns({
          areaWidthPx,
          timeColumnPx,
          needPx: dayKeys.map((dayKey) => {
            const dayItems = positionedByDay.get(dayKey) ?? [];
            const labeled = labeledIdsByDay.get(dayKey);
            const laneNeed = Math.max(0, ...dayItems.filter((p) => !labeled?.has(p.item.id)).map((p) => p.laneCount * mobileLaneNeedPx(lessonTitle(p.item), p.height, laneMetaFor(p), p.item.participantIds.length > 1 || p.item.activityKind === "training" ? SINGLE_LINE_ICON_PX : 0)));
            return Math.max(laneNeed, shortLabelsNeedPx(dayItems, labelSources));
          }),
        })
      : null;
  const expandedColumns = mobileColumns?.expanded ? mobileColumns : null;
  // Escritorio: un día con rótulos de clases cortas pide más ancho; se lo reparte el resto de la semana SIN desplazamiento horizontal (sin días así, columnas iguales de siempre).
  const desktopTracks =
    !isMobile && isWeek && gridFits && areaWidthPx !== null
      ? fitWeekColumns(
          areaWidthPx - timeColumnPx - 3,
          dayKeys.map((dayKey) => {
            const dayItems = positionedByDay.get(dayKey) ?? [];
            const labeled = labeledIdsByDay.get(dayKey);
            // Varias clases largas a la vez: cada carril pide lo que necesita su primera palabra para no achicar la letra.
            const laneNeed = Math.max(0, ...dayItems.filter((p) => p.laneCount > 1 && !labeled?.has(p.item.id)).map((p) => p.laneCount * desktopLaneNeedPx(lessonTitle(p.item), p.item.participantIds.length > 1 || p.item.activityKind === "training")));
            return Math.max(laneNeed, shortLabelsNeedPx(dayItems, labelSources));
          }),
        )
      : null;
  const gridTemplateColumns = expandedColumns
    ? `${timeColumnPx}px ${expandedColumns.trackPx.map((px) => `${px}px`).join(" ")}`
    : desktopTracks
      ? `${timeColumnPx}px ${desktopTracks.map((px) => `minmax(0, ${px}fr)`).join(" ")}`
      : `${timeColumnPx}px repeat(${dayKeys.length}, minmax(0, 1fr))`;
  const todayIndex = todayKey === null ? -1 : dayKeys.indexOf(todayKey);

  // Con la grilla ensanchada, al abrir una semana el día de hoy queda a la vista (si hoy no está en esa semana, se empieza en el primer día, siempre igual). Sólo se reposiciona al CAMBIAR
  // de semana o al pasar a una grilla ensanchada: un cambio de alto de pantalla (barra del navegador, giro) no mueve lo que la profesora ya desplazó.
  const tracksRef = useRef<number[]>([]);
  const expandedTracks = expandedColumns ? expandedColumns.trackPx : null;
  const isExpanded = expandedTracks !== null;
  useEffect(() => {
    tracksRef.current = expandedTracks ?? [];
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tracks = tracksRef.current;
    if (!scroller || !isExpanded) return;
    const left = todayIndex < 0 ? 0 : tracks.slice(0, todayIndex).reduce((sum, width) => sum + width, 0);
    const right = todayIndex < 0 ? 0 : left + tracks[todayIndex];
    const visibleWidth = scroller.clientWidth - timeColumnPx;
    if (todayIndex < 0 || right <= visibleWidth) scroller.scrollLeft = 0;
    else scroller.scrollLeft = Math.min(left, right - visibleWidth + 8);
  }, [dayKeys[0], isExpanded, todayIndex, timeColumnPx]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col">
      {/* Grilla horaria: Semana y Día en escritorio y móvil. */}
      <div ref={regionRef} data-calendar-region className={`relative min-h-0 flex-1 ${gridFits ? "nav:block" : "nav:hidden"}`}>
        <div
          ref={scrollerRef}
          data-calendar-scroller
          data-scrolls={scrollsVertically ? "true" : "false"}
          className={`absolute inset-x-0 top-0 max-h-full ${expandedColumns ? "overflow-x-auto" : "overflow-x-hidden"} rounded-none border-x-0 border-y-[1.5px] border-border bg-surface shadow-none nav:rounded-lg nav:border-[1.5px] nav:shadow-card ${scrollsVertically ? "overflow-y-auto" : "overflow-y-hidden"}`}
        >
          <div style={expandedColumns ? { width: expandedColumns.totalPx } : undefined}>
            <div ref={headerRef} data-calendar-days-header className="sticky top-0 z-20 grid border-b-[1.5px] border-border bg-surface" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 bg-surface" />
              {dayKeys.map((dayKey) => {
                const today = todayKey === dayKey;
                return (
                  <div key={dayKey} className={`relative flex min-h-11 flex-col items-center justify-center gap-0.5 py-1 text-center nav:min-h-0 nav:justify-start nav:py-1.5 ${today ? "bg-accentSoft" : ""}`}>
                    {isWeek && <span className={`text-[9.5px] font-bold leading-3 nav:text-label ${today ? "text-accentText" : "text-textMuted"}`}>{WEEKDAY_SHORT[weekdayIndexMondayFirst(dayKey)]}</span>}
                    <span className={`text-[16px] font-bold leading-[18px] nav:font-display nav:text-[22px] nav:font-semibold nav:leading-none nav:tracking-tight ${today ? "text-accentDark" : "text-textPrimary"}`}>
                      {dayOfMonth(dayKey)}
                      {today && <span className="sr-only"> (hoy)</span>}
                    </span>
                    {/* Teléfono: cuántas clases tiene el día (como la app) y toda la cabecera del día es el enlace a su vista Día (sin agrandarla). */}
                    {isMobile && (positionedByDay.get(dayKey)?.length ?? 0) > 0 && (
                      <span aria-hidden className="absolute right-0.5 top-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-paperDeep px-0.5 text-[9px] font-bold leading-none text-textSecondary">
                        {positionedByDay.get(dayKey)?.length}
                      </span>
                    )}
                    {dayHrefs?.[dayKey] && (
                      <PrivateLink href={dayHrefs[dayKey]} aria-label={`Ver día ${formatCivilDayLabelShort(dayKey)}${(positionedByDay.get(dayKey)?.length ?? 0) > 0 ? `, ${positionedByDay.get(dayKey)?.length} clases` : ""}`} className="absolute inset-0 z-10 min-h-11 nav:hidden">
                        <span className="sr-only">{formatCivilDayLabelShort(dayKey)}</span>
                      </PrivateLink>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid" style={{ gridTemplateColumns, height: HOURS.length * hourHeightPx }}>
              <div className="sticky left-0 z-10 bg-surface">
                {HOURS.map((hour, index) => (
                  <div key={hour} className="relative" style={{ height: hourHeightPx }}>
                    {/* La primera hora va adentro de su celda: arriba la taparía el encabezado fijo de los días. */}
                    <span className={`absolute right-1 text-[10px] font-medium text-textMuted tf-num nav:right-1.5 nav:text-[11px] ${index === 0 ? "top-0.5" : "-top-2"}`}>{String(hour).padStart(2, "0")}:00</span>
                  </div>
                ))}
              </div>

              {dayKeys.map((dayKey, dayIndex) => {
                const today = todayKey === dayKey;
                const positioned = positionedByDay.get(dayKey) ?? [];
                const dayColumnPx = expandedColumns ? expandedColumns.trackPx[dayIndex] - 1 : desktopTracks ? desktopTracks[dayIndex] : columnWidthPx;
                const labelPlan: DayLabelPlan | null = planShortLabels(positioned, labelSources, dayColumnPx, gridHeightPx);

                return (
                  <div key={dayKey} className={`relative z-0 min-w-0 border-l border-border ${today ? "bg-accent/[0.04]" : ""}`} style={hourGridlinesStyle}>
                    {today && nowLineTop !== null && (
                      <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowLineTop }}>
                        <div className="relative h-0.5" style={{ backgroundColor: CURRENT_TIME_COLOR }}>
                          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ backgroundColor: CURRENT_TIME_COLOR }} />
                        </div>
                      </div>
                    )}

                    {/* Espacios libres: tocar una hora vacía abre «Nueva clase» en ese día y hora (como la app original). Van ANTES de las clases (quedan debajo) y sólo reaccionan al toque/clic, nunca al deslizar. */}
                    {HOURS.map((hour, index) => (
                      <button
                        key={`slot-${hour}`}
                        type="button"
                        tabIndex={-1}
                        data-grid-slot=""
                        aria-label={slotAriaLabel(formatCivilDayLabelShort(dayKey), hour)}
                        onClick={() => {
                          const returnPath = `${window.location.pathname}${window.location.search}`;
                          saveGridScroll(returnPath, scrollerRef.current);
                          router.push(newLessonSlotHref({ dayKey, hour, returnPath }));
                        }}
                        className="absolute inset-x-0 cursor-pointer bg-transparent hover:bg-accent/[0.06] focus-visible:bg-accent/[0.08]"
                        style={{ top: index * hourHeightPx, height: hourHeightPx }}
                      />
                    ))}

                    {positioned.map((positionedItem) => {
                      const planned = labelPlan?.items.get(positionedItem.item.id);
                      if (!planned) {
                        return (
                          <RealLessonCard
                            key={positionedItem.item.id}
                            positioned={positionedItem}
                            mobile={isMobile}
                            dayRow={isMobile && !isWeek}
                            {...stateOf(positionedItem.item)}
                            columnWidthPx={dayColumnPx}
                            widthOverridePx={labelPlan?.narrowed.get(positionedItem.item.id)}
                            onSelect={() => setSelected(positionedItem.item)}
                            onTip={setTip}
                            describedBy={tip?.id === `calendar-tip-${positionedItem.item.id}` ? TIP_ID : undefined}
                          />
                        );
                      }
                      const item = positionedItem.item;
                      const facts = stateOf(item);
                      const source = labelSources.get(item.id)!;
                      const minutes = Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000);
                      return (
                        <ShortBar
                          key={item.id}
                          positioned={positionedItem}
                          planned={planned}
                          lesson={{ status: item.status, modality: item.modality, isElapsed: facts.isElapsed, isActiveReplacement: facts.isActiveReplacement }}
                          ariaLabel={ariaLabelOf({ title: source.title, timeLabel: source.timeText, durationMinutes: minutes, item, ...facts })}
                          tipText={`${source.title} · ${instantTimeLabel(item.start)}–${instantTimeLabel(item.end)}${source.stateText ? ` · ${source.stateText}` : ""}`}
                          onSelect={() => setSelected(item)}
                          onTip={setTip}
                          describedBy={tip?.id === `calendar-tip-${item.id}` ? TIP_ID : undefined}
                        />
                      );
                    })}
                    {labelPlan &&
                      positioned.map((positionedItem) => {
                        const planned = labelPlan.items.get(positionedItem.item.id);
                        if (!planned) return null;
                        const item = positionedItem.item;
                        const facts = stateOf(item);
                        const source = labelSources.get(item.id)!;
                        return <ShortLabel key={`label-${item.id}`} planned={planned} lesson={{ status: item.status, modality: item.modality, isElapsed: facts.isElapsed, isActiveReplacement: facts.isActiveReplacement }} title={source.title} timeText={source.timeText} stateText={source.stateText} strike={item.status === "cancelled"} onSelect={() => setSelected(item)} />;
                      })}
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
