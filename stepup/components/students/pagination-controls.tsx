import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { buttonClass } from "@/components/ui/button";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}

// Enlaces comunes (sin precarga de Next): cada página es una recarga completa del servidor con los filtros en la URL.
export function PaginationControls({ page, totalPages, buildHref }: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Paginación de alumnos" className="mt-6 flex flex-wrap items-center justify-center gap-3">
      {page > 1 ? (
        <a href={buildHref(page - 1)} className={buttonClass({ variant: "secondary" })}>
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Anterior
        </a>
      ) : (
        <span aria-disabled="true" className={buttonClass({ variant: "secondary" })}>
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Anterior
        </span>
      )}

      <span className="text-sm text-textSecondary" aria-current="page">
        Página {page} de {totalPages}
      </span>

      {page < totalPages ? (
        <a href={buildHref(page + 1)} className={buttonClass({ variant: "secondary" })}>
          Siguiente
          <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </a>
      ) : (
        <span aria-disabled="true" className={buttonClass({ variant: "secondary" })}>
          Siguiente
          <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}
