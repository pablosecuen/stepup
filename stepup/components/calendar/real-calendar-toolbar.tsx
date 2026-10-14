import PrivateLink from "@/components/nav/private-link";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { addDaysToDateKey } from "@/lib/calendar/timezone";
import { calendarHeaderNav } from "@/lib/calendar/header";

interface RealCalendarToolbarProps {
  view: "week" | "day";
  /** Lunes de la semana visible, clave civil YYYY-MM-DD. */
  weekStartKey: string;
  /** Día visible en la vista de día, clave civil YYYY-MM-DD. */
  dayKey: string;
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
}

const ARROW_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-textSecondary transition-colors duration-150 ease-premium hover:bg-paperDeep hover:text-ink motion-reduce:transition-none";

/**
 * Navegación temporal del encabezado: «‹ octubre 2026 ›» y nada más (sin «Hoy» ni el rango de la semana, que ya dicen las
 * columnas). Las flechas cambian de semana en Semana y de día en Día; el mes y el año salen de la fecha ancla (`header.ts`).
 */
export function RealCalendarToolbar({ view, weekStartKey, dayKey, buildHref }: RealCalendarToolbarProps) {
  const isWeek = view === "week";
  const previousHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, -7) }) : buildHref({ day: addDaysToDateKey(dayKey, -1) });
  const nextHref = isWeek ? buildHref({ week: addDaysToDateKey(weekStartKey, 7) }) : buildHref({ day: addDaysToDateKey(dayKey, 1) });
  const { monthLabel, previousLabel, nextLabel } = calendarHeaderNav(view, weekStartKey, dayKey);

  return (
    <div className="flex items-center justify-between gap-1 nav:justify-end">
      <PrivateLink href={previousHref} aria-label={previousLabel} className={`min-h-11 min-w-11 ${ARROW_BUTTON}`}>
        <ChevronLeftIcon className="h-5 w-5" aria-hidden />
      </PrivateLink>
      <p data-calendar-month className="min-w-[8.5rem] text-center font-display text-[20px] font-medium leading-none tracking-[-0.01em] text-textPrimary">
        {monthLabel}
      </p>
      <PrivateLink href={nextHref} aria-label={nextLabel} className={`min-h-11 min-w-11 ${ARROW_BUTTON}`}>
        <ChevronRightIcon className="h-5 w-5" aria-hidden />
      </PrivateLink>
    </div>
  );
}
