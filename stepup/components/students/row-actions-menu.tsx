"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { buildStudentRowActions } from "@/lib/students/row-actions";
import type { StudentStatus } from "@/lib/db/database.types";

/**
 * Menú de acciones de UN alumno en la lista. El botón nombra al alumno («Acciones de …»), el menú repite su nombre arriba y cada destino lleva el id de ESA fila, así nunca se actúa sobre el alumno
 * equivocado. Se cierra con Escape, al tocar afuera o al elegir una opción, y devuelve el foco al botón. Está FUERA del enlace del perfil: no anida controles dentro de un enlace.
 */
export function StudentRowActionsMenu({ student, nextClassStart }: { student: { id: string; name: string; status: StudentStatus }; nextClassStart: string | null }) {
  const [open, setOpen] = useState(false);
  // Posición fija calculada al abrir: la tabla de escritorio recorta lo que sale de su contenedor, y las últimas filas necesitan abrir hacia arriba.
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const actions = buildStudentRowActions({ id: student.id, status: student.status, nextClassStart });

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
    <div ref={rootRef} className="relative z-10 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Acciones de ${student.name}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            const spaceBelow = window.innerHeight - rect.bottom;
            setPosition(spaceBelow >= 380 ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
          }
          setOpen(true);
        }}
        className="flex h-11 w-11 items-center justify-center rounded-md text-textSecondary transition-colors hover:bg-paperDeep hover:text-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <EllipsisVerticalIcon className="h-6 w-6" aria-hidden />
      </button>
      {open && position && (
        <div id={menuId} role="group" aria-label={`Acciones de ${student.name}`} style={position} className="fixed z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border-[1.5px] border-border bg-surface p-1.5 shadow-cardHover">
          <p className="px-3 pb-1.5 pt-1 text-[13px] font-bold text-textMuted [overflow-wrap:anywhere]">{student.name}</p>
          <ul>
            {actions.map((action) => (
              <li key={action.key}>
                <PrivateLink href={action.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-md px-3 text-[15px] font-[650] text-textPrimary hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                  {action.label}
                </PrivateLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
