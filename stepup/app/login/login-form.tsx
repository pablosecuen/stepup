"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: AuthFormState = {};

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
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      Iniciar sesión
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL_STATE);
  const showCreateAccountHint = state.error === AUTH_ERROR_MESSAGES.invalid_credentials;

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label="Formulario de inicio de sesión">
      <input type="hidden" name="next" value={next} />

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-textSecondary">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      {state.error && <FormErrorBox message={state.error} />}

      {showCreateAccountHint && (
        <FormInfoBox>
          ¿Todavía no tenés cuenta con este correo?{" "}
          <Link href="/crear-cuenta" className="font-semibold text-brandBlue hover:underline">
            Crear cuenta
          </Link>
        </FormInfoBox>
      )}

      <Link href="/recuperar-contrasena" className="text-sm font-medium text-brandBlue hover:underline">
        Olvidé mi contraseña
      </Link>

      <SubmitButton />

      <p className="mt-1 text-center text-sm text-textSecondary">
        ¿No tenés cuenta?{" "}
        <Link href="/crear-cuenta" className="font-semibold text-brandBlue hover:underline">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}
