"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** One entrance per list mount; filtering, sorting and expanding do not replay it. */
export function ListCascade({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;
    const animations: Animation[] = [];
    const played = new WeakSet<Element>();
    const run = (row: Element, index: number) => {
      if (played.has(row) || !row.getClientRects().length || !row.animate) return;
      played.add(row);
      animations.push(row.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], {
        duration: 650, delay: Math.min(index * 110, 660), fill: "backwards", easing: "cubic-bezier(.2,.75,.2,1)",
      }));
    };
    const observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top).forEach((entry,index) => { run(entry.target,index); observer.unobserve(entry.target); });
    });
    element.querySelectorAll("[data-tf-cascade-row]").forEach(row => {
      if (row.getClientRects().length) observer.observe(row);
    });
    const stop = () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); };
    reduce.addEventListener("change", stop);
    return () => { reduce.removeEventListener("change", stop); stop(); };
  }, []);
  return <div ref={root} className="tf-list-cascade contents">{children}</div>;
}
