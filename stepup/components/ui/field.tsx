import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import type { ComponentProps, ReactNode } from "react";

// Campos del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §3). El borde del control es `borderStrong` (3:1,
// WCAG 1.4.11); el foco cambia el borde a tinta y suma un halo terracota. Alto 46 px (≥ 44 px, B8).

/** Clases comunes de campo, selector y área de texto. */
export const inputClass =
  "w-full min-h-[46px] rounded-md border-[1.5px] border-borderStrong bg-surface px-3.5 text-[15px] text-textPrimary transition-[border-color,box-shadow] duration-150 ease-premium placeholder:text-[#7D7260] hover:border-ink focus:outline-none focus-visible:border-ink focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-borderMid disabled:bg-paperDeep disabled:text-textMuted aria-[invalid=true]:border-bad aria-[invalid=true]:bg-[#FFFBFA] aria-[invalid=true]:shadow-focusError";

export const selectClass = `${inputClass} tf-select-arrow appearance-none pr-10`;

export const textareaClass = `${inputClass} min-h-24 py-3 leading-normal`;

export const fieldHintId = (id: string) => `${id}-hint`;
export const fieldErrorId = (id: string) => `${id}-error`;

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={`${inputClass}${className ? ` ${className}` : ""}`} {...props} />;
}

export function SelectInput({ className, ...props }: ComponentProps<"select">) {
  return <select className={`${selectClass}${className ? ` ${className}` : ""}`} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${textareaClass}${className ? ` ${className}` : ""}`} {...props} />;
}

/**
 * Etiqueta arriba, control, ayuda y error debajo. La etiqueta se asocia por `htmlFor` (nunca sólo el placeholder). La ayuda y
 * el error llevan `id` derivados (`fieldHintId`/`fieldErrorId`) para que el control los enlace con `aria-describedby`; el error
 * es ícono + texto (nunca sólo color) y se anuncia al aparecer.
 */
export function Field({ label, htmlFor, hint, error, children }: { label: ReactNode; htmlFor: string; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-[650] text-textSecondary">
        {label}
      </label>
      {children}
      {hint && (
        <p id={fieldHintId(htmlFor)} className="text-[13px] text-textMuted">
          {hint}
        </p>
      )}
      {error && (
        <p id={fieldErrorId(htmlFor)} role="alert" className="flex items-center gap-1.5 text-[13px] font-semibold text-bad">
          <ExclamationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

/** Casilla o botón de opción (tinta al elegirse): 20 px visibles dentro de una fila de ≥ 44 px. */
export const checkClass = "h-5 w-5 shrink-0 accent-ink";

/** Fila de una casilla/opción con su texto: toda la fila es el objetivo táctil (≥ 44 px). */
export const choiceRowClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-[15px] text-textPrimary transition-colors hover:bg-paperDeep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-inset";

/** Grupo con borde que contiene filas de opciones (lista de alumnos, principal, días). */
export const choiceGroupClass = "flex flex-col rounded-md border-[1.5px] border-border bg-surface p-1";
