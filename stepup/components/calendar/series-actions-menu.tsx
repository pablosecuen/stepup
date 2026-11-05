"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

export interface SeriesMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Acción destructiva: va separada, al final y en rojo. */
  destructive?: boolean;
  disabled?: boolean;
}

export interface SeriesMenuGroup {
  key: string;
  heading: string | null;
  items: SeriesMenuItem[];
}

const MENU_HEIGHT_ESTIMATE = 360;

/**
 * Único control «Acciones» de una serie: cerrado por defecto, con las opciones agrupadas (Programación, Miembros y configuración, Estado) y la acción destructiva separada al final. Se
 * abre con posición fija (hacia arriba si abajo no hay lugar) para que la lista con scroll no lo recorte; se cierra con Escape, al tocar afuera, al desplazarse o al elegir una opción —
 * así sólo una tarjeta tiene sus acciones abiertas a la vez—. Funciona con teclado (flechas, Inicio, Fin) y con tacto, con foco visible y `aria-expanded`. La opción elegida la resuelve quien
 * lo usa (abre el formulario en un diálogo y, al cerrarlo, devuelve el foco a este botón).
 */
export function SeriesActionsMenu({ seriesLabel, groups, buttonRef }: { seriesLabel: string; groups: SeriesMenuGroup[]; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function close() {
      setOpen(false);
    }
    // El desplazamiento de la lista o de la página cierra el menú (queda fijo y se desalinearía); el del propio menú, no.
    function closeOnScroll(event: Event) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const right = Math.max(8, window.innerWidth - rect.right);
      const below = Math.max(0, window.innerHeight - rect.bottom - 12);
      const above = Math.max(0, rect.top - 12);
      const openBelow = below >= MENU_HEIGHT_ESTIMATE || below >= above;
      setPosition(openBelow
        ? { top: rect.bottom + 4, right, maxHeight: Math.max(44, below) }
        : { bottom: window.innerHeight - rect.top + 4, right, maxHeight: Math.max(44, above) });
    }
    setOpen(true);
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      const target = items[(next + items.length) % items.length];
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    };
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    } else if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(items.length - 1);
    else if (event.key === "Tab") setOpen(false);
  }

  const regular = groups.filter((group) => group.items.length > 0);
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Acciones de ${seriesLabel}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            toggle();
          }
        }}
        className="tf-motion-button inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] border-borderMid bg-surface px-4 text-[14.5px] font-[650] text-ink hover:border-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      >
        Acciones
        <ChevronDownIcon className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Acciones de ${seriesLabel}`}
          onKeyDown={onMenuKeyDown}
          style={position}
          className="fixed z-50 max-h-[calc(100vh-1.5rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border-[1.5px] border-border bg-surface p-1.5 shadow-card"
        >
          {regular.map((group) => (
            <div key={group.key} role="group" aria-label={group.heading ?? "Acción destructiva"} className={group.items.every((item) => item.destructive) ? "mt-1 border-t-[1.5px] border-border pt-1" : "pb-1"}>
              {group.heading && (
                <p aria-hidden className="px-3 pb-0.5 pt-1.5 text-[12.5px] font-bold text-textMuted">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => (
                <MenuButton key={item.key} item={item} onChoose={() => { setOpen(false); item.onSelect(); }} />
              ))}
            </div>
          ))}
        </div>, document.body
      )}
    </div>
  );
}

function MenuButton({ item, onChoose }: { item: SeriesMenuItem; onChoose: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={onChoose}
      className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-[15px] font-[650] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50 ${item.destructive ? "text-bad hover:bg-badSoft" : "text-textPrimary hover:bg-paperDeep"}`}
    >
      {item.label}
    </button>
  );
}
