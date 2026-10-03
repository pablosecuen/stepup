"use client";

import { useEffect } from "react";

// Última defensa de App Router: sólo captura errores lanzados durante el
// render (o rechazos propagados por React 19 desde una Server Action).
// No conserva el estado de ningún formulario — por eso los formularios
// resuelven los errores de red ANTES de llegar acá (ver
// `lib/actions/network-guard.ts`).
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sólo un identificador genérico — nunca el mensaje ni datos del usuario.
    console.error("[route-error]", error.digest ?? "sin-digest");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-textPrimary">Algo salió mal</h1>
      <p className="text-sm text-textSecondary">No pudimos completar esta acción. Revisá tu conexión y volvé a intentar.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-brandBlue px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
      >
        Reintentar
      </button>
    </main>
  );
}
