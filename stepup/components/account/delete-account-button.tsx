"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteOwnAccountAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, BUTTON_SECONDARY } from "@/components/account/settings-ui";

const CONFIRM_WORD = "ELIMINAR";

/**
 * Puerto de `confirmDeleteAccount()` (móvil, `AccountConnectedScreen.tsx`):
 * ahí un `Alert.alert` nativo basta como confirmación fuerte; la web no
 * tiene ese diálogo nativo, así que exige escribir la palabra "ELIMINAR"
 * para habilitar el botón — confirmación al menos igual de difícil de
 * disparar por accidente. Texto adaptado a la realidad de la web (a
 * diferencia del móvil, acá NO hay una copia local que sobreviva: todos los
 * datos viven en el servidor y se borran con la cuenta).
 *
 * Teclado: al abrir la confirmación el foco entra al campo; al cancelar (botón o Escape) vuelve al botón «Eliminar cuenta».
 */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function cancel() {
    restoreFocus.current = true;
    setOpen(false);
    setConfirmText("");
    setError(null);
  }

  if (!open) {
    return (
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={`self-start ${BUTTON_DANGER_OUTLINE}`}>
        Eliminar cuenta
      </button>
    );
  }

  const canConfirm = confirmText.trim() === CONFIRM_WORD;

  return (
    <div
      role="group"
      aria-labelledby="delete-warning"
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      className="rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3"
    >
      <p id="delete-warning" className="text-sm text-textSecondary">
        Se va a eliminar tu cuenta y TODOS tus datos (alumnos, clases, pagos, reportes) de forma permanente — esta
        acción no se puede deshacer.
      </p>
      <label htmlFor="delete-confirm" className="mt-3 block text-sm font-medium text-textSecondary">
        Escribí <span className="font-bold">{CONFIRM_WORD}</span> para confirmar
      </label>
      <input
        ref={inputRef}
        id="delete-confirm"
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoComplete="off"
        className="mt-1 w-full max-w-[16rem] rounded-md border border-statusRojo bg-surface px-3 text-sm text-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-statusRojo"
      />
      {error && (
        <div className="mt-2">
          <FormErrorBox message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canConfirm || pending}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await guardNetwork(() => deleteOwnAccountAction());
              if (result?.error) setError(result.error);
            })
          }
          className={BUTTON_DANGER}
        >
          {pending ? "Eliminando..." : "Eliminar definitivamente"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className={BUTTON_SECONDARY}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
