"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { CALENDAR_DENSITIES, calendarDensityLabel, moveActiveDensity, type CalendarDensityKey, type DensityPickerKey } from "@/lib/calendar/density";

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<DensityPickerKey>(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * Selector de densidad de la grilla: un único control secundario y pequeño, «Densidad: Compacta ▾». Cerrado sólo muestra el valor
 * actual; las tres opciones (Compacta · Media · Amplia) aparecen al abrirlo. Patrón «combobox de sólo selección» (ARIA 1.2): el
 * foco queda en el botón y la opción resaltada se anuncia con `aria-activedescendant`.
 *
 * Teclado: Flecha abajo/arriba, Enter o Espacio abren; con la lista abierta las flechas, Inicio y Fin mueven, Enter o Espacio
 * eligen, Escape cierra sin cambiar (el foco vuelve al botón) y Tab cierra. Sólo escritorio (en móvil la agenda por día no cambia).
 * Sin animaciones: nada que reducir con «reducir movimiento».
 */
export function CalendarDensityPicker({ value, onChange }: { value: CalendarDensityKey; onChange: (next: CalendarDensityKey) => void }) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, CALENDAR_DENSITIES.findIndex((density) => density.key === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  // El Espacio elegido con la lista abierta no debe volver a abrirla al soltar la tecla (el clic nativo del botón llega en keyup).
  const swallowSpaceKeyUp = useRef(false);
  const optionId = (index: number) => `${listId}-${CALENDAR_DENSITIES[index].key}`;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    onChange(CALENDAR_DENSITIES[index].key);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (NAVIGATION_KEYS.has(event.key) && event.key !== "Home" && event.key !== "End") {
        event.preventDefault();
        openList();
      }
      return; // Enter y Espacio abren por el clic nativo del botón
    }
    if (NAVIGATION_KEYS.has(event.key)) {
      event.preventDefault();
      setActiveIndex((index) => moveActiveDensity(index, event.key as DensityPickerKey));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      swallowSpaceKeyUp.current = event.key === " ";
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative z-30 hidden nav:block">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Densidad del calendario"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === " " && swallowSpaceKeyUp.current) event.preventDefault();
          swallowSpaceKeyUp.current = false;
        }}
        className="inline-flex min-h-11 w-[180px] items-center justify-between gap-1.5 rounded-md border-[1.5px] border-border bg-transparent px-2.5 text-[14px] font-medium text-textSecondary transition-colors hover:border-borderMid hover:text-textPrimary focus-visible:border-ink focus-visible:text-textPrimary focus-visible:shadow-focus focus-visible:outline-none motion-reduce:transition-none"
      >
        <span className="truncate">Densidad: {calendarDensityLabel(value)}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label="Densidad del calendario"
        hidden={!open}
        className="absolute left-0 top-full z-40 mt-1 w-[180px] overflow-hidden rounded-md border-[1.5px] border-borderMid bg-surface p-1 shadow-panel"
      >
        {CALENDAR_DENSITIES.map((density, index) => {
          const selected = density.key === value;
          return (
            <li
              key={density.key}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              onPointerEnter={() => setActiveIndex(index)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 text-[14px] text-textPrimary ${index === activeIndex ? "bg-paperDeep" : ""} ${selected ? "font-bold" : "font-medium"}`}
            >
              {density.label}
              {selected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
