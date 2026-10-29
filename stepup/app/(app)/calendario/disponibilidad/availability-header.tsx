import PrivateLink from "@/components/nav/private-link";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { PageTitle } from "@/components/ui/page-header";

/**
 * Encabezado de Disponibilidad: título y texto de apoyo a la izquierda y, en la esquina superior derecha, la X que cierra la
 * pantalla. Es un enlace a `/calendario` (nunca `history.back()`: el destino es siempre el Calendario) y se activa con Enter
 * como cualquier enlace. 44 × 44 px, anillo de foco visible y nombre accesible «Cerrar Disponibilidad». No encoge, así que en
 * móvil queda visible y el título (que puede partir palabras largas) nunca se superpone con ella.
 */
export function AvailabilityHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div data-tf-header="" className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <PageTitle>Disponibilidad</PageTitle>
        {subtitle && <p className="mt-1.5 max-w-[68ch] text-[15px] text-textMuted">{subtitle}</p>}
      </div>
      <PrivateLink
        href="/calendario"
        aria-label="Cerrar Disponibilidad"
        className="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md border-[1.5px] border-borderMid bg-surface text-ink transition-colors duration-150 hover:border-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <XMarkIcon className="h-5 w-5" aria-hidden />
      </PrivateLink>
    </div>
  );
}
