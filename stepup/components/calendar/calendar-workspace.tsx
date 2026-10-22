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
import { EnterOnChange } from "@/components/ui/enter-on-change";
import { RealCalendarGrid } from "./real-calendar-grid";

interface CalendarWorkspaceProps {
  view: "week" | "day";
  dayKeys: string[]; // 7 claves civiles YYYY-MM-DD (semana) o 1 (día) — nunca Date
  items: CalendarViewItem[];
  weekHref: string;
  dayHref: string;
  newClassHref: string;
  /** Clase cuyo flujo de reprogramar se abre directo al entrar (resultado «Reprogramada» del registro). */
  rescheduleItemId?: string;
  dayHrefs?: Record<string, string>;
}

/**
 * Fila de controles y agenda. La fila va inmediatamente encima de la grilla, en tres columnas iguales para que Semana · Día quede
 * realmente centrado respecto del área de contenido (y no del espacio sobrante entre los otros dos): Densidad a la izquierda,
 * Semana · Día al centro y «Nueva clase» a la derecha. En móvil se apilan (Semana · Día y «Nueva clase»; sin Densidad, que allá no
 * cambia nada). La densidad se guarda sólo en el `localStorage` de este navegador.
 */
export function CalendarWorkspace({ view, dayKeys, items, weekHref, dayHref, newClassHref, rescheduleItemId, dayHrefs }: CalendarWorkspaceProps) {
  // La densidad por defecto al cargar (igual en servidor y navegador); la preferencia guardada en ESTE navegador se aplica al montar.
  const [density, setDensity] = useState<CalendarDensityKey>(DEFAULT_CALENDAR_DENSITY);
  // Si el ancho efectivo no alcanza para la grilla, se usa la agenda por día (la de móvil) y Densidad no cambiaría nada: se oculta.
  const [gridFits, setGridFits] = useState(true);

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
    <div className="mt-1.5 flex min-h-0 flex-1 flex-col nav:mt-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 nav:grid-cols-[1fr_auto_1fr] nav:gap-4 nav:px-0">
        <div className="hidden nav:block nav:justify-self-start">
          {gridFits && <CalendarDensityPicker value={density} onChange={chooseDensity} />}
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
        <div className="mt-3 px-3 nav:px-0">
          <Notice tone="info">
            {view === "week" ? "No hay clases esta semana." : "No hay clases este día."}{" "}
            <PrivateLink href={newClassHref} className={linkClass()}>
              Programar una clase
            </PrivateLink>
          </Notice>
        </div>
      )}

      <EnterOnChange changeKey={`${view}|${dayKeys[0]}`} className="mt-1.5 flex min-h-0 flex-1 flex-col nav:mt-2">
        <RealCalendarGrid dayKeys={dayKeys} items={items} density={density} onGridFitChange={setGridFits} rescheduleItemId={rescheduleItemId} dayHrefs={dayHrefs} />
      </EnterOnChange>
    </div>
  );
}
