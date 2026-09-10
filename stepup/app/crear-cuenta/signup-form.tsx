"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signUpAction, type SignUpFormState } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import { MIN_PASSWORD_LENGTH, passwordsMatch, canSubmitSignUp } from "@/lib/auth/validation";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { ResendConfirmationForm } from "./resend-confirmation-form";

const INITIAL_STATE: SignUpFormState = {};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !canSubmit}
      aria-busy={pending}
      className="mt-2 flex items-center justify-center gap-2 rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && (
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      Crear cuenta
    </button>
  );
}

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, INITIAL_STATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (state.needsEmailConfirmation) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-textSecondary">
          Enviamos un enlace de confirmación a: <strong className="text-textPrimary">{email}</strong>
        </p>
        <FormInfoBox>Tocá el enlace del correo para activar tu cuenta.</FormInfoBox>
        <ResendConfirmationForm email={email} />
        <Link href="/login" className="text-sm font-semibold text-brandBlue hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  const showMismatchError = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword);
  const showLoginHint = state.error === AUTH_ERROR_MESSAGES.user_already_exists;

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label="Formulario de creación de cuenta">
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-textSecondary">
          Contraseña (mínimo {MIN_PASSWORD_LENGTH} caracteres)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-textSecondary">
          Repetir contraseña
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={showMismatchError}
          className={`rounded-md border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue ${
            showMismatchError ? "border-statusRojo focus-visible:border-statusRojo" : "border-border focus-visible:border-brandBlue"
          }`}
        />
        {showMismatchError && <p className="text-xs text-statusRojo">Las contraseñas no coinciden.</p>}
      </div>

      {state.error && <FormErrorBox message={state.error} />}

      {showLoginHint && (
        <FormInfoBox>
          ¿Ya tenías cuenta con este correo?{" "}
          <Link href="/login" className="font-semibold text-brandBlue hover:underline">
            Iniciar sesión
          </Link>
        </FormInfoBox>
      )}

      <SubmitButton canSubmit={canSubmitSignUp(email, password, confirmPassword)} />

      <p className="mt-1 text-center text-sm text-textSecondary">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="font-semibold text-brandBlue hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}
