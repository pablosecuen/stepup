"use client";

import { useEffect } from "react";
import { isEditableElement, isSoftKeyboardOpen, nextBaseline, type KeyboardBaseline, type ScreenSides, type ViewportMeasure } from "@/lib/ui/soft-keyboard";

const ATTRIBUTE = "data-tf-keyboard";

function measure(): ViewportMeasure {
  const viewport = window.visualViewport;
  // Con zoom (pellizco, zoom de accesibilidad) el viewport visual mide menos pero no hay teclado: se normaliza por la escala.
  return { width: window.innerWidth, visibleHeight: viewport ? viewport.height * viewport.scale : window.innerHeight };
}

function screenSides(): ScreenSides | null {
  const { width, height } = window.screen ?? { width: 0, height: 0 };
  return width > 0 && height > 0 ? { short: Math.min(width, height), long: Math.max(width, height) } : null;
}

/**
 * Marca `<html data-tf-keyboard="open">` mientras el teclado en pantalla está abierto (ver `lib/ui/soft-keyboard.ts`). El CSS global lo usa para que la barra inferior —que pertenece al
 * borde inferior de la aplicación— no suba con el teclado ni deje una franja vacía debajo: mientras está abierto se oculta y se anula la zona segura inferior; al cerrarlo todo vuelve en
 * el mismo cuadro (no hay animación ni relleno residual). Es una sola pieza compartida por TODAS las pantallas: ningún formulario sabe nada del teclado. No toca el scroll ni el zoom.
 */
export function SoftKeyboardSync() {
  useEffect(() => {
    const root = document.documentElement;
    let baseline: KeyboardBaseline | null = null;
    let frame = 0;
    let timer = 0;

    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      frame = 0;
      timer = 0;
      const current = measure();
      // El alto estable sólo crece (`nextBaseline`): con el teclado abierto el alto reducido nunca lo baja.
      const editableFocused = isEditableElement(document.activeElement);
      baseline = nextBaseline(baseline, current, screenSides());
      const open = isSoftKeyboardOpen({ editableFocused, baseline, measure: current });
      if (open) root.setAttribute(ATTRIBUTE, "open");
      else root.removeAttribute(ATTRIBUTE);
    };
    // Un cuadro de animación y, por si la pestaña está en segundo plano (no hay cuadros), un temporizador corto: el que llegue primero actualiza.
    const schedule = () => {
      if (frame || timer) return;
      frame = window.requestAnimationFrame(update);
      timer = window.setTimeout(update, 80);
    };

    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", schedule);
    // Al soltar el campo el teclado tarda unos cuadros en bajar: se revisa enseguida y otra vez cuando el viewport ya se asentó.
    const onFocusOut = () => {
      schedule();
      window.setTimeout(schedule, 120);
      window.setTimeout(schedule, 400);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      viewport?.removeEventListener("resize", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", onFocusOut);
      root.removeAttribute(ATTRIBUTE);
    };
  }, []);
  return null;
}
