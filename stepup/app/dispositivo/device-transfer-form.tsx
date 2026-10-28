"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { claimDeviceAction, type ClaimDeviceState } from "@/lib/actions/device-session";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { requestSignOut } from "@/lib/nav/request-sign-out";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatInstantDateTime } from "@/lib/format/date-format";

export type DeviceTransferMode = "claim" | "confirm-transfer" | "taken-elsewhere";

const INITIAL: ClaimDeviceState = {};

/**
 * Autoriza este navegador automáticamente sólo si hay un lugar libre.
 * Reemplazar una sesión siempre exige una elección explícita.
 */
export function DeviceTransferForm({ mode, next, devices = [] }: { mode: DeviceTransferMode; next: string; devices?: { id: string; generation: number; label: string; lastSeen: string }[] }) {
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
        <Notice tone="info">Se cerrará únicamente el dispositivo que elijas. La otra sesión seguirá abierta. Los datos ya guardados se conservan.</Notice>
      )}
      {mode === "taken-elsewhere" && <Notice tone="info">Tus datos guardados no se modificaron. Podés volver a autorizar este dispositivo.</Notice>}
      {(state.error || signOutError) && <Notice tone="bad">{state.error ?? signOutError}</Notice>}
      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        {mode !== "claim" && devices.length >= 2 && <fieldset className="flex min-w-0 flex-col gap-3"><legend className="mb-2 font-semibold">¿Qué dispositivo querés reemplazar?</legend>{devices.map(device=><label key={device.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-3"><input type="radio" name="replacement" value={`${device.id}|${device.generation}`} required className="h-5 w-5 shrink-0" /><span className="min-w-0 break-words">{device.label}<span className="block text-sm text-textSecondary">Última actividad: {formatInstantDateTime(device.lastSeen)}</span></span></label>)}</fieldset>}
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
        <a href={`/dispositivo?next=${encodeURIComponent(next)}`} className="min-h-11 text-center underline">Actualizar dispositivos</a>
      )}
      {mode === "claim" && state.error && (
        <Button variant="secondary" size="lg" block onClick={() => formRef.current?.requestSubmit()} disabled={pending}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
