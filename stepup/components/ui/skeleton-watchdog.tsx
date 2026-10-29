"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/** Pasado este tiempo un esqueleto deja de fingir progreso: dice que tarda y ofrece Reintentar. Nunca queda un esqueleto infinito. */
export const SKELETON_GIVE_UP_MS = 15_000;

/**
 * Parte VISIBLE y accesible del esqueleto (el resto es decorativo): si la carga se cuelga, el esqueleto no sigue indefinidamente. Usa un
 * temporizador (no `requestAnimationFrame`), así también corre con la pestaña en segundo plano.
 */
export function SkeletonWatchdog({ retryHref }: { retryHref?: string }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setLate(true), SKELETON_GIVE_UP_MS);
    return () => window.clearTimeout(id);
  }, []);
  if (!late) return null;
  return (
    <div role="alert" className="mt-6 flex flex-col items-start gap-2 rounded-lg border-[1.5px] border-warnLine bg-[#FFF8E5] p-4 text-[14.5px] text-textPrimary">
      <p>Esta pantalla está tardando más de lo habitual en cargar.</p>
      <button type="button" className={buttonClass({ variant: "secondary" })} onClick={() => (retryHref ? window.location.assign(retryHref) : window.location.reload())}>
        Reintentar
      </button>
    </div>
  );
}
