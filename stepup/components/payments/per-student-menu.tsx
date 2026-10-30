"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";

export interface PerStudentMenuItem {
  key: string;
  label: string;
  href: string;
}

/**
 * Menú discreto «⋯» de una fila de «Por alumno». No agrega acciones nuevas: sus opciones son los destinos que ya existen (el detalle del alumno, la edición del plan de cobro y la
 * cuota de entrenamiento). El botón nombra al alumno (y al concepto), se cierra con Escape, al tocar afuera o al elegir, y devuelve el foco al botón. Se abre con posición fija, hacia
 * arriba si abajo no hay lugar, para que la tabla no lo recorte.
 */
export function PerStudentMenu({ studentId, label, items }: { studentId: string; label: string; items: PerStudentMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex justify-end">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Acciones de ${label}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            const spaceBelow = window.innerHeight - rect.bottom;
            setPosition(spaceBelow >= 190 ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
          }
          setOpen(true);
        }}
        className="flex h-11 w-9 items-center justify-center rounded-md text-textSecondary transition-colors hover:bg-paperDeep hover:text-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink nav:w-11"
      >
        <EllipsisVerticalIcon className="h-5 w-5" aria-hidden />
      </button>
      {open && position && (
        <div id={menuId} role="group" aria-label={`Acciones de ${label}`} style={position} className="fixed z-50 w-56 max-w-[calc(100vw-2rem)] rounded-lg border-[1.5px] border-border bg-surface p-1.5 shadow-card">
          <p className="px-3 pb-1 pt-1 text-[13px] font-bold text-textMuted [overflow-wrap:anywhere]">{label}</p>
          <ul>
            {items.map((item) => (
              <li key={item.key}>
                <PrivateLink
                  href={item.href}
                  data-per-student-link={studentId}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-3 text-[15px] font-[650] text-textPrimary hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {item.label}
                </PrivateLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
