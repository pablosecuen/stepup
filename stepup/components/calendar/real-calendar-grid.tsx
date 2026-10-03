"use client";

import { useEffect, useState } from "react";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { isActiveReplacement, visibleCalendarItems } from "@/lib/calendar/occurrences";
import { getCancelledSlotReuseDecision } from "@/lib/calendar/mutations";
import {
  DAY_COLUMN_MIN_WIDTH_PX,
  HOURS,
  HOUR_HEIGHT_PX,
  TIME_COLUMN_WIDTH_PX,
  WEEKDAY_SHORT,
  currentTimeTop,
  groupItemsByDayKey,
  layoutDayItems,
} from "@/lib/calendar/layout";
import { dayOfMonth, todayDateKey, weekdayIndexMondayFirst } from "@/lib/calendar/civil-calendar";
import { CURRENT_TIME_COLOR } from "@/lib/calendar-theme";
import { RealLessonCard } from "./real-lesson-card";
import { RealLessonDetailModal } from "./real-lesson-detail-modal";

interface RealCalendarGridProps {
  dayKeys: string[]; // 7 claves civiles YYYY-MM-DD (semana) o 1 (día) — nunca Date
  items: CalendarViewItem[];
}

export function RealCalendarGrid({ dayKeys, items }: RealCalendarGridProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarViewItem | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visible = visibleCalendarItems(items);
  const isWeek = dayKeys.length > 1;
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH_PX}px repeat(${dayKeys.length}, minmax(${DAY_COLUMN_MIN_WIDTH_PX}px, 1fr))`;
  const gridMinWidth = TIME_COLUMN_WIDTH_PX + dayKeys.length * DAY_COLUMN_MIN_WIDTH_PX;
  const hourGridlinesStyle = { backgroundImage: "linear-gradient(to bottom, #E3E5E8 1px, transparent 1px)", backgroundSize: `100% ${HOUR_HEIGHT_PX}px` };

  const nowLineTop = now ? currentTimeTop(now) : null;
  // "Hoy" y el día de cada tarjeta se resuelven como claves civiles en la zona del calendario: igual en servidor (UTC) y navegador.
  const todayKey = now ? todayDateKey(now) : null;
  const itemsByDayKey = groupItemsByDayKey(visible);

  return (
    <div>
      <div className="overflow-x-auto px-4 pb-8 sm:px-8">
        <div className="rounded-lg border border-border bg-surface shadow-card" style={{ minWidth: gridMinWidth }}>
          <div className="grid rounded-t-lg border-b border-border" style={{ gridTemplateColumns }}>
            <div />
            {dayKeys.map((dayKey) => {
              const today = todayKey === dayKey;
              return (
                <div key={dayKey} className={`flex flex-col items-center gap-1 py-2.5 text-center ${today ? "rounded-t-lg bg-brandBlue/5" : ""}`}>
                  {isWeek && (
                    <span className={`text-[11px] font-semibold tracking-wide ${today ? "text-brandBlue" : "text-textMuted"}`}>{WEEKDAY_SHORT[weekdayIndexMondayFirst(dayKey)]}</span>
                  )}
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors ${today ? "bg-brandBlue text-white" : "text-textPrimary"}`}
                  >
                    {dayOfMonth(dayKey)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="grid" style={{ gridTemplateColumns, height: HOURS.length * HOUR_HEIGHT_PX }}>
            <div className="relative">
              {HOURS.map((hour) => (
                <div key={hour} className="relative" style={{ height: HOUR_HEIGHT_PX }}>
                  <span className="absolute -top-2 right-1.5 text-[11px] text-textMuted">{String(hour).padStart(2, "0")}:00</span>
                </div>
              ))}
            </div>

            {dayKeys.map((dayKey) => {
              const today = todayKey === dayKey;
              const positioned = layoutDayItems(itemsByDayKey.get(dayKey) ?? []);

              return (
                <div key={dayKey} className={`relative border-l border-border ${today ? "bg-brandBlue/[0.03]" : ""}`} style={hourGridlinesStyle}>
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
                      isElapsed={positionedItem.item.status !== "cancelled" && new Date(positionedItem.item.end).getTime() <= (now ?? new Date()).getTime()}
                      isActiveReplacement={isActiveReplacement(positionedItem.item, items)}
                      onSelect={() => setSelected(positionedItem.item)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <RealLessonDetailModal
          item={selected}
          canReuseSlot={now ? getCancelledSlotReuseDecision(selected, items, now).eligible : false}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
