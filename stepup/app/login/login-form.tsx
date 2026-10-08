"use client";

import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { CaptchaWidget } from "@/components/auth/captcha-widget";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/auth/public-links";
import { Field, TextInput } from "@/components/ui/field";

const INITIAL_STATE: AuthFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block busy={pending}>
      Iniciar sesión
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useGuardedActionState(signInAction, INITIAL_STATE);
  const showCreateAccountHint = state.error === AUTH_ERROR_MESSAGES.invalid_credentials;

  return (
    <form action={formAction} className="flex flex-col gap-[18px]" aria-label="Formulario de inicio de sesión">
      <input type="hidden" name="next" value={next} />

      <Field label="Correo electrónico" htmlFor="email">
        <TextInput id="email" name="email" type="email" autoComplete="email" required placeholder="tu@correo.com" />
      </Field>

      <Field label="Contraseña" htmlFor="password">
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
      </Field>

      <CaptchaWidget />

      {state.error && <FormErrorBox message={state.error} />}

      {showCreateAccountHint && (
        <FormInfoBox>
          ¿Todavía no tenés cuenta con este correo? <TextLink href="/crear-cuenta">Crear cuenta</TextLink>
        </FormInfoBox>
      )}

      <TextLink href="/recuperar-contrasena">Olvidé mi contraseña</TextLink>

      <SubmitButton />

      <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm text-textSecondary">
        ¿No tenés cuenta? <TextLink href="/crear-cuenta">Crear cuenta</TextLink>
      </p>
    </form>
  );
}
