interface PaginationControlsProps {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}

export function PaginationControls({ page, totalPages, buildHref }: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Paginación de alumnos" className="mt-6 flex items-center justify-center gap-3">
      {page > 1 ? (
        <a
          href={buildHref(page - 1)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-textPrimary transition-colors duration-150 ease-premium hover:border-brandBlue/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          ← Anterior
        </a>
      ) : (
        <span aria-disabled="true" className="rounded-md border border-border px-3 py-2 text-sm font-medium text-textMuted opacity-50">
          ← Anterior
        </span>
      )}

      <span className="text-sm text-textSecondary" aria-current="page">
        Página {page} de {totalPages}
      </span>

      {page < totalPages ? (
        <a
          href={buildHref(page + 1)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-textPrimary transition-colors duration-150 ease-premium hover:border-brandBlue/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          Siguiente →
        </a>
      ) : (
        <span aria-disabled="true" className="rounded-md border border-border px-3 py-2 text-sm font-medium text-textMuted opacity-50">
          Siguiente →
        </span>
      )}
    </nav>
  );
}
