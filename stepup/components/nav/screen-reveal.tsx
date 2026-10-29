"use client";

import { useEffect } from "react";

/**
 * Cierra la entrada de cada pantalla: cuando termina de aparecer (encabezado → principal → paneles, ver `.tf-screen` en globals.css) le pone
 * `data-tf-revealed`, y desde ahí nada dentro de ella vuelve a animar por ser insertado (un aviso que aparece al guardar, el resultado de un
 * filtro, un campo que se agrega). No usa temporizadores: espera a que terminen las animaciones reales de los hijos directos, así que con
 * «reducir movimiento» (no hay ninguna) la pantalla queda sellada de inmediato. No toca React: sólo un atributo del DOM que React no gestiona.
 * Un solo observador vive en el layout privado; la pantalla siguiente trae su propio contenedor nuevo y vuelve a entrar sola.
 */
function seal(screen: Element) {
  if (screen.hasAttribute("data-tf-revealed") || screen.hasAttribute("data-tf-skeleton") || screen.hasAttribute("data-tf-groups")) return;
  const running = typeof screen.getAnimations === "function" ? screen.getAnimations({ subtree: true }).filter((animation) => (animation.effect as KeyframeEffect | null)?.target?.parentElement === screen) : [];
  if (running.length === 0) {
    screen.setAttribute("data-tf-revealed", "");
    return;
  }
  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => screen.setAttribute("data-tf-revealed", ""));
}

export function ScreenReveal() {
  useEffect(() => {
    const main = document.getElementById("contenido");
    if (!main) return;
    const sealAll = () => main.querySelectorAll(":scope > .tf-screen").forEach(seal);
    sealAll();
    const observer = new MutationObserver(sealAll);
    observer.observe(main, { childList: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
