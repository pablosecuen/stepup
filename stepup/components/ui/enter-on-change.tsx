"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { REVEAL } from "@/lib/ui/reveal";

/**
 * La MISMA entrada de página para contenido que cambia SIN cambiar de pantalla (pestañas del perfil, semana o día del Calendario,
 * resultados de una búsqueda): cuando `changeKey` cambia, el bloque entra con los parámetros comunes de `lib/ui/reveal.ts` (Web Animations: sólo
 * `opacity` y `transform`). No remonta nada (el estado, el foco y el scroll de adentro se conservan), corre antes de pintar (sin parpadeo)
 * y con «reducir movimiento» no hace nada. La primera vez no anima: la entrada de la pantalla ya la da `.tf-page-main`.
 */
export function EnterOnChange({ changeKey, className, children }: { changeKey: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(changeKey);

  useLayoutEffect(() => {
    if (previous.current === changeKey) return;
    previous.current = changeKey;
    const element = ref.current;
    if (!element || typeof element.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ opacity: 0, transform: `translate3d(0, ${REVEAL.distancePx}px, 0)` }, { opacity: 1, transform: "none" }], { duration: REVEAL.durationMs, easing: REVEAL.easing });
  }, [changeKey]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
