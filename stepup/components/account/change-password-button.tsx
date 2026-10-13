"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { requestOwnPasswordChangeAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
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
        <Button
          variant="secondary"
          busy={pending}
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
          className="self-start"
        >
          {pending ? "Enviando..." : "Cambiar contraseña"}
        </Button>
      )}
      {error && <FormErrorBox message={error} />}
      <div role="status" aria-live="polite" tabIndex={-1} className={sent ? "rounded-md border-[1.5px] border-okLine bg-okSoft px-3.5 py-3 text-[14.5px] text-textSecondary focus:outline-none" : "sr-only"} ref={statusRef}>
        {sent && "Te enviamos un enlace a tu correo para cambiar tu contraseña."}
      </div>
    </div>
  );
}
