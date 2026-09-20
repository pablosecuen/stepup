import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { formatDayLabel, formatWeekRange } from "@/lib/calendar/layout";

interface RealCalendarToolbarProps {
  view: "week" | "day";
  weekStart: Date;
  day: Date;
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function RealCalendarToolbar({ view, weekStart, day, buildHref }: RealCalendarToolbarProps) {
  const isWeek = view === "week";
  const previousHref = isWeek
    ? buildHref({ week: toDateKey(new Date(weekStart.getTime() - 7 * 86_400_000)) })
    : buildHref({ day: toDateKey(new Date(day.getTime() - 86_400_000)) });
  const nextHref = isWeek
    ? buildHref({ week: toDateKey(new Date(weekStart.getTime() + 7 * 86_400_000)) })
    : buildHref({ day: toDateKey(new Date(day.getTime() + 86_400_000)) });
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
        {isWeek ? formatWeekRange(weekStart) : formatDayLabel(day)}
      </h2>
      <div className="flex items-center gap-1 rounded-pill border border-border bg-background p-1">
        <Link
          href={buildHref({ view: "week", week: toDateKey(weekStart) })}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${isWeek ? "bg-brandBlue text-white" : "text-textSecondary"}`}
        >
          Semana
        </Link>
        <Link
          href={buildHref({ view: "day", day: toDateKey(day) })}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${!isWeek ? "bg-brandBlue text-white" : "text-textSecondary"}`}
        >
          Día
        </Link>
      </div>
    </div>
  );
}
