"use client";

import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { verifyEmailCodeAction, type EmailCodeFormState } from "@/lib/auth/actions";
import { FormErrorBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: EmailCodeFormState = {};

/**
 * Código de 6 dígitos del correo — alternativa al enlace para recuperación y
 * para alta. Ningún escáner del correo puede "abrirlo" de antemano, y como no
 * usa PKCE sirve desde cualquier dispositivo. El correo viaja en un campo
 * oculto; nunca se muestra el código ni se guarda en ningún lado.
 */
export function EmailCodeForm({ flow, email }: { flow: "recovery" | "signup"; email: string }) {
  const [state, formAction] = useGuardedActionState(verifyEmailCodeAction, INITIAL_STATE);
  const help =
    flow === "recovery"
      ? "¿El enlace no funciona, venció o lo abriste en otro dispositivo? Ingresá el código de 6 dígitos del mismo correo."
      : "¿El enlace no funciona o lo abriste en otro dispositivo? Ingresá el código de 6 dígitos del mismo correo para activar tu cuenta.";

  return (
    <form action={formAction} className="flex w-full flex-col gap-3 text-left" aria-label="Ingresar el código de 6 dígitos">
      <p className="text-center text-xs text-textMuted">{help}</p>
      <input type="hidden" name="flow" value={flow} />
      <input type="hidden" name="email" value={email} />
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        placeholder="123456"
        aria-label="Código de 6 dígitos"
        className="rounded-md border border-border bg-surface px-3 py-2.5 text-center text-sm tracking-[0.4em] text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
      />
      {state.error && <FormErrorBox message={state.error} />}
      <button
        type="submit"
        className="rounded-md border border-brandBlue px-4 py-2 text-sm font-semibold text-brandBlue transition-colors hover:bg-brandBlue/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
      >
        Usar el código
      </button>
    </form>
  );
}
