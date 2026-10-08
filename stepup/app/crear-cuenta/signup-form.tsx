"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { signUpAction, type SignUpFormState } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import { MIN_PASSWORD_LENGTH, passwordsMatch, canSubmitSignUp } from "@/lib/auth/validation";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { CaptchaWidget } from "@/components/auth/captcha-widget";
import { StatusCircle } from "@/components/ui/status-circle";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/auth/public-links";
import { Field, TextInput, fieldErrorId } from "@/components/ui/field";
import { ResendConfirmationForm } from "./resend-confirmation-form";
import { EmailCodeForm } from "@/components/auth/email-code-form";

const INITIAL_STATE: SignUpFormState = {};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block busy={pending} disabled={!canSubmit}>
      Crear cuenta
    </Button>
  );
}

export function SignUpForm() {
  const [state, formAction] = useGuardedActionState(signUpAction, INITIAL_STATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (state.needsEmailConfirmation) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <StatusCircle tone="accent" icon={EnvelopeIcon} />
        <p className="text-sm text-textSecondary">
          Enviamos un enlace de confirmación a: <strong className="text-textPrimary">{email}</strong>
        </p>
        <FormInfoBox>Tocá el enlace del correo para activar tu cuenta.</FormInfoBox>
        <EmailCodeForm flow="signup" email={email} />
        <ResendConfirmationForm email={email} />
        <TextLink href="/login">Volver a iniciar sesión</TextLink>
      </div>
    );
  }

  const showMismatchError = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword);
  const showLoginHint = state.error === AUTH_ERROR_MESSAGES.user_already_exists;

  return (
    <form action={formAction} className="flex flex-col gap-[18px]" aria-label="Formulario de creación de cuenta">
      <Field label="Correo electrónico" htmlFor="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field label={`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`} htmlFor="password">
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

      <Field label="Repetir contraseña" htmlFor="confirmPassword" error={showMismatchError ? "Las contraseñas no coinciden." : undefined}>
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

      <CaptchaWidget />

      {state.error && <FormErrorBox message={state.error} />}

      {showLoginHint && (
        <FormInfoBox>
          ¿Ya tenías cuenta con este correo? <TextLink href="/login">Iniciar sesión</TextLink>
        </FormInfoBox>
      )}

      <SubmitButton canSubmit={canSubmitSignUp(email, password, confirmPassword)} />

      <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm text-textSecondary">
        ¿Ya tenés cuenta? <TextLink href="/login">Iniciar sesión</TextLink>
      </p>
    </form>
  );
}
