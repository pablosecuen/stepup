"use client";

import { useSyncExternalStore } from "react";

// Reloj compartido que avanza una vez por segundo mientras alguna pantalla lo usa. Se lee con `useSyncExternalStore`: en el servidor y al hidratar devuelve `null` (así no hay diferencias entre
// el HTML del servidor y el del navegador) y recién después marca la hora real. Un solo temporizador sirve a todos los que lo leen, y se detiene cuando ya nadie lo usa.

let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => current || (current = Date.now());
const getServerSnapshot = (): null => null;

/** Hora actual en milisegundos, actualizada cada segundo; `null` hasta que la pantalla está hidratada. */
export function useTickingNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
