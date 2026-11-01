"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Prepare each actual chart before it enters; play only inside the readable viewport. */
export function FinanceMotion({ children, className, signature = "" }: { children: ReactNode; className?: string; signature?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const presented = useRef(new WeakMap<Element, string>());
  useLayoutEffect(() => {
    const element = root.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || reduce.matches) return;
    const seen = presented.current;
    const groups = new Map<Element, Animation[]>();
    element.querySelectorAll<HTMLElement | SVGElement>("[data-tf-finance-bar], [data-tf-finance-arc]").forEach((mark,index) => {
      const target = mark.closest("svg") ?? mark.closest("ul") ?? mark.parentElement ?? mark;
      if (seen.get(target) === signature || !mark.animate) return;
      const arc = mark.hasAttribute("data-tf-finance-arc");
      if (!arc) { mark.style.transformOrigin = "center bottom"; mark.style.transformBox = "fill-box"; }
      const animation = mark.animate(arc ? [{strokeDasharray:"0 100"},{strokeDasharray:mark.getAttribute("stroke-dasharray") ?? "0 100"}] : [{transform:"scaleY(.025)"},{transform:"scaleY(1)"}], {
        duration:1000, delay:Math.min(index * 30,150), easing:"cubic-bezier(.2,.75,.2,1)", fill:"backwards",
      });
      animation.pause(); animation.currentTime = 0;
      const animations = groups.get(target) ?? [];
      animations.push(animation); groups.set(target,animations);
    });
    const unfinished = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || entry.intersectionRatio < .35 || seen.get(entry.target) === signature) return;
        observer.unobserve(entry.target);
        seen.set(entry.target,signature); unfinished.add(entry.target);
        const animations = groups.get(entry.target) ?? [];
        animations.forEach(animation => animation.play());
        Promise.allSettled(animations.map(animation => animation.finished)).then(() => unfinished.delete(entry.target));
      });
    }, { threshold:.35, rootMargin:"-64px 0px -12% 0px" });
    groups.forEach((_,target) => observer.observe(target));
    const stop = () => { observer.disconnect(); groups.forEach(animations => animations.forEach(animation => animation.cancel())); };
    reduce.addEventListener("change",stop);
    return () => { reduce.removeEventListener("change",stop); unfinished.forEach(target => seen.delete(target)); stop(); };
  }, [signature]);
  return <div ref={root} className={className}>{children}</div>;
}
