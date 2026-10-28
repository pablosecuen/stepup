"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { claimDeviceAction, type ClaimDeviceState } from "@/lib/actions/device-session";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { requestSignOut } from "@/lib/nav/request-sign-out";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type DeviceTransferMode = "claim" | "confirm-transfer" | "taken-elsewhere";

const INITIAL: ClaimDeviceState = {};

/**
 * Autorizar este navegador. En `claim` se hace solo al abrir la pantalla (nadie más tiene la cuenta, no hay nada que confirmar); en los otros dos casos hace falta pulsar «Usar TeacherFlow
 * en este dispositivo», que cierra de inmediato la sesión del otro. «Cancelar» / «Cerrar sesión» sale sin tocar al otro dispositivo.
 */
export function DeviceTransferForm({ mode, next }: { mode: DeviceTransferMode; next: string }) {
  const [state, formAction, pending] = useGuardedActionState(claimDeviceAction.bind(null, next), INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const autoStarted = useRef(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, startSignOut] = useTransition();

  useEffect(() => {
    if (mode !== "claim" || autoStarted.current) return;
    autoStarted.current = true;
    formRef.current?.requestSubmit();
  }, [mode]);

  function cancel() {
    setSignOutError(null);
    startSignOut(async () => {
      const result = await guardNetwork(() => requestSignOut());
      if (result.error) setSignOutError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === "confirm-transfer" && (
        <Notice tone="info">Si continuás, la sesión en el otro dispositivo se cierra de inmediato. No se pierde ningún dato guardado: ese dispositivo sólo vuelve a funcionar cuando alguien inicie sesión de nuevo.</Notice>
      )}
      {mode === "taken-elsewhere" && <Notice tone="info">Tus datos no se modificaron. Si querés volver a usar TeacherFlow acá, autorizá este dispositivo: el otro quedará cerrado.</Notice>}
      {(state.error || signOutError) && <Notice tone="bad">{state.error ?? signOutError}</Notice>}
      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        {mode === "claim" ? (
          <p role="status" className="text-[15px] text-textSecondary">
            {pending ? "Autorizando este dispositivo…" : "Un momento…"}
          </p>
        ) : (
          <Button type="submit" variant="primary" size="lg" block busy={pending} disabled={signingOut}>
            {pending ? "Autorizando…" : "Usar TeacherFlow en este dispositivo"}
          </Button>
        )}
      </form>
      {mode !== "claim" && (
        <Button variant="secondary" size="lg" block onClick={cancel} busy={signingOut} disabled={pending}>
          {mode === "confirm-transfer" ? "Cancelar" : "Cerrar sesión"}
        </Button>
      )}
      {mode === "claim" && state.error && (
        <Button variant="secondary" size="lg" block onClick={() => formRef.current?.requestSubmit()} disabled={pending}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
