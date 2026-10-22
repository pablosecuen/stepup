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
 * espacio que queda. En móvil reserva también las barras y safe areas del acceso anclado y desplaza la grilla por dentro.
 */
/** Los tres accesos del calendario como fichas compactas en el teléfono (36 px de alto, en una sola fila que se desplaza si hace falta); en escritorio siguen siendo enlaces de texto. */
const MOBILE_CHIP = "shrink-0 max-[819px]:relative max-[819px]:before:absolute max-[819px]:before:inset-x-0 max-[819px]:before:-inset-y-1 max-[819px]:before:content-[''] max-[819px]:h-9 max-[819px]:min-h-0 max-[819px]:rounded-pill max-[819px]:border max-[819px]:border-border max-[819px]:bg-surface max-[819px]:px-2 max-[819px]:text-[12px] max-[819px]:no-underline";

export function CalendarView({
  view,
  weekStartKey,
  dayKey,
  dayKeys,
  items,
  buildHref,
  rescheduleItemId,
}: {
  view: "week" | "day";
  weekStartKey: string;
  dayKey: string;
  dayKeys: string[];
  items: CalendarViewItem[];
  buildHref: (params: { week?: string; day?: string; view?: "week" | "day" }) => string;
  /** Abre directo el flujo de reprogramar de esta clase (viene del resultado «Reprogramada» del registro). */
  rescheduleItemId?: string;
}) {
  return (
    // z-40 (por encima del encabezado z-30 y de la barra z-20): al ser `fixed` forma su propio contexto de apilamiento y el detalle de clase (z-50 dentro) quedaría tapado por ellos con un z menor.
    // Teléfono: el calendario se ancla EXACTAMENTE entre el encabezado y la barra inferior (alturas y safe areas del shell, `globals.css`): no se desplaza la página, no se
    // superpone con el encabezado y no deja un hueco debajo; la grilla es lo único que se desplaza. Escritorio: 100dvh menos la fila de «Cerrar sesión», como siempre.
    <div data-calendar-page className="fixed inset-x-0 top-[calc(var(--tf-m-header)+var(--tf-safe-top))] bottom-[calc(var(--tf-m-nav)+var(--tf-safe-bottom))] z-40 flex flex-col bg-background pt-1 nav:static nav:z-auto nav:mx-auto nav:h-[calc(100dvh-var(--tf-shell-top))] nav:w-full nav:max-w-[1360px] nav:bg-transparent nav:px-6 nav:pb-4 nav:pt-1">
      <div className="flex flex-col gap-1 px-3 nav:flex-row nav:flex-wrap nav:items-start nav:justify-between nav:gap-x-4 nav:px-0">
        <div className="min-w-0">
          {/* En el teléfono el título es sólo para lector de pantalla: la barra inferior ya marca «Calendario» y cada renglón de alto cuenta. */}
          <div className="sr-only nav:not-sr-only">
            <PageTitle compact>Calendario</PageTitle>
          </div>
          <nav aria-label="Secciones del calendario" className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 py-0.5 nav:mx-0 nav:flex-wrap nav:gap-x-4 nav:gap-y-0 nav:overflow-visible nav:px-0 nav:py-0">
            <PrivateLink href="/calendario/series" className={`${linkClass()} ${MOBILE_CHIP}`}>
              <Squares2X2Icon className="h-3.5 w-3.5 nav:h-4 nav:w-4" aria-hidden />
              Series
            </PrivateLink>
            <PrivateLink href="/calendario/disponibilidad" className={`${linkClass()} ${MOBILE_CHIP}`}>
              <ClockIcon className="h-3.5 w-3.5 nav:h-4 nav:w-4" aria-hidden />
              Disponibilidad
            </PrivateLink>
            <PrivateLink href="/registro" className={`${linkClass()} ${MOBILE_CHIP}`}>
              <ClipboardDocumentCheckIcon className="h-3.5 w-3.5 nav:h-4 nav:w-4" aria-hidden />
              Clases por registrar
            </PrivateLink>
          </nav>
        </div>
        <div className="order-first w-full nav:order-none nav:w-auto">
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
        rescheduleItemId={rescheduleItemId}
        dayHrefs={Object.fromEntries(dayKeys.map((day) => [day, buildHref({ view: "day", day })]))}
      />
    </div>
  );
}
