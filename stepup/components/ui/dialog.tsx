"use client";

import { useId, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDialogA11y } from "@/lib/ui/use-dialog-a11y";

// Diálogo del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §7): centrado desde 820 px y hoja inferior por debajo.
// Accesible con `useDialogA11y` (Escape, foco atrapado, devolución del foco, página de fondo sin scroll).

export type DialogSize = "sm" | "md" | "lg";

const WIDTHS: Record<DialogSize, string> = {
  sm: "nav:w-[min(440px,calc(100vw-32px))]",
  md: "nav:w-[min(560px,calc(100vw-32px))]",
  lg: "nav:w-[min(680px,calc(100vw-32px))]",
};

/**
 * `footer` recibe las acciones EN EL ORDEN DE ESCRITORIO (secundaria, principal): en la hoja móvil se apilan al revés para que la
 * principal quede arriba, a ancho completo.
 */
export function Dialog({ title, onClose, size = "md", footer, children }: { title: string; onClose: () => void; size?: DialogSize; footer?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  const dialogRef = useDialogA11y(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center nav:items-center">
      <div aria-hidden onClick={onClose} className="absolute inset-0 animate-tf-fade bg-ink/50" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full animate-tf-sheet flex-col overflow-hidden rounded-t-[24px] border-[1.5px] border-b-0 border-borderMid bg-surface shadow-panel focus:outline-none nav:max-h-[calc(100vh-48px)] nav:animate-tf-pop nav:rounded-xl nav:border-b-[1.5px] ${WIDTHS[size]}`}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-[5px] w-11 shrink-0 rounded-pill bg-borderMid nav:hidden" />
        <div className="flex items-start gap-3 px-[18px] pb-1 pt-2 nav:px-6 nav:pt-[22px]">
          <h2 id={titleId} className="flex-1 font-display text-[23px] font-semibold leading-tight tracking-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-md text-textSecondary transition-colors hover:bg-paperDeep hover:text-ink">
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pb-2 pt-2.5 nav:px-6">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2.5 px-[18px] pb-[calc(1.125rem+env(safe-area-inset-bottom))] pt-3 nav:flex-row nav:flex-wrap nav:justify-end nav:px-6 nav:pb-[22px]">{footer}</div>}
      </div>
    </div>
  );
}
