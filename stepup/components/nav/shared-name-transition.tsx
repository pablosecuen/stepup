"use client";

import { useEffect } from "react";
import { captureSharedName, SHARED_NAME_EVENT, startSharedName, type SharedNameSnapshot } from "@/lib/ui/shared-name";

/** Progressive enhancement: native links, focus, history and server loading remain in charge. */
export function SharedNameTransition() {
  useEffect(() => {
    let stopWatching: (() => void) | null = null;
    let stopFlight: (() => void) | null = null;
    function begin(event: Event) {
      const { snapshot, destination } = (event as CustomEvent<{ snapshot: SharedNameSnapshot; destination: string }>).detail;
      stopWatching?.(); stopFlight?.();
      const path = new URL(destination, window.location.origin).pathname;
      const tryTarget = () => {
        if (window.location.pathname !== path) return;
        const target = [...document.querySelectorAll<HTMLElement>("[data-tf-shared-name]")].find(el => el.textContent?.trim() === snapshot.text && el.getBoundingClientRect().width > 0 && !el.closest("[data-tf-skeleton], [data-tf-route-skeleton]"));
        if (!target || !target.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const box = target.getBoundingClientRect(), style = getComputedStyle(target);
        stopWatching?.();
        const clone = document.createElement("span");
        clone.setAttribute("aria-hidden", "true"); clone.dataset.tfSharedClone = "";
        Object.assign(clone.style, { position: "fixed", left: `${snapshot.left}px`, top: `${snapshot.top}px`, width: `${snapshot.width}px`, font: snapshot.font, color: snapshot.color, margin: "0", pointerEvents: "none", zIndex: "75", transformOrigin: "top left", overflow: "hidden", display: "block" });
        clone.textContent = snapshot.text; document.body.appendChild(clone);
        const previousOpacity = target.style.opacity;
        target.style.opacity = "0";
        let done = false;
        const restore = () => { if (done) return; done = true; target.style.opacity = previousOpacity; clone.remove(); clearTimeout(timer); };
        const timer = window.setTimeout(restore, 450);
        const animation = clone.animate([
          { transform: "translate(0,0)", width: `${snapshot.width}px`, fontSize: snapshot.fontSize, color: snapshot.color },
          { transform: `translate(${box.left - snapshot.left}px,${box.top - snapshot.top}px)`, width: `${box.width}px`, fontSize: style.fontSize, color: style.color },
        ], { duration: 390, easing: "cubic-bezier(.22,.8,.2,1)", fill: "forwards" });
        animation.finished.then(restore).catch(restore);
        stopFlight = () => { animation.cancel(); restore(); };
      };
      const observer = new MutationObserver(tryTarget);
      observer.observe(document.body, { childList: true, subtree: true });
      const timeout = window.setTimeout(() => stopWatching?.(), 6500);
      stopWatching = () => { observer.disconnect(); clearTimeout(timeout); };
      // Navigation may restore already-cached DOM without inserting nodes.
      window.setTimeout(tryTarget, 0);
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      stopWatching?.(); stopFlight?.();
      let source: Element | null = anchor.matches("[data-tf-shared-name]") ? anchor : anchor.querySelector("[data-tf-shared-name]");
      if (!source && /^\/(?:alumnos|cobros\/alumnos)\/[^/]+$/.test(window.location.pathname) && ["/alumnos", "/cobros"].includes(url.pathname)) source = document.querySelector("h1[data-tf-shared-name]");
      startSharedName(captureSharedName(source), url.pathname);
    }
    const cancel = () => { stopWatching?.(); stopFlight?.(); };
    document.addEventListener("click", onClick, true);
    window.addEventListener(SHARED_NAME_EVENT, begin);
    window.addEventListener("resize", cancel);
    window.addEventListener("popstate", cancel);
    return () => { cancel(); document.removeEventListener("click", onClick, true); window.removeEventListener(SHARED_NAME_EVENT, begin); window.removeEventListener("resize", cancel); window.removeEventListener("popstate", cancel); };
  }, []);
  return null;
}
