"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

let count: number | null = null, refreshedAt = 0;
let pending: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const snapshot = () => count;
const serverSnapshot = () => null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); if (listeners.size === 0) { count = null; refreshedAt = 0; generation++; pending = null; } };
}
async function refresh(force = false) {
  if (pending) return pending;
  if (!force && Date.now() - refreshedAt < 30000) return;
  const requestGeneration = generation;
  pending = (async () => {
    try {
      const response = await fetch("/api/registro/pendientes", { cache: "no-store" });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("count" in data) || !Number.isInteger(data.count) || Number(data.count) < 0) return;
      if (listeners.size === 0 || generation !== requestGeneration) return;
      count = Number(data.count); refreshedAt = Date.now(); listeners.forEach(listener => listener());
    } catch { /* An unavailable count is not presented as zero. */ }
    finally { if (generation === requestGeneration) pending = null; }
  })();
  return pending;
}

/** All three navigation presentations share one read and one count, never an invented notification. */
export function RegistrationNavBadge({ floating = false }: { floating?: boolean }) {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const pathname = usePathname(), previous = useRef(pathname);
  useEffect(() => {
    void refresh(pathname.startsWith("/registro") || previous.current.startsWith("/registro"));
    previous.current = pathname;
    const update = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", update);
    window.addEventListener("tf-registration-updated", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("tf-registration-updated", update); };
  }, [pathname]);
  if (value == null || value === 0) return null;
  return <span aria-label={`${value} clases por registrar`} className={`${floating ? "absolute -right-0.5 -top-1" : "ml-auto"} inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-white/70 bg-[#B7242A] px-1 text-[10.5px] font-bold leading-none text-white`}>
    <span aria-hidden>{value > 99 ? "99+" : value}</span>
  </span>;
}
