"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { formatCivilDate } from "@/lib/format/date-format";
import { DAY_LOAD_TEXT, type DayLoad } from "@/lib/calendar/time-slot-picker";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const DAY_CLASSES: Record<DayLoad | "out", string> = {
  wide: "border-okLine bg-okSoft",
  limited: "border-warnLine bg-warnSoft",
  none: "border-border bg-paperDeep text-textMuted",
  past: "border-border bg-paperDeep text-textMuted opacity-60",
  out: "border-border bg-paperDeep text-textMuted opacity-60",
};

export interface AvailabilityDay {
  d: string;
  free: number;
  outside: boolean;
  load: DayLoad;
}

/** Seven 44px targets + six 4px gaps = 332px. Scroll only inside an unusually narrow parent. */
export function AvailabilityMonth({ id, month, days, selectedDay, loading, onMonthChange, onDayChange }: {
  id: string;
  month: string;
  days: AvailabilityDay[];
  selectedDay: string;
  loading: boolean;
  onMonthChange: (delta: number) => void;
  onDayChange: (day: string) => void;
}) {
  const label = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
  const firstWeekday = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return <div className="min-w-0 max-w-[420px]" data-availability-month>
    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
      <Button variant="secondary" className="h-11 w-11 shrink-0 !px-0" aria-label="Mes anterior" onClick={() => onMonthChange(-1)}><ChevronLeftIcon className="h-5 w-5" aria-hidden /></Button>
      <p id={id} role="status" aria-live="polite" className="min-w-0 text-center text-[15px] font-semibold text-textPrimary">{label.charAt(0).toUpperCase() + label.slice(1)}</p>
      <Button variant="secondary" className="h-11 w-11 shrink-0 !px-0" aria-label="Mes siguiente" onClick={() => onMonthChange(1)}><ChevronRightIcon className="h-5 w-5" aria-hidden /></Button>
    </div>
    <div className="max-w-full overflow-x-auto px-1 py-1 [scrollbar-width:thin]" data-availability-scroll>
      <div className="grid min-w-[332px] grid-cols-7 gap-1" role="group" aria-labelledby={id} aria-busy={loading}>
        {WEEKDAYS.map((name, index) => <span key={index} aria-hidden className="text-center text-xs font-semibold text-textSecondary">{name}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} aria-hidden />)}
        {days.map(({ d, free, outside, load }) => {
          const disabled = outside || load === "past";
          const selected = selectedDay === d;
          const state = outside ? "fuera del rango permitido" : loading ? "cargando disponibilidad" : DAY_LOAD_TEXT[load];
          return <button key={d} type="button" disabled={disabled} aria-pressed={selected}
            aria-label={`${formatCivilDate(d)}: ${state}${!disabled && !loading ? `, ${free} horarios libres` : ""}${selected ? ", fecha elegida" : ""}`}
            onClick={() => onDayChange(d)}
            className={`flex h-12 min-w-11 w-full flex-col items-center justify-center overflow-hidden rounded-md border text-base leading-tight ${selected ? "border-ink bg-ink text-white" : loading && !disabled ? "border-border bg-surface" : DAY_CLASSES[outside ? "out" : load]}`}>
            <span>{Number(d.slice(-2))}</span>
            {!disabled && !loading && <span className={`text-[11px] ${selected ? "text-white" : "text-textSecondary"}`}>{free}</span>}
          </button>;
        })}
      </div>
    </div>
  </div>;
}
