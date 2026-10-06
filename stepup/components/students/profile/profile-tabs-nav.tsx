"use client";

import { useEffect, useRef } from "react";
import Link from "@/components/nav/private-link";
import { centeredScrollLeft } from "@/lib/nav/tab-scroll";

export type ProfileTabKey = "resumen" | "clases" | "progreso" | "tareas" | "cobros" | "reportes" | "informacion";

const TABS: { key: ProfileTabKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "clases", label: "Clases" },
  { key: "progreso", label: "Progreso" },
  { key: "tareas", label: "Tareas" },
  { key: "cobros", label: "Cobros" },
  { key: "reportes", label: "Reportes" },
  { key: "informacion", label: "Información" },
];

// Mismas 7 pestañas que StudentProfileScreen.tsx en móvil (SegmentedTabs). Cada pestaña es un enlace (navega a ?tab=) con
// `aria-current="page"` en la activa. En un móvil la fila hace scroll horizontal: la pestaña activa se desplaza a la vista
// al montar y cuando cambia (sólo en horizontal: la página no se mueve en vertical).
export function ProfileTabsNav({ studentId, active }: { studentId: string; active: ProfileTabKey }) {
  const scrollerRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = activeRef.current;
    if (!scroller || !tab) return;
    scroller.scrollLeft = centeredScrollLeft({
      containerWidth: scroller.clientWidth,
      contentWidth: scroller.scrollWidth,
      tabLeft: tab.offsetLeft,
      tabWidth: tab.offsetWidth,
    });
  }, [active]);

  return (
    <nav ref={scrollerRef} aria-label="Secciones del perfil" className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                ref={isActive ? activeRef : undefined}
                href={`/alumnos/${studentId}?tab=${tab.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors duration-150 ease-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brandBlue ${
                  isActive ? "border-brandBlue text-brandBlueDark" : "border-transparent text-textSecondary hover:text-textPrimary"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
