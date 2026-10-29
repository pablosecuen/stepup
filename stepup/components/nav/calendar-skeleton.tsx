"use client";

import { PlusIcon } from "@heroicons/react/24/outline";
import { useSearchParams } from "next/navigation";
import { CALENDAR_PAGE_CLASS } from "@/components/calendar/calendar-page-class";
import { PAGE_TITLE_COMPACT_CLASS } from "@/components/ui/page-header";
import { ScreenFrame, SkAction, SkBar, SkPill } from "@/components/ui/skeleton-kit";

/**
 * Esqueleto del Calendario (Semana / Día). El Calendario NO usa el contenedor de página de las demás pantallas: ocupa todo el alto
 * disponible (`CALENDAR_PAGE_CLASS`, el mismo de `CalendarView`), con su fila de accesos, la navegación del período, la fila de controles y
 * una grilla que llena el resto. Este esqueleto usa ese mismo contenedor y las mismas filas, así que la geometría y la posición no cambian al
 * llegar la grilla real. Semana o Día se lee de la dirección (`?view=day`), igual que la pantalla.
 */
const HOUR_PX = 56;

export function CalendarSkeleton({ label, optimistic, retryHref }: { label: string; optimistic: boolean; retryHref?: string }) {
  const view = useSearchParams().get("view") === "day" ? "day" : "week";
  const days = view === "day" ? 1 : 7;
  return (
    <ScreenFrame label={label} optimistic={optimistic} retryHref={retryHref} className={CALENDAR_PAGE_CLASS} innerClassName="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 px-3 nav:flex-row nav:flex-wrap nav:items-start nav:justify-between nav:gap-x-4 nav:px-0">
        <div className="min-w-0">
          <p className={`hidden nav:block ${PAGE_TITLE_COMPACT_CLASS}`}>Calendario</p>
          <div className="-mx-3 flex items-center gap-1.5 overflow-hidden px-3 py-0.5 nav:mx-0 nav:gap-x-4 nav:px-0 nav:py-0">
            {["w-20", "w-28", "w-36", "w-24"].map((width, index) => (
              <div key={index} className={`h-9 shrink-0 rounded-pill bg-paperDeep ${width} nav:h-11 nav:rounded-md nav:bg-transparent nav:p-0`}>
                <SkBar className="hidden h-4 w-full nav:mt-3.5 nav:block" />
              </div>
            ))}
          </div>
        </div>
        <div className="order-first w-full nav:order-none nav:w-auto">
          <SkBar className="h-11 w-full nav:w-72" />
        </div>
      </div>

      <div className="mt-1.5 flex min-h-0 flex-1 flex-col nav:mt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 nav:grid-cols-[1fr_auto_1fr] nav:gap-4 nav:px-0">
          <div className="hidden nav:block nav:justify-self-start">
            <SkBar className="h-11 w-44" />
          </div>
          <div className="nav:justify-self-center">
            <SkPill className="h-12 w-44" />
          </div>
          <div className="nav:justify-self-end">
            <SkAction label="Nueva clase" variant="accent" icon={<PlusIcon className="h-5 w-5" />} className="w-full nav:w-auto" />
          </div>
        </div>
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col nav:mt-2">
          <div className="mx-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card nav:mx-0">
            <div className="grid shrink-0 border-b-[1.5px] border-border bg-surface2 py-2" style={{ gridTemplateColumns: `44px repeat(${days}, minmax(0, 1fr))` }}>
              <div />
              {Array.from({ length: days }, (_, index) => (
                <div key={index} className="flex justify-center px-1">
                  <SkBar className="h-8 w-14" />
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1" style={{ backgroundImage: "linear-gradient(to bottom, #E6DAC4 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }} />
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
