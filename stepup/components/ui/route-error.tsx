"use client";

import { useEffect } from "react";
import PrivateLink from "@/components/nav/private-link";

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
      <h1 className="text-xl font-semibold text-textPrimary">Algo salió mal</h1>
      <p className="text-sm text-textSecondary">No pudimos mostrar esta pantalla. Revisá tu conexión y volvé a intentar.</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-11 rounded-md bg-brandBlue px-5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Reintentar
        </button>
        <PrivateLink
          href={homeHref}
          className="inline-flex min-h-11 items-center rounded-md border border-border px-5 text-sm font-semibold text-textSecondary transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          {homeLabel}
        </PrivateLink>
      </div>
    </>
  );
  const className = "mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center";
  return inShell ? <div className={className}>{content}</div> : <main id="contenido" tabIndex={-1} className={`${className} focus:outline-none`}>{content}</main>;
}
