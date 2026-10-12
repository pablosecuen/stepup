"use client";

import { ArrowDownIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

/**
 * Botón "Ir a la última serie" — el listado de Series puede crecer mucho
 * (muchas series activas/pausadas) y queda dentro de un contenedor con
 * scroll propio (`overflow-y-auto`), así que el scroll del documento no
 * alcanza para llegar al final. `scrollIntoView({ behavior: 'smooth' })`
 * sobre el último `<li>` (por `id`) es suficiente y no depende de medir
 * nada a mano.
 */
export function ScrollToLastSeries({ lastRuleId }: { lastRuleId: string }) {
  function scrollToLast() {
    document.getElementById(`series-${lastRuleId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <Button variant="secondary" onClick={scrollToLast}>
      Ir a la última serie
      <ArrowDownIcon className="h-4 w-4" aria-hidden />
    </Button>
  );
}
