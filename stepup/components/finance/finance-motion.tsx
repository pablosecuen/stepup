"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Animate only actual marks, once when visible; values, labels and final geometry never change. */
export function FinanceMotion({ children, className, signature = "" }: { children: ReactNode; className?: string; signature?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const presented = useRef<string | null>(null);
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  useLayoutEffect(() => {
    const element = root.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || reduce.matches) return;
    const rect = element.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    // HTML already painted before hydration must never jump from its final value back to zero.
    if (!hydrated) { if (visible) presented.current = signature; return; }
    if (presented.current === signature) return;
    presented.current = signature;
    const animations: Animation[] = [];
    let observed = true;
    const run = () => {
      if (!observed) return;
      observed = false;
      element.querySelectorAll<HTMLElement | SVGElement>("[data-tf-finance-bar]").forEach((bar, index) => {
        if (!bar.animate) return;
        bar.style.transformOrigin = "center bottom";
        bar.style.transformBox = "fill-box";
        animations.push(bar.animate([{ transform: "scaleY(.025)" }, { transform: "scaleY(1)" }], { duration: 800, delay: Math.min(index * 24, 160), easing: "cubic-bezier(.2,.75,.2,1)" }));
      });
      element.querySelectorAll<SVGCircleElement>("[data-tf-finance-arc]").forEach((arc, index) => {
        const target = arc.getAttribute("stroke-dasharray");
        if (!target || !arc.animate) return;
        animations.push(arc.animate([{ strokeDasharray: "0 100" }, { strokeDasharray: target }], { duration: 900, delay: Math.min(index * 30, 90), easing: "cubic-bezier(.2,.75,.2,1)" }));
      });
    };
    // For client navigation, start before the first paint; below the fold, start on entry.
    const cancel = () => {
      if (observed || animations.some(animation => animation.playState !== "finished")) presented.current = null;
      observed = false;
      animations.forEach(animation => animation.cancel());
    };
    reduce.addEventListener("change", cancel);
    if (visible || !("IntersectionObserver" in window)) { run(); return () => { reduce.removeEventListener("change", cancel); cancel(); }; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { run(); observer.disconnect(); } }, { threshold: 0.12 });
    observer.observe(element);
    return () => { reduce.removeEventListener("change", cancel); observer.disconnect(); cancel(); };
  }, [signature, hydrated]);
  return <div ref={root} className={className}>{children}</div>;
}
