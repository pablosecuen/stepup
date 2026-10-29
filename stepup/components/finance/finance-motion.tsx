"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Animate only actual marks, once when visible; values, labels and final geometry never change. */
export function FinanceMotion({ children, className, signature = "" }: { children: ReactNode; className?: string; signature?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations: Animation[] = [];
    let observed = true;
    const run = () => {
      if (!observed) return;
      observed = false;
      element.querySelectorAll<HTMLElement | SVGElement>("[data-tf-finance-bar]").forEach((bar, index) => {
        if (!bar.animate) return;
        bar.style.transformOrigin = "center bottom";
        bar.style.transformBox = "fill-box";
        animations.push(bar.animate([{ transform: "scaleY(.025)" }, { transform: "scaleY(1)" }], { duration: 600, delay: Math.min(index * 32, 220), easing: "cubic-bezier(.2,.75,.2,1)" }));
      });
      element.querySelectorAll<SVGCircleElement>("[data-tf-finance-arc]").forEach((arc, index) => {
        const target = arc.getAttribute("stroke-dasharray");
        if (!target || !arc.animate) return;
        animations.push(arc.animate([{ strokeDasharray: "0 100" }, { strokeDasharray: target }], { duration: 700, delay: index * 40, easing: "cubic-bezier(.2,.75,.2,1)" }));
      });
    };
    if (!("IntersectionObserver" in window)) { run(); return () => animations.forEach(animation => animation.cancel()); }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { run(); observer.disconnect(); } }, { threshold: 0.12 });
    observer.observe(element);
    return () => { observed = false; observer.disconnect(); animations.forEach(animation => animation.cancel()); };
  }, [signature]);
  return <div ref={root} className={className}>{children}</div>;
}
