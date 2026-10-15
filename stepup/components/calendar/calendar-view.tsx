import PrivateLink from "@/components/nav/private-link";
import { ClipboardDocumentCheckIcon, ClockIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { linkClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-header";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { RealCalendarToolbar } from "@/components/calendar/real-calendar-toolbar";
import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";

/**
 * Calendario (presentación). Arriba a la izquierda el título reducido y, debajo, Series, Disponibilidad y Clases por registrar;
 * arriba a la derecha la navegación del período («‹ octubre 2026 ›»). Debajo, una fila de controles (Densidad · Semana/Día ·
 * Nueva clase) y la grilla, que comienza enseguida. En escritorio la pantalla mide exactamente `100dvh` menos la fila superior de «Cerrar sesión» y la grilla ocupa el
 * espacio que queda (la página no se desplaza); en móvil la página fluye normal con la agenda por día. La página resuelve los datos.
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
    <div data-calendar-page className="mx-auto flex w-full max-w-[1180px] flex-col px-4 py-5 nav:h-[calc(100dvh-var(--tf-shell-top))] nav:px-6 nav:pb-4 nav:pt-1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <PageTitle compact>Calendario</PageTitle>
          <nav aria-label="Secciones del calendario" className="flex flex-wrap items-center gap-x-4">
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
        <div className="w-full nav:w-auto">
          <RealCalendarToolbar view={view} weekStartKey={weekStartKey} dayKey={dayKey} buildHref={buildHref} />
        </div>
      </div>

      <CalendarWorkspace
        view={view}
        dayKeys={dayKeys}
        items={items}
        weekHref={buildHref({ view: "week", week: weekStartKey })}
        dayHref={buildHref({ view: "day", day: dayKey })}
        newClassHref="/calendario/nueva"
      />
    </div>
  );
}
