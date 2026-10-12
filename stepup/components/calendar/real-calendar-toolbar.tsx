import PrivateLink from "@/components/nav/private-link";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { formatCivilDayLabel } from "@/lib/calendar/civil-calendar";
import { formatCivilWeek } from "@/lib/format/date-format";
import { addDaysToDateKey } from "@/lib/calendar/timezone";
import { buttonClass } from "@/components/ui/button";

interface RealCalendarToolbarProps {
  view: "week" | "day";
  /** Lunes de la semana visible, clave civil YYYY-MM-DD. */
  weekStartKey: string;
  /** Día visible en la vista de día, clave civil YYYY-MM-DD. */
  dayKey: string;
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
}

const ROUND_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-md border-[1.5px] border-borderMid bg-surface text-ink transition-colors duration-150 ease-premium hover:border-ink hover:bg-white active:scale-95";

/** Anterior / siguiente / Hoy, el período visible en serifa y el selector Semana · Día. */
export function RealCalendarToolbar({ view, weekStartKey, dayKey, buildHref }: RealCalendarToolbarProps) {
  const isWeek = view === "week";
  const previousHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, -7) }) : buildHref({ day: addDaysToDateKey(dayKey, -1) });
  const nextHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, 7) }) : buildHref({ day: addDaysToDateKey(dayKey, 1) });
  const todayHref = isWeek ? buildHref({ week: undefined }) : buildHref({ day: undefined });

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-3 nav:gap-x-4">
      <div className="flex items-center gap-2">
        <PrivateLink href={previousHref} aria-label={isWeek ? "Semana anterior" : "Día anterior"} className={`min-h-11 min-w-11 ${ROUND_BUTTON}`}>
          <ChevronLeftIcon className="h-5 w-5" aria-hidden />
        </PrivateLink>
        <PrivateLink href={nextHref} aria-label={isWeek ? "Semana siguiente" : "Día siguiente"} className={`min-h-11 min-w-11 ${ROUND_BUTTON}`}>
          <ChevronRightIcon className="h-5 w-5" aria-hidden />
        </PrivateLink>
        <PrivateLink href={todayHref} aria-label="Ir a hoy" className={buttonClass({ variant: "secondary" })}>
          Hoy
        </PrivateLink>
      </div>
      <h2 className="order-last basis-full font-display text-[26px] font-medium leading-tight tracking-[-0.02em] text-textPrimary first-letter:uppercase nav:order-none nav:basis-auto nav:flex-1 nav:text-[30px]">
        {isWeek ? formatCivilWeek(weekStartKey) : formatCivilDayLabel(dayKey)}
      </h2>
      <div className="flex items-center gap-1 rounded-md border-[1.5px] border-border bg-paperDeep p-1 nav:ml-auto">
        <PrivateLink
          href={buildHref({ view: "week", week: weekStartKey })}
          aria-current={isWeek ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-sm px-4 text-[14.5px] font-[650] transition-colors ${isWeek ? "bg-surface text-textPrimary shadow-subtle" : "text-textSecondary hover:text-textPrimary"}`}
        >
          Semana
        </PrivateLink>
        <PrivateLink
          href={buildHref({ view: "day", day: dayKey })}
          aria-current={!isWeek ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-sm px-4 text-[14.5px] font-[650] transition-colors ${!isWeek ? "bg-surface text-textPrimary shadow-subtle" : "text-textSecondary hover:text-textPrimary"}`}
        >
          Día
        </PrivateLink>
      </div>
    </div>
  );
}
