"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Paralaje leve del héroe: publica el avance del scroll (0 → 1 durante el primer viewport) en `--tf-p`, y los paneles flotantes lo
 * usan con `.tf-par` (clase que sólo existe con «sin reducir movimiento»). Un único listener pasivo con rAF; no toca el layout.
 */
export function Parallax({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight)));
      el.style.setProperty("--tf-p", String(Math.round(progress * 1000) / 1000));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
