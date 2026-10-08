"use client";

import { useEffect } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { buttonClass } from "@/components/ui/button";

/**
 * Vista de error de una ruta (la usan `app/error.tsx` y `app/(app)/error.tsx`). Última defensa de App Router: sólo captura
 * errores lanzados durante el render (o rechazos propagados por React 19 desde una Server Action). No conserva el estado de
 * ningún formulario — por eso los formularios resuelven los errores de red ANTES de llegar acá (ver
 * `lib/actions/network-guard.ts`). Nunca muestra ni registra el mensaje del error (puede traer datos): sólo el `digest`.
 */
export function RouteErrorView({
  error,
  reset,
  homeHref,
  homeLabel,
  inShell,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
  /** true dentro del shell privado (que ya tiene su propio <main>). */
  inShell: boolean;
}) {
  useEffect(() => {
    console.error("[route-error]", error.digest ?? "sin-digest");
  }, [error]);

  const content = (
    <>
      <span aria-hidden className="flex h-[72px] w-[72px] items-center justify-center rounded-pill bg-badSoft text-bad">
        <ExclamationTriangleIcon className="h-9 w-9" />
      </span>
      <h1 className="font-display text-section font-medium text-textPrimary">Algo salió mal</h1>
      <p className="text-[15px] text-textSecondary">No pudimos mostrar esta pantalla. Revisá tu conexión y volvé a intentar.</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => reset()} className={`min-h-11 ${buttonClass({ variant: "primary" })}`}>
          Reintentar
        </button>
        <PrivateLink href={homeHref} className={`min-h-11 ${buttonClass({ variant: "secondary" })}`}>
          {homeLabel}
        </PrivateLink>
      </div>
    </>
  );
  const className = "mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center";
  return inShell ? <div className={className}>{content}</div> : <main id="contenido" tabIndex={-1} className={`${className} focus:outline-none`}>{content}</main>;
}
