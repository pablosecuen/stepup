"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endActiveSessionAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";

export interface ActiveSessionInfo {
  deviceId: string;
  generation: number;
  authorizedAtLabel: string;
  lastSeenAtLabel: string;
  expiresAtLabel: string;
}

/**
 * Muestra la ÚNICA sesión real autorizada (modelo confirmado por auditoría:
 * `active_sessions` guarda una sola fila por profesora, nunca una lista de
 * dispositivos). "Cerrar sesión remota" sirve para el caso real "perdí el
 * dispositivo" — nunca se llama sola al cargar la página (la web nunca se
 * autoclaims como dispositivo autorizado).
 */
export function ActiveSessionCard({ session }: { session: ActiveSessionInfo | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!session) {
    return <p className="mt-3 text-xs text-textMuted">No hay ningún dispositivo autorizado activo en este momento.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-textMuted">Autorizado</dt>
        <dd className="text-textSecondary">{session.authorizedAtLabel}</dd>
        <dt className="text-textMuted">Última actividad</dt>
        <dd className="text-textSecondary">{session.lastSeenAtLabel}</dd>
        <dt className="text-textMuted">Vence</dt>
        <dd className="text-textSecondary">{session.expiresAtLabel}</dd>
      </dl>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-xs font-semibold text-statusRojo hover:underline"
        >
          Cerrar esa sesión remotamente
        </button>
      ) : (
        <div className="rounded-md border border-statusRojo/30 bg-statusRojo/5 p-2.5">
          <p className="text-xs text-textSecondary">
            Esto cierra la sesión del dispositivo autorizado de inmediato. Usalo si perdiste ese dispositivo o ya no lo
            controlás.
          </p>
          {error && (
            <div className="mt-2">
              <FormErrorBox message={error} />
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await guardNetwork(() => endActiveSessionAction(session.deviceId, session.generation));
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setConfirming(false);
                  router.refresh();
                })
              }
              className="rounded-md bg-statusRojo px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Cerrando..." : "Confirmar cierre"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-textSecondary"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
