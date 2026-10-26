"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { inputClass } from "@/components/ui/field";

/**
 * Área de texto que CRECE con su contenido (nunca recorta una línea): una línea queda centrada verticalmente (alto mínimo de campo, 46 px) y las
 * siguientes suman altura. Pasado un máximo (60 % de la pantalla) deja de crecer y se desplaza por dentro (accesible con teclado y táctil). Letra de
 * 16 px (heredada de `inputClass`: iOS no amplía la página) y sin deshabilitar el zoom. Enter es un salto de línea como en cualquier área de texto.
 */
export function AutoGrowTextArea({ className, value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    const borders = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + borders}px`;
  }, []);
  useLayoutEffect(fit, [fit, value]);
  useEffect(() => {
    // El ancho cambia al girar el teléfono o al abrir el teclado: el texto se reparte en otras líneas.
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return <textarea ref={ref} rows={1} value={value} className={`${inputClass} block max-h-[60vh] resize-none overflow-y-auto py-3 leading-normal${className ? ` ${className}` : ""}`} {...props} />;
}
