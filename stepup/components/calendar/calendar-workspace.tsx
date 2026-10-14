"use client";

import { useEffect, useState } from "react";
import PrivateLink from "@/components/nav/private-link";
import { PlusIcon } from "@heroicons/react/24/outline";
import { PrivateButtonLink, linkClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { visibleCalendarItems, type CalendarViewItem } from "@/lib/calendar/occurrences";
import { DEFAULT_CALENDAR_DENSITY, readStoredCalendarDensity, writeStoredCalendarDensity, type CalendarDensityKey } from "@/lib/calendar/density";
import { CalendarDensityPicker } from "./calendar-density-picker";
import { CalendarViewSwitch } from "./calendar-view-switch";
import { RealCalendarGrid } from "./real-calendar-grid";

interface CalendarWorkspaceProps {
  view: "week" | "day";
  dayKeys: string[]; // 7 claves civiles YYYY-MM-DD (semana) o 1 (día) — nunca Date
  items: CalendarViewItem[];
  weekHref: string;
  dayHref: string;
  newClassHref: string;
}

/**
 * Fila de controles y agenda. La fila va inmediatamente encima de la grilla, en tres columnas iguales para que Semana · Día quede
 * realmente centrado respecto del área de contenido (y no del espacio sobrante entre los otros dos): Densidad a la izquierda,
 * Semana · Día al centro y «Nueva clase» a la derecha. En móvil se apilan (Semana · Día y «Nueva clase»; sin Densidad, que allá no
 * cambia nada). La densidad se guarda sólo en el `localStorage` de este navegador.
 */
export function CalendarWorkspace({ view, dayKeys, items, weekHref, dayHref, newClassHref }: CalendarWorkspaceProps) {
  // La densidad por defecto al cargar (igual en servidor y navegador); la preferencia guardada en ESTE navegador se aplica al montar.
  const [density, setDensity] = useState<CalendarDensityKey>(DEFAULT_CALENDAR_DENSITY);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    setDensity(readStoredCalendarDensity(storage));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function chooseDensity(next: CalendarDensityKey) {
    setDensity(next);
    try {
      writeStoredCalendarDensity(window.localStorage, next);
    } catch {
      // almacenamiento no disponible: la elección vale para esta pantalla
    }
  }

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col nav:mt-2">
      <div className="grid gap-3 nav:grid-cols-[1fr_auto_1fr] nav:items-center nav:gap-4">
        <div className="nav:justify-self-start">
          <CalendarDensityPicker value={density} onChange={chooseDensity} />
        </div>
        <div className="nav:justify-self-center">
          <CalendarViewSwitch view={view} weekHref={weekHref} dayHref={dayHref} />
        </div>
        <div className="nav:justify-self-end">
          <PrivateButtonLink href={newClassHref} variant="accent" className="w-full nav:w-auto">
            <PlusIcon className="h-5 w-5" aria-hidden />
            Nueva clase
          </PrivateButtonLink>
        </div>
      </div>

      {visibleCalendarItems(items).length === 0 && (
        <div className="mt-3">
          <Notice tone="info">
            {view === "week" ? "No hay clases esta semana." : "No hay clases este día."}{" "}
            <PrivateLink href={newClassHref} className={linkClass()}>
              Programar una clase
            </PrivateLink>
          </Notice>
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col nav:mt-2">
        <RealCalendarGrid dayKeys={dayKeys} items={items} density={density} />
      </div>
    </div>
  );
}
