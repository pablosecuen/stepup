"use client";

import { useEffect, useMemo, useState } from "react";
import { CALENDAR_FIXTURE_LESSONS, type CalendarFixtureLesson } from "@/lib/calendar-fixtures";
import {
  DAY_COLUMN_MIN_WIDTH_PX,
  HOURS,
  HOUR_HEIGHT_PX,
  TIME_COLUMN_WIDTH_PX,
  WEEKDAY_SHORT,
  addDays,
  currentTimeTop,
  isActiveReplacement,
  isSameDay,
  layoutDayLessons,
  resolveLessonEnd,
  resolveLessonStart,
  startOfWeek,
  visibleWeekLessons,
} from "@/lib/calendar-layout";
import { CURRENT_TIME_COLOR } from "@/lib/calendar-theme";
import { CalendarToolbar } from "./calendar-toolbar";
import { LessonCard } from "./lesson-card";
import { LessonDetailModal } from "./lesson-detail-modal";

const GRID_TEMPLATE_COLUMNS = `${TIME_COLUMN_WIDTH_PX}px repeat(7, minmax(${DAY_COLUMN_MIN_WIDTH_PX}px, 1fr))`;
const GRID_MIN_WIDTH = TIME_COLUMN_WIDTH_PX + 7 * DAY_COLUMN_MIN_WIDTH_PX;
const HOUR_GRIDLINES_STYLE = {
  backgroundImage: "linear-gradient(to bottom, #E3E5E8 1px, transparent 1px)",
  backgroundSize: `100% ${HOUR_HEIGHT_PX}px`,
};

export function WeekCalendar() {
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<{ lesson: CalendarFixtureLesson; start: Date } | null>(null);

  // Se calcula en el cliente (nunca en el server) para que "hoy"/"ahora"
  // siempre reflejen la hora real del navegador de quien mira la vista
  // previa — evita cualquier desajuste de huso horario servidor/cliente.
  useEffect(() => {
    const initial = new Date();
    setWeekStart(startOfWeek(initial));
    setNow(initial);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const days = useMemo(() => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : []), [weekStart]);

  if (!weekStart || !now) {
    return <div className="px-4 py-8 text-sm text-textMuted sm:px-8">Cargando calendario…</div>;
  }

  const nowLineTop = currentTimeTop(now);

  return (
    <div>
      <CalendarToolbar
        weekStart={weekStart}
        onPrevious={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onToday={() => setWeekStart(startOfWeek(new Date()))}
      />

      {/* Desplazamiento horizontal contenido acá adentro — la página nunca
          desborda de costado, sólo esta caja, cuando el ancho no alcanza
          para las 7 columnas legibles. */}
      <div className="overflow-x-auto px-4 pb-8 sm:px-8">
        {/* Sin overflow-hidden acá: una tarjeta que necesite crecer verticalmente
            (título largo, ver LessonCard) nunca debe quedar cortada por el
            borde redondeado del contenedor. */}
        <div className="rounded-lg border border-border bg-surface shadow-card" style={{ minWidth: GRID_MIN_WIDTH }}>
          <div
            className="grid rounded-t-lg border-b border-border"
            style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
          >
            <div />
            {days.map((day, index) => {
              const today = isSameDay(day, now);
              return (
                <div
                  key={index}
                  className={`flex flex-col items-center gap-1 py-2.5 text-center ${today ? "rounded-t-lg bg-brandBlue/5" : ""}`}
                >
                  <span className={`text-[11px] font-semibold tracking-wide ${today ? "text-brandBlue" : "text-textMuted"}`}>
                    {WEEKDAY_SHORT[index]}
                  </span>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                      today ? "bg-brandBlue text-white" : "text-textPrimary"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="grid" style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, height: HOURS.length * HOUR_HEIGHT_PX }}>
            <div className="relative">
              {HOURS.map((hour) => (
                <div key={hour} className="relative" style={{ height: HOUR_HEIGHT_PX }}>
                  <span className="absolute -top-2 right-1.5 text-[11px] text-textMuted">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            {days.map((day, dayIndex) => {
              const today = isSameDay(day, now);
              // Nunca dos tarjetas relacionadas en el mismo horario: una
              // cancelada con reemplazo activo (o un reemplazo ya cancelado)
              // no se dibuja — ver visibleWeekLessons(). El color de cada
              // tarjeta visible se sigue resolviendo contra el universo
              // COMPLETO (CALENDAR_FIXTURE_LESSONS), nunca el filtrado.
              const dayLessons = visibleWeekLessons(CALENDAR_FIXTURE_LESSONS).filter(
                (lesson) => lesson.dayOffset === dayIndex
              );
              const positioned = layoutDayLessons(weekStart, dayLessons);

              return (
                <div
                  key={dayIndex}
                  className={`relative border-l border-border ${today ? "bg-brandBlue/[0.03]" : ""}`}
                  style={HOUR_GRIDLINES_STYLE}
                >
                  {today && nowLineTop !== null && (
                    <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowLineTop }}>
                      <div className="relative h-0.5" style={{ backgroundColor: CURRENT_TIME_COLOR }}>
                        <div
                          className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full"
                          style={{ backgroundColor: CURRENT_TIME_COLOR }}
                        />
                      </div>
                    </div>
                  )}

                  {positioned.map((item) => {
                    const start = resolveLessonStart(weekStart, item.lesson);
                    const end = resolveLessonEnd(weekStart, item.lesson);
                    return (
                      <LessonCard
                        key={item.lesson.id}
                        positioned={item}
                        start={start}
                        isElapsed={item.lesson.status !== "cancelled" && end.getTime() <= now.getTime()}
                        isActiveReplacement={isActiveReplacement(item.lesson, CALENDAR_FIXTURE_LESSONS)}
                        onSelect={() => setSelected({ lesson: item.lesson, start })}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <LessonDetailModal lesson={selected.lesson} start={selected.start} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
