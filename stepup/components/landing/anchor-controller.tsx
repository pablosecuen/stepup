"use client";

import { useEffect } from "react";

/** Cuánto debe mantenerse quieto el destino para darlo por alineado, y el tiempo máximo que se le sigue. */
const STABLE_FRAMES = 8;
const MAX_MS = 1500;

/**
 * Lleva un destino a su lugar (su `scroll-margin-top` bajo el encabezado fijo) y lo VUELVE A ALINEAR mientras siga moviéndose.
 * Devuelve la función que lo cancela.
 */
function alignTo(target: HTMLElement): () => void {
  let frame = 0;
  let stable = 0;
  let stopped = false;
  const started = performance.now();
  const margin = () => Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const step = () => {
    if (stopped) return;
    const delta = target.getBoundingClientRect().top - margin();
    if (Math.abs(delta) >= 1) {
      stable = 0;
      window.scrollBy({ top: delta, behavior: "instant" });
    } else {
      stable += 1;
    }
    if (stable >= STABLE_FRAMES || performance.now() - started > MAX_MS) return;
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}

/**
 * Las escenas bajo el primer viewport usan `content-visibility: auto`: hasta dibujarse, su alto es una estimación. Un salto de ancla con
 * scroll suave llegaba con esa estimación y, al dibujarse las escenas del camino, el destino quedaba corrido (más de 500 px en pruebas), de
 * modo que «Cómo funciona» podía dejar la demostración fuera de la pantalla. Este controlador atiende los enlaces `#ancla` de la portada
 * SIN impedir lo nativo (el hash en la URL y el punto de partida del teclado) y, en el cuadro siguiente, interrumpe el desplazamiento suave y
 * alinea el destino, volviéndolo a alinear mientras las escenas vecinas terminan de dibujarse. Con un hash en la dirección al abrir la página
 * hace lo mismo. Si la persona mueve la página por su cuenta (rueda, toque o teclado) deja de corregir.
 */
export function AnchorController() {
  useEffect(() => {
    let cancel = () => {};
    const go = (id: string) => {
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      cancel();
      cancel = alignTo(target);
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href^='#']");
      const href = link?.getAttribute("href");
      if (!href || href.length < 2) return;
      go(decodeURIComponent(href.slice(1)));
    };
    const stop = () => cancel();
    const onHash = () => go(decodeURIComponent(window.location.hash.slice(1)));
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    if (window.location.hash.length > 1) onHash();
    return () => {
      cancel();
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  return null;
}
