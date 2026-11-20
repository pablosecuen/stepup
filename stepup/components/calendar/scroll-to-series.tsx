"use client";

import { useEffect } from "react";

/**
 * Lleva a la vista la tarjeta de la serie que acaba de volver a «Vigentes» (una vez, al abrir la pantalla) y limpia el aviso de la dirección para que recargar no lo repita.
 * Sólo mueve el desplazamiento de la página; no cambia ningún dato.
 */
export function ScrollToSeries({ ruleId }: { ruleId: string }) {
  useEffect(() => {
    document.getElementById(`series-${ruleId}`)?.scrollIntoView({ block: "center", behavior: "instant" });
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("reactivada")) {
        url.searchParams.delete("reactivada");
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
      }
    } catch {
      // Sin limpiar la dirección todo sigue funcionando.
    }
  }, [ruleId]);
  return null;
}
