"use client";

import { useState, useTransition } from "react";
import { requestOwnPasswordChangeAction } from "@/lib/actions/account";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";

export function ChangePasswordButton() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return <FormInfoBox>Te enviamos un enlace a tu correo para cambiar tu contraseña.</FormInfoBox>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await requestOwnPasswordChangeAction();
            if (result.error) {
              setError(result.error);
              return;
            }
            setSent(true);
          })
        }
        className="self-start rounded-md border border-border px-3.5 py-2 text-sm font-semibold text-textSecondary transition-all duration-150 ease-premium hover:bg-background active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Cambiar contraseña"}
      </button>
      {error && <FormErrorBox message={error} />}
    </div>
  );
}
