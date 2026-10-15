"use client";

import { useState, useTransition } from "react";
import { ArrowRightOnRectangleIcon } from "@heroicons/react/24/outline";
import { guardNetwork } from "@/lib/actions/network-guard";
import { requestSignOut } from "@/lib/nav/request-sign-out";

/**
 * «Cerrar sesión»: el único control de sesión del shell, siempre en la esquina superior derecha del área principal (una fila propia
 * en escritorio y el encabezado en móvil). Es un botón (nunca un enlace) y reusa la acción de servidor EXISTENTE (`signOutAction`
 * vía `requestSignOut`) a través de `guardNetwork`: una falla de red se muestra como un mensaje junto al botón en vez de romper la
 * pantalla. No pide confirmación (como antes: cerrar sesión no destruye nada) y no contiene Configuración ni ningún otro destino.
 * 44 px de alto como mínimo y anillo de foco visible.
 */
export function SignOutButton({ iconOnlyBelowSm = false }: { iconOnlyBelowSm?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function signOut() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => requestSignOut());
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        aria-disabled={pending}
        data-sign-out
        className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md border-[1.5px] border-borderMid bg-surface px-3.5 text-[14.5px] font-[650] text-textSecondary transition-colors duration-150 hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none"
      >
        <ArrowRightOnRectangleIcon className={`h-5 w-5 shrink-0 ${iconOnlyBelowSm ? "max-[380px]:hidden" : ""}`} aria-hidden />
        {pending ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {error && (
        <p role="alert" className="absolute right-0 top-full z-40 mt-1.5 w-max max-w-[min(320px,calc(100vw-2rem))] rounded-md border-[1.5px] border-badLine bg-surface px-3 py-2 text-[13.5px] font-semibold text-bad shadow-panel">
          {error}
        </p>
      )}
    </div>
  );
}
