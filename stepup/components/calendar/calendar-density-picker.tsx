"use client";

import { CALENDAR_DENSITIES, type CalendarDensityKey } from "@/lib/calendar/density";

/**
 * Selector de densidad de la grilla (Compacta · Media · Amplia): control segmentado con texto visible y `aria-pressed` (nunca sólo
 * un ícono ni sólo color). Sólo se muestra donde existe la grilla (escritorio); en móvil la agenda por día no cambia con él.
 */
export function CalendarDensityPicker({ value, onChange }: { value: CalendarDensityKey; onChange: (next: CalendarDensityKey) => void }) {
  return (
    <div className="hidden items-center justify-end gap-2.5 pb-2 nav:flex">
      <span id="densidad-etiqueta" className="text-[13.5px] font-semibold text-textMuted">
        Densidad
      </span>
      <div role="group" aria-labelledby="densidad-etiqueta" className="flex items-center gap-1 rounded-md border-[1.5px] border-border bg-paperDeep p-1">
        {CALENDAR_DENSITIES.map((density) => {
          const selected = density.key === value;
          return (
            <button
              key={density.key}
              type="button"
              onClick={() => onChange(density.key)}
              aria-pressed={selected}
              className={`inline-flex min-h-11 items-center rounded-sm px-4 text-[14.5px] font-[650] transition-colors ${selected ? "bg-surface font-bold text-textPrimary shadow-subtle" : "text-textSecondary hover:text-textPrimary"}`}
            >
              {density.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
