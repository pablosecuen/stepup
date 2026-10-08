import PrivateLink from "@/components/nav/private-link";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { buttonClass } from "@/components/ui/button";
import type { ComponentType, SVGProps } from "react";

// Estados de carga / error / vacío compartidos por las pantallas privadas.

export function LoadingState({ label = "Cargando..." }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-textSecondary">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-borderMid border-t-accent motion-reduce:animate-none"
      />
      {label}
    </div>
  );
}

export function ErrorState({ message = "No pudimos cargar esta información." }: { message?: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border-[1.5px] border-badLine bg-badSoft px-4 py-3.5 text-[14.5px] text-bad">
      <ExclamationCircleIcon className="mt-px h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0">{message}</p>
    </div>
  );
}

export interface EmptyStateAction {
  label: string;
  /** Ruta INTERNA existente (se valida contra el árbol de rutas en las pruebas). */
  href: string;
}

/** Estado vacío: el mensaje y, opcionalmente, UNA acción clara para salir del vacío (nunca texto sin salida cuando hay un paso lógico). */
export function EmptyState({ message, action, icon: Icon }: { message: string; action?: EmptyStateAction; icon?: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-borderMid px-4 py-9 text-center text-[14.5px] text-textSecondary">
      {Icon && (
        <span aria-hidden className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-pill bg-accentSoft text-accentText">
          <Icon className="h-8 w-8" />
        </span>
      )}
      <p className="mx-auto max-w-sm">{message}</p>
      {action && (
        <PrivateLink
          href={action.href}
          className={`mt-4 ${buttonClass({ variant: "primary" })}`}
        >
          {action.label}
        </PrivateLink>
      )}
    </div>
  );
}
