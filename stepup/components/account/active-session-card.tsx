"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endActiveSessionAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, BUTTON_SECONDARY } from "@/components/account/settings-ui";

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
  if (!session) return <p className="text-sm text-textMuted">{NO_SESSION_MESSAGE}</p>;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-textMuted">Autorizado el</dt>
      <dd className="text-textPrimary">{session.authorizedAtLabel}</dd>
      <dt className="text-textMuted">Última actividad</dt>
      <dd className="text-textPrimary">{session.lastSeenAtLabel}</dd>
      <dt className="text-textMuted">Vence el</dt>
      <dd className="text-textPrimary">{session.expiresAtLabel}</dd>
    </dl>
  );
}

/**
 * "Cerrar sesión remota" sirve para el caso real "perdí el dispositivo" — nunca se llama sola al cargar la página (la web
 * nunca se autoclaims como dispositivo autorizado). Pide confirmación en un panel propio: el foco entra al panel al abrirlo
 * y vuelve al botón al cancelar (botón o Escape); al terminar, el resultado se anuncia en una región viva que sigue montada.
 */
export function EndActiveSessionControl({ session }: { session: ActiveSessionInfo | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const focusStatusWhenEnded = useRef(false);

  useEffect(() => {
    if (confirming) panelRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  // Cuando el servidor confirma que ya no hay sesión, el botón desaparece: el foco pasa al aviso para no quedar perdido.
  useEffect(() => {
    if (!session && focusStatusWhenEnded.current) {
      focusStatusWhenEnded.current = false;
      statusRef.current?.focus();
    }
  }, [session]);

  function cancel() {
    restoreFocus.current = true;
    setConfirming(false);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div ref={statusRef} role="status" aria-live="polite" tabIndex={-1} className="text-sm text-textMuted focus:outline-none">
        {!session && "No hay ningún dispositivo autorizado para cerrar."}
      </div>

      {session && !confirming && (
        <button ref={triggerRef} type="button" onClick={() => setConfirming(true)} className={`self-start ${BUTTON_DANGER_OUTLINE}`}>
          Cerrar esa sesión remotamente
        </button>
      )}

      {session && confirming && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label="Confirmar el cierre de la sesión remota"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
          }}
          className="rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3 focus:outline-none"
        >
          <p className="text-sm text-textSecondary">
            Esto cierra la sesión del dispositivo autorizado de inmediato. Usalo si perdiste ese dispositivo o ya no lo
            controlás.
          </p>
          {error && (
            <div className="mt-2">
              <FormErrorBox message={error} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
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
              className={BUTTON_DANGER}
            >
              {pending ? "Cerrando..." : "Confirmar cierre"}
            </button>
            <button type="button" onClick={cancel} className={BUTTON_SECONDARY}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
