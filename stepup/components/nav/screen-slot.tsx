"use client";

import { addTransitionType, startTransition, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/nav/screen-skeleton";
import { activePendingNavigation, getPendingNavigation, readSharedName, subscribePendingNavigation } from "@/lib/nav/pending-destination";
import { isScreenChange, pathnameOf, resolveScreen } from "@/lib/nav/screens";
import type { PendingNavigation } from "@/lib/nav/pending-destination";

export const SKELETON_AFTER_MS = 100;

/**
 * Esqueleto optimista del clic (29/10/2026): apenas se pulsa un enlace a OTRA pantalla se dibuja el esqueleto del destino dentro del
 * contenido —sin esperar al servidor— y la pantalla anterior se oculta (`globals.css`: `.tf-page-main:has(> [data-tf-pending-skeleton])`).
 * Así nunca queda la pantalla anterior congelada mientras el servidor prepara la nueva. El shell (encabezado, navegación lateral o
 * inferior) no se toca. Se retira en el MISMO render en que cambia la ruta (`activePendingNavigation` compara con el `pathname` actual),
 * y como el esqueleto de `loading.tsx` sale de la misma entrada (`RouteSkeleton`), el relevo no se ve.
 * No hace nada si el destino es la misma pantalla con otros parámetros (pestañas, filtros, semanas): esas se actualizan en su sitio.
 */
export function ScreenSlot() {
  const pathname = usePathname();
  const pending = useSyncExternalStore(subscribePendingNavigation, getPendingNavigation, () => null);
  const active = activePendingNavigation(pending, pathname);
  const [visible, setVisible] = useState<PendingNavigation | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      if (getPendingNavigation() === active) startTransition(() => { addTransitionType("tf-navigation"); setVisible(active); });
    }, SKELETON_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  // Cached responses crossfade directly. Slow responses get the skeleton, with no minimum display time.
  if (!active || visible !== active || !isScreenChange(pathname, active.destination) || !resolveScreen(pathnameOf(active.destination))) return null;
  return <RouteSkeleton path={pathnameOf(active.destination)} optimistic retryHref={active.destination} sharedName={readSharedName(pathnameOf(active.destination))} />;
}
