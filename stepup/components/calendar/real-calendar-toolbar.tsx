import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { formatCivilDayLabel, formatWeekRangeLabel } from "@/lib/calendar/civil-calendar";
import { addDaysToDateKey } from "@/lib/calendar/timezone";

interface RealCalendarToolbarProps {
  view: "week" | "day";
  /** Lunes de la semana visible, clave civil YYYY-MM-DD. */
  weekStartKey: string;
  /** Día visible en la vista de día, clave civil YYYY-MM-DD. */
  dayKey: string;
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
}

export function RealCalendarToolbar({ view, weekStartKey, dayKey, buildHref }: RealCalendarToolbarProps) {
  const isWeek = view === "week";
  const previousHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, -7) }) : buildHref({ day: addDaysToDateKey(dayKey, -1) });
  const nextHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, 7) }) : buildHref({ day: addDaysToDateKey(dayKey, 1) });
  const todayHref = isWeek ? buildHref({ week: undefined }) : buildHref({ day: undefined });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
      <div className="flex items-center gap-2">
        <Link
          href={previousHref}
          aria-label={isWeek ? "Semana anterior" : "Día anterior"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-textSecondary transition-all duration-150 ease-premium hover:border-brandBlue/30 hover:bg-background active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </Link>
        <Link
          href={nextHref}
          aria-label={isWeek ? "Semana siguiente" : "Día siguiente"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-textSecondary transition-all duration-150 ease-premium hover:border-brandBlue/30 hover:bg-background active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </Link>
        <Link
          href={todayHref}
          aria-label="Ir a hoy"
          className="rounded-pill bg-brandBlue px-3.5 py-1.5 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Hoy
        </Link>
      </div>
      <h2 className="text-sm font-semibold capitalize tracking-tight text-textPrimary sm:text-base">
        {isWeek ? formatWeekRangeLabel(weekStartKey) : formatCivilDayLabel(dayKey)}
      </h2>
      <div className="flex items-center gap-1 rounded-pill border border-border bg-background p-1">
        <Link
          href={buildHref({ view: "week", week: weekStartKey })}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${isWeek ? "bg-brandBlue text-white" : "text-textSecondary"}`}
        >
          Semana
        </Link>
        <Link
          href={buildHref({ view: "day", day: dayKey })}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${!isWeek ? "bg-brandBlue text-white" : "text-textSecondary"}`}
        >
          Día
        </Link>
      </div>
    </div>
  );
}
