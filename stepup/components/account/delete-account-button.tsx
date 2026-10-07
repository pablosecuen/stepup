"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteOwnAccountAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { CaptchaWidget } from "@/components/auth/captcha-widget";
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
 * R4: además de la palabra, pide la CONTRASEÑA (reautenticación): una sesión abierta u olvidada no alcanza para una acción
 * irreversible. La contraseña y la palabra se vuelven a validar en el servidor; nunca se guardan ni se muestran de nuevo.
 *
 * Teclado: al abrir la confirmación el foco entra al primer campo; al cancelar (botón o Escape) vuelve al botón «Eliminar cuenta».
 */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // CAPTCHA (R3, desactivado salvo que haya clave de sitio): la verificación de contraseña pasa por Supabase Auth, que lo pide si está activo.
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
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
    setPassword("");
    setError(null);
  }

  if (!open) {
    return (
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={`self-start ${BUTTON_DANGER_OUTLINE}`}>
        Eliminar cuenta
      </button>
    );
  }

  const canConfirm = confirmText.trim() === CONFIRM_WORD && password.length > 0;
  const fieldClass =
    "mt-1 w-full max-w-[16rem] rounded-md border border-statusRojo bg-surface px-3 text-sm text-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-statusRojo";

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
        Se va a eliminar tu cuenta y TODOS tus datos (alumnos, clases, pagos, reportes y sus archivos PDF) de forma permanente — esta
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
        className={fieldClass}
      />
      <label htmlFor="delete-password" className="mt-3 block text-sm font-medium text-textSecondary">
        Tu contraseña
      </label>
      <input
        id="delete-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        className={fieldClass}
      />
      <div className="mt-3">
        <CaptchaWidget key={captchaAttempt} onToken={setCaptchaToken} />
      </div>
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
              const result = await guardNetwork(() => deleteOwnAccountAction({ password, confirmation: confirmText, captchaToken }));
              // El token del CAPTCHA es de un solo uso, y la contraseña no queda en pantalla tras un intento fallido.
              setCaptchaToken(undefined);
              setCaptchaAttempt((n) => n + 1);
              if (result?.error) {
                setPassword("");
                setError(result.error);
              }
            })
          }
          className={BUTTON_DANGER}
        >
          {pending ? "Eliminando..." : "Eliminar definitivamente"}
        </button>
        <button type="button" onClick={cancel} className={BUTTON_SECONDARY}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
