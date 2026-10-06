/**
 * Esqueleto de carga de una pantalla privada (lo usan los `loading.tsx` de cada sección). Se muestra DENTRO del shell
 * (la navegación queda en pantalla) mientras el servidor prepara la página. Accesible: `role="status"` + `aria-busy` con
 * un texto sólo para lectores de pantalla; el brillo animado se apaga con "reducir movimiento".
 */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="motion-safe:animate-pulse">
        <div className="h-8 w-48 rounded-md bg-border/70" />
        <div className="mt-3 h-4 w-72 max-w-full rounded-md bg-border/50" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <div className="h-4 w-40 rounded bg-border/70" />
              <div className="mt-3 h-3 w-full rounded bg-border/50" />
              <div className="mt-2 h-3 w-2/3 rounded bg-border/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
