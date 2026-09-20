"use client";

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
    <button
      type="button"
      onClick={scrollToLast}
      className="rounded-pill border border-border px-3 py-1 text-xs font-semibold text-brandBlue transition-colors hover:border-brandBlue/30"
    >
      Ir a la última serie ↓
    </button>
  );
}
