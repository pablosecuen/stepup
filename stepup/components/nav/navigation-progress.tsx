"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GIVE_UP_AFTER_MS, SLOW_AFTER_MS, decideClick, resolveNavigationIntent } from "@/lib/nav/navigation-intent";

/**
 * Respuesta inmediata al clic en cualquier enlace interno del área privada (≤ 1 fotograma, no espera al servidor):
 *  - barra fina arriba + el enlace pulsado queda marcado (`data-nav-pending`), y un aviso para lectores de pantalla;
 *  - un segundo clic sobre el MISMO destino mientras la navegación está pendiente se ignora (doble clic, Enter repetido);
 *  - NO toca abrir en otra pestaña (Ctrl/Cmd/Shift/Alt + clic, botón central, `target`), enlaces externos, anclas ni la
 *    navegación del propio navegador (atrás/adelante): ahí no hace nada;
 *  - se apaga al cambiar la ruta (completó), al volver atrás y, si la navegación falla o se cuelga, solo a los 20 s;
 *  - no esconde una demora real: pasados 6 s lo dice con texto visible, y la barra deja de avanzar (no es infinita).
 * Es un único escucha en el documento (no un componente por enlace) y no cambia cómo navega Next: sólo lo muestra.
 */
type Phase = "pending" | "slow";

function ProgressInner() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const routeKey = `${pathname}?${search}`;
  const [phase, setPhase] = useState<Phase | null>(null);
  const pendingRef = useRef<{ destination: string; startKey: string; anchor: HTMLAnchorElement } | null>(null);
  const timersRef = useRef<number[]>([]);
  const keyRef = useRef(routeKey);

  function clearPending() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    pendingRef.current?.anchor.removeAttribute("data-nav-pending");
    pendingRef.current = null;
    setPhase(null);
  }

  // La ruta cambió: la navegación pendiente completó (o el usuario fue a otro lado). Se restablece sin esperar nada más.
  useEffect(() => {
    keyRef.current = routeKey;
    if (pendingRef.current && pendingRef.current.startKey !== routeKey) clearPending();
  }, [routeKey]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor) return;
      const intent = resolveNavigationIntent({
        href: anchor.href,
        currentUrl: window.location.href,
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
      });
      if (intent.kind === "ignore") return;
      const decision = decideClick(pendingRef.current?.destination ?? null, intent.destination);
      if (decision === "block_repeat") {
        // Ya se está yendo ahí: este clic no inicia otra navegación (ni la cancela ni la duplica).
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (decision === "replace") clearPending();
      anchor.setAttribute("data-nav-pending", "true");
      pendingRef.current = { destination: intent.destination, startKey: keyRef.current, anchor };
      setPhase("pending");
      timersRef.current = [window.setTimeout(() => setPhase("slow"), SLOW_AFTER_MS), window.setTimeout(clearPending, GIVE_UP_AFTER_MS)];
    }
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", clearPending);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", clearPending);
      clearPending();
    };
  }, []);

  return (
    <>
      {phase && <div aria-hidden className="tf-nav-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] bg-accent" />}
      {phase === "slow" && (
        <div aria-hidden className="pointer-events-none fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-pill border-[1.5px] border-border bg-surface px-4 py-2 text-[13.5px] font-semibold text-textPrimary shadow-panel">
          Sigue cargando… está tardando más de lo habitual.
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {phase === "pending" ? "Cargando…" : phase === "slow" ? "Sigue cargando, está tardando más de lo habitual." : ""}
      </div>
    </>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressInner />
    </Suspense>
  );
}
