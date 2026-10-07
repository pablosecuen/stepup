"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { requestOwnPasswordChangeAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { BUTTON_SECONDARY } from "@/components/account/settings-ui";
import { CaptchaWidget } from "@/components/auth/captcha-widget";

export function ChangePasswordButton() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  // CAPTCHA (R3, desactivado salvo que haya clave de sitio): el token es de un solo uso, así que se renueva el widget tras cada pedido.
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const statusRef = useRef<HTMLDivElement>(null);

  // El botón se reemplaza por la confirmación: el foco pasa al aviso en vez de perderse.
  useEffect(() => {
    if (sent) statusRef.current?.focus();
  }, [sent]);

  return (
    <div className="flex flex-col gap-2">
      {!sent && <CaptchaWidget key={captchaAttempt} onToken={setCaptchaToken} />}
      {!sent && (
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await guardNetwork(() => requestOwnPasswordChangeAction(captchaToken));
              setCaptchaToken(undefined);
              setCaptchaAttempt((n) => n + 1);
              if (result.error) {
                setError(result.error);
                return;
              }
              setSent(true);
            })
          }
          className={`self-start ${BUTTON_SECONDARY}`}
        >
          {pending ? "Enviando..." : "Cambiar contraseña"}
        </button>
      )}
      {error && <FormErrorBox message={error} />}
      <div role="status" aria-live="polite" tabIndex={-1} className={sent ? "rounded-md border border-border bg-background px-3 py-2.5 text-sm text-textSecondary focus:outline-none" : "sr-only"} ref={statusRef}>
        {sent && "Te enviamos un enlace a tu correo para cambiar tu contraseña."}
      </div>
    </div>
  );
}
