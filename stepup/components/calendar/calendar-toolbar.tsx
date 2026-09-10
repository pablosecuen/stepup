"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { formatWeekRange } from "@/lib/calendar-layout";

interface CalendarToolbarProps {
  weekStart: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarToolbar({ weekStart, onPrevious, onNext, onToday }: CalendarToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          aria-label="Semana anterior"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-textSecondary transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Semana siguiente"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-textSecondary transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          aria-label="Ir a hoy"
          className="rounded-full bg-brandBlue px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Hoy
        </button>
      </div>
      <h2 className="text-sm font-semibold capitalize text-textSecondary sm:text-base">
        {formatWeekRange(weekStart)}
      </h2>
    </div>
  );
}
