"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endActiveSessionAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export interface ActiveSessionInfo {
  deviceId: string;
  generation: number;
  authorizedAtLabel: string;
  lastSeenAtLabel: string;
  expiresAtLabel: string;
}

const NO_SESSION_MESSAGE = "No hay ningún dispositivo autorizado activo en este momento.";

/**
 * Muestra la ÚNICA sesión real autorizada (modelo confirmado por auditoría:
 * `active_sessions` guarda una sola fila por profesora, nunca una lista de
 * dispositivos). Sólo informa: la acción de cerrarla vive aparte, en
 * `EndActiveSessionControl`, dentro de las acciones sensibles.
 */
export function ActiveSessionDetails({ session }: { session: ActiveSessionInfo | null }) {
  if (!session) return <p className="text-[14.5px] text-textMuted">{NO_SESSION_MESSAGE}</p>;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[14.5px]">
      <dt className="text-textMuted">Autorizado el</dt>
      <dd className="tf-num text-textPrimary">{session.authorizedAtLabel}</dd>
      <dt className="text-textMuted">Última actividad</dt>
      <dd className="tf-num text-textPrimary">{session.lastSeenAtLabel}</dd>
      <dt className="text-textMuted">Vence el</dt>
      <dd className="tf-num text-textPrimary">{session.expiresAtLabel}</dd>
    </dl>
  );
}

/**
 * "Cerrar sesión remota" sirve para el caso real "perdí el dispositivo" — nunca se llama sola al cargar la página (la web
 * nunca se autoclaims como dispositivo autorizado). Pide confirmación en un diálogo (hoja inferior en móvil): el foco queda
 * atrapado adentro, Escape o «Cancelar» lo cierran y el foco vuelve al botón; al terminar, el resultado se anuncia en una región
 * viva que sigue montada.
 */
export function EndActiveSessionControl({ session }: { session: ActiveSessionInfo | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statusRef = useRef<HTMLDivElement>(null);
  const focusStatusWhenEnded = useRef(false);

  // Cuando el servidor confirma que ya no hay sesión, el botón desaparece: el foco pasa al aviso para no quedar perdido.
  useEffect(() => {
    if (!session && focusStatusWhenEnded.current) {
      focusStatusWhenEnded.current = false;
      statusRef.current?.focus();
    }
  }, [session]);

  function cancel() {
    setConfirming(false);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div ref={statusRef} role="status" aria-live="polite" tabIndex={-1} className="text-[14.5px] text-textMuted focus:outline-none">
        {!session && "No hay ningún dispositivo autorizado para cerrar."}
      </div>

      {session && (
        <Button variant="dangerOutline" onClick={() => setConfirming(true)} className="self-start" aria-haspopup="dialog">
          Cerrar esa sesión remotamente
        </Button>
      )}

      {session && confirming && (
        <Dialog
          title="Cerrar la sesión remota"
          size="sm"
          onClose={cancel}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" onClick={cancel}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                busy={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await guardNetwork(() => endActiveSessionAction(session.deviceId, session.generation));
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    focusStatusWhenEnded.current = true;
                    setConfirming(false);
                    router.refresh();
                  })
                }
              >
                {pending ? "Cerrando..." : "Confirmar cierre"}
              </Button>
            </>
          }
        >
          <p className="text-[15px] text-textSecondary">
            Esto cierra la sesión del dispositivo autorizado de inmediato. Usalo si perdiste ese dispositivo o ya no lo
            controlás.
          </p>
          {error && <FormErrorBox message={error} />}
        </Dialog>
      )}
    </div>
  );
}
