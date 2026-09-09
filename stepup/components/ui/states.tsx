// Estados simulados de carga/error/vacío — sin datos reales todavía, sólo
// para dejar el patrón visual listo para cuando haya una fuente de datos
// real (fase posterior).

export function LoadingState({ label = "Cargando..." }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-textSecondary">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brandBlue"
      />
      {label}
    </div>
  );
}

export function ErrorState({ message = "No pudimos cargar esta información." }: { message?: string }) {
  return (
    <div role="alert" className="rounded-md border border-statusRojo/30 bg-statusRojo/5 px-4 py-3 text-sm text-statusRojo">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-textMuted">
      {message}
    </div>
  );
}
