"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Botón de `/auth/confirm`. El token es de un solo uso y la verificación tarda un instante: sin una señal visible,
 * un segundo toque lanzaba otra verificación con el mismo token ya consumido y la persona terminaba viendo
 * "enlace vencido" justo después de haber confirmado bien. Mientras la acción corre, el botón queda deshabilitado y lo
 * dice. No guarda ni muestra ningún dato del enlace.
 */
export function ConfirmSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" block busy={pending} disabled={pending}>
      {pending ? "Confirmando…" : label}
    </Button>
  );
}
