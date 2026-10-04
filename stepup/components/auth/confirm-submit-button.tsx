"use client";

import { useFormStatus } from "react-dom";

/**
 * Botón de `/auth/confirm`. El token es de un solo uso y la verificación tarda un instante: sin una señal visible,
 * un segundo toque lanzaba otra verificación con el mismo token ya consumido y la persona terminaba viendo
 * "enlace vencido" justo después de haber confirmado bien. Mientras la acción corre, el botón queda deshabilitado y lo
 * dice. No guarda ni muestra ningún dato del enlace.
 */
export function ConfirmSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Confirmando…" : label}
    </button>
  );
}
