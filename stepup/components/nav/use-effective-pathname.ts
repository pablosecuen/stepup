"use client";

import { useSyncExternalStore } from "react";
import { activePendingNavigation, getPendingNavigation, subscribePendingNavigation } from "@/lib/nav/pending-destination";
import { isScreenChange, pathnameOf } from "@/lib/nav/screens";

/**
 * La ruta que la navegación debe MARCAR como activa: la del destino mientras se navega a otra pantalla (la pestaña pulsada ya figura
 * seleccionada junto al esqueleto de su pantalla) y la ruta real el resto del tiempo. Se vuelve a la real en el mismo render en que
 * la ruta cambia, así la pestaña nunca queda en un estado intermedio.
 */
export function useEffectivePathname(pathname: string): string {
  const pending = useSyncExternalStore(subscribePendingNavigation, getPendingNavigation, () => null);
  const active = activePendingNavigation(pending, pathname);
  return active && isScreenChange(pathname, active.destination) ? pathnameOf(active.destination) : pathname;
}
