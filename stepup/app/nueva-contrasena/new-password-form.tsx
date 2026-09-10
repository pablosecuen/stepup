"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updatePasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, passwordsMatch, canSubmitNewPassword } from "@/lib/auth/validation";
import { FormErrorBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: AuthFormState = {};

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
      Guardar contraseña
    </button>
  );
}

export function NewPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const showMismatchError = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword);

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label="Formulario para elegir una contraseña nueva">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-textSecondary">
          Contraseña nueva (mínimo {MIN_PASSWORD_LENGTH} caracteres)
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
          Repetir contraseña nueva
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

      <SubmitButton canSubmit={canSubmitNewPassword(password, confirmPassword)} />
    </form>
  );
}
