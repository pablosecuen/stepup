"use client";

import { useEffect } from "react";
import { shouldBlurOnWheel } from "@/lib/ui/number-wheel";

// Una sola escucha para TODA la aplicación (no por campo): evita que la rueda del mouse modifique un número enfocado.
// No muestra nada, no cambia valores y deja pasar el desplazamiento de la página (`passive`).
export function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (shouldBlurOnWheel(event.target, document.activeElement)) (event.target as HTMLElement).blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);
  return null;
}
