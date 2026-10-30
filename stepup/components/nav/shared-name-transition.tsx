"use client";

import { useEffect } from "react";
import { captureSharedName, SHARED_NAME_EVENT, startSharedName, type SharedNameSnapshot } from "@/lib/ui/shared-name";

/** Names are captured by the browser in the same route transition, never flown in after the new page has appeared. */
export function SharedNameTransition() {
  useEffect(() => {
    let restore: (() => void) | null = null;
    function prepare(snapshot: SharedNameSnapshot | null) {
      restore?.();
      if (!snapshot?.element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const element = snapshot.element, previous = element.style.viewTransitionName;
      element.style.viewTransitionName = snapshot.transitionName;
      const timer = window.setTimeout(() => restore?.(), 2000);
      restore = () => { window.clearTimeout(timer); element.style.viewTransitionName = previous; restore = null; };
    }
    function begin(event: Event) {
      prepare((event as CustomEvent<{snapshot: SharedNameSnapshot}>).detail.snapshot);
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      const source = anchor.matches("[data-tf-shared-name]") ? anchor : anchor.querySelector("[data-tf-shared-name]");
      startSharedName(captureSharedName(source), url.pathname);
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener(SHARED_NAME_EVENT, begin);
    return () => { restore?.(); document.removeEventListener("click", onClick, true); window.removeEventListener(SHARED_NAME_EVENT, begin); };
  }, []);
  return null;
}
