"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Mientras se confirma un pago, la pantalla se vuelve a leer cada 20 segundos durante 5 minutos (y se detiene sola). Sólo RELEE el
// estado guardado: no activa nada ni cambia nada.
export function AutoRefresh({ everyMs = 20_000, maxTimes = 15 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let times = 0;
    const timer = window.setInterval(() => {
      times += 1;
      router.refresh();
      if (times >= maxTimes) window.clearInterval(timer);
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, maxTimes]);
  return null;
}
