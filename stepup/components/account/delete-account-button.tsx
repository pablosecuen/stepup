"use client";

import { useState, useTransition } from "react";
import { deleteOwnAccountAction } from "@/lib/actions/account";
import { FormErrorBox } from "@/components/auth/form-boxes";

const CONFIRM_WORD = "ELIMINAR";

/**
 * Puerto de `confirmDeleteAccount()` (móvil, `AccountConnectedScreen.tsx`):
 * ahí un `Alert.alert` nativo basta como confirmación fuerte; la web no
 * tiene ese diálogo nativo, así que exige escribir la palabra "ELIMINAR"
 * para habilitar el botón — confirmación al menos igual de difícil de
 * disparar por accidente. Texto adaptado a la realidad de la web (a
 * diferencia del móvil, acá NO hay una copia local que sobreviva: todos los
 * datos viven en el servidor y se borran con la cuenta).
 */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-statusRojo px-3.5 py-2 text-sm font-semibold text-statusRojo transition-all duration-150 ease-premium hover:bg-statusRojo/5 active:scale-[0.98]"
      >
        Eliminar cuenta
      </button>
    );
  }

  const canConfirm = confirmText.trim() === CONFIRM_WORD;

  return (
    <div className="rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3">
      <p className="text-sm text-textSecondary">
        Se va a eliminar tu cuenta y TODOS tus datos (alumnos, clases, pagos, reportes) de forma permanente — esta
        acción no se puede deshacer.
      </p>
      <label htmlFor="delete-confirm" className="mt-2.5 block text-xs font-medium text-textSecondary">
        Escribí <span className="font-bold">{CONFIRM_WORD}</span> para confirmar
      </label>
      <input
        id="delete-confirm"
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoComplete="off"
        className="mt-1 w-full max-w-[16rem] rounded-md border border-statusRojo/40 bg-surface px-2.5 py-1.5 text-sm text-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-statusRojo"
      />
      {error && (
        <div className="mt-2">
          <FormErrorBox message={error} />
        </div>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          disabled={!canConfirm || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await deleteOwnAccountAction();
              if (result?.error) setError(result.error);
            })
          }
          className="rounded-md bg-statusRojo px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Eliminando..." : "Eliminar definitivamente"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setError(null);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
