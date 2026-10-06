import PrivateLink from "@/components/nav/private-link";

// Estados de carga / error / vacío compartidos por las pantallas privadas.

export function LoadingState({ label = "Cargando..." }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-textSecondary">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brandBlue motion-reduce:animate-none"
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

export interface EmptyStateAction {
  label: string;
  /** Ruta INTERNA existente (se valida contra el árbol de rutas en las pruebas). */
  href: string;
}

/** Estado vacío: el mensaje y, opcionalmente, UNA acción clara para salir del vacío (nunca texto sin salida cuando hay un paso lógico). */
export function EmptyState({ message, action }: { message: string; action?: EmptyStateAction }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-textMuted">
      <p>{message}</p>
      {action && (
        <PrivateLink
          href={action.href}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-brandBlue px-5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          {action.label}
        </PrivateLink>
      )}
    </div>
  );
}
