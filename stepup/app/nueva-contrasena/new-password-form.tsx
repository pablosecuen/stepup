"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { updatePasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, passwordsMatch, canSubmitNewPassword } from "@/lib/auth/validation";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Field, TextInput, fieldErrorId } from "@/components/ui/field";

const INITIAL_STATE: AuthFormState = {};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block busy={pending} disabled={!canSubmit}>
      Guardar contraseña
    </Button>
  );
}

export function NewPasswordForm() {
  const [state, formAction] = useGuardedActionState(updatePasswordAction, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const showMismatchError = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword);

  return (
    <form action={formAction} className="flex flex-col gap-[18px]" aria-label="Formulario para elegir una contraseña nueva">
      <Field label={`Contraseña nueva (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`} htmlFor="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field label="Repetir contraseña nueva" htmlFor="confirmPassword" error={showMismatchError ? "Las contraseñas no coinciden." : undefined}>
        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={showMismatchError}
          aria-describedby={showMismatchError ? fieldErrorId("confirmPassword") : undefined}
        />
      </Field>

      {state.error && <FormErrorBox message={state.error} />}

      <SubmitButton canSubmit={canSubmitNewPassword(password, confirmPassword)} />
    </form>
  );
}
