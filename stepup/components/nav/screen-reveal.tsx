"use client";

import { useEffect } from "react";

/**
 * Cierra la entrada de cada pantalla: cuando termina de aparecer (encabezado → principal → paneles, ver `.tf-screen` en globals.css) le pone
 * `data-tf-revealed`, y desde ahí nada dentro de ella vuelve a animar por ser insertado (un aviso que aparece al guardar, el resultado de un
 * filtro, un campo que se agrega). Espera a que terminen las animaciones reales de los hijos directos, con un tope de tiempo (`SEAL_AFTER_MS`) por si
 * la pestaña está en segundo plano y el navegador pausó las animaciones: sellar sólo evita animar de nuevo lo que se inserte después, NUNCA decide
 * si el contenido está disponible (el contenido es visible desde que llega, haya o no animación). Con «reducir movimiento» (no hay ninguna) la
 * pantalla queda sellada de inmediato. No toca React: sólo un atributo del DOM que React no gestiona.
 * Un solo observador vive en el layout privado; la pantalla siguiente trae su propio contenedor nuevo y vuelve a entrar sola.
 */
const SEAL_AFTER_MS = 800;

function seal(screen: Element) {
  if (screen.hasAttribute("data-tf-revealed") || screen.hasAttribute("data-tf-skeleton") || screen.hasAttribute("data-tf-groups")) return;
  const running = typeof screen.getAnimations === "function" ? screen.getAnimations({ subtree: true }).filter((animation) => (animation.effect as KeyframeEffect | null)?.target?.parentElement === screen) : [];
  if (running.length === 0) {
    screen.setAttribute("data-tf-revealed", "");
    return;
  }
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, SEAL_AFTER_MS));
  void Promise.race([Promise.allSettled(running.map((animation) => animation.finished)), timeout]).then(() => screen.setAttribute("data-tf-revealed", ""));
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
