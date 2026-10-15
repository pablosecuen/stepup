"use client";

import { useEffect } from "react";

/** Observa todos los bloques `[data-reveal]` de la página con UN solo IntersectionObserver (pasivo, sin bloquear el scroll). */
export function RevealController() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.state = "in";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) continue; // lo que ya se ve nunca se oculta
      el.dataset.state = "pending";
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
