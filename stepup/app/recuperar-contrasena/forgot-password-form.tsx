"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { requestPasswordResetAction, type AuthFormState } from "@/lib/auth/actions";
import { FormErrorBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: AuthFormState & { sent?: boolean; email?: string } = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-2 flex items-center justify-center gap-2 rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && (
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      Enviar enlace
    </button>
  );
}

// Réplica de ForgotPasswordScreen.tsx en móvil: dos estados (formulario /
// enviado). El texto del estado "enviado" es deliberadamente ambiguo sobre
// si la cuenta existe (anti-enumeración) — se copia tal cual.
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, INITIAL_STATE);

  if (state.sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-textSecondary">
          Si <strong className="text-textPrimary">{state.email}</strong> tiene una cuenta, te enviamos un enlace
          para elegir una contraseña nueva.
        </p>
        <Link href="/login" className="text-sm font-semibold text-brandBlue hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label="Formulario para recuperar la contraseña">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-textSecondary">
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      {state.error && <FormErrorBox message={state.error} />}

      <SubmitButton />

      <Link href="/login" className="text-center text-sm font-medium text-brandBlue hover:underline">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}
