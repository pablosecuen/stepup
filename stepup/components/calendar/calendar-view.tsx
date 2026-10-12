import PrivateLink from "@/components/nav/private-link";
import { ClipboardDocumentCheckIcon, ClockIcon, PlusIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { visibleCalendarItems, type CalendarViewItem } from "@/lib/calendar/occurrences";
import { RealCalendarToolbar } from "@/components/calendar/real-calendar-toolbar";
import { RealCalendarGrid } from "@/components/calendar/real-calendar-grid";

/**
 * Calendario (presentación): encabezado con los accesos a Series, Disponibilidad y Clases por registrar, «Nueva clase» como
 * acción principal, barra de período y la grilla (escritorio) o la agenda por día (móvil). La página resuelve los datos.
 */
export function CalendarView({
  view,
  weekStartKey,
  dayKey,
  dayKeys,
  items,
  buildHref,
}: {
  view: "week" | "day";
  weekStartKey: string;
  dayKey: string;
  dayKeys: string[];
  items: CalendarViewItem[];
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
}) {
  return (
    <div className={PAGE_WIDTH.wide}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Calendario</PageTitle>
          <nav aria-label="Secciones del calendario" className="mt-1 flex flex-wrap items-center gap-x-4">
            <PrivateLink href="/calendario/series" className={linkClass()}>
              <Squares2X2Icon className="h-4 w-4" aria-hidden />
              Series
            </PrivateLink>
            <PrivateLink href="/calendario/disponibilidad" className={linkClass()}>
              <ClockIcon className="h-4 w-4" aria-hidden />
              Disponibilidad
            </PrivateLink>
            <PrivateLink href="/registro" className={linkClass()}>
              <ClipboardDocumentCheckIcon className="h-4 w-4" aria-hidden />
              Clases por registrar
            </PrivateLink>
          </nav>
        </div>
        <PrivateButtonLink href="/calendario/nueva" variant="accent">
          <PlusIcon className="h-5 w-5" aria-hidden />
          Nueva clase
        </PrivateButtonLink>
      </div>

      <RealCalendarToolbar view={view} weekStartKey={weekStartKey} dayKey={dayKey} buildHref={buildHref} />
      {visibleCalendarItems(items).length === 0 && (
        <div className="mt-4">
          <Notice tone="info">
            {view === "week" ? "No hay clases esta semana." : "No hay clases este día."}{" "}
            <PrivateLink href="/calendario/nueva" className={linkClass()}>
              Programar una clase
            </PrivateLink>
          </Notice>
        </div>
      )}
      <div className="mt-4">
        <RealCalendarGrid dayKeys={dayKeys} items={items} />
      </div>
    </div>
  );
}
