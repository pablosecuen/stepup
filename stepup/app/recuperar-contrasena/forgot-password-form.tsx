"use client";

import { CaptchaWidget } from "@/components/auth/captcha-widget";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { requestPasswordResetAction, type AuthFormState } from "@/lib/auth/actions";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { StatusCircle } from "@/components/ui/status-circle";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/auth/public-links";
import { Field, TextInput } from "@/components/ui/field";

const INITIAL_STATE: AuthFormState & { sent?: boolean; email?: string } = {};
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block busy={pending}>
      Enviar enlace
    </Button>
  );
}

// Réplica de ForgotPasswordScreen.tsx en móvil: dos estados (formulario /
// enviado). El texto del estado "enviado" es deliberadamente ambiguo sobre
// si la cuenta existe (anti-enumeración) — se copia tal cual.
export function ForgotPasswordForm() {
  const [state, formAction] = useGuardedActionState(requestPasswordResetAction, INITIAL_STATE);

  if (state.sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <StatusCircle tone="accent" icon={EnvelopeIcon} />
        <p className="text-sm text-textSecondary">
          Si <strong className="text-textPrimary">{state.email}</strong> tiene una cuenta, te enviamos un enlace
          para elegir una contraseña nueva.
        </p>
        {state.email && <EmailCodeForm flow="recovery" email={state.email} />}
        <TextLink href="/login">Volver a iniciar sesión</TextLink>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-[18px]" aria-label="Formulario para recuperar la contraseña">
      <Field label="Correo electrónico" htmlFor="email">
        <TextInput id="email" name="email" type="email" autoComplete="email" required placeholder="tu@correo.com" />
      </Field>

      <CaptchaWidget />

      {state.error && <FormErrorBox message={state.error} />}

      <SubmitButton />

      <TextLink href="/login" block>
        Volver a iniciar sesión
      </TextLink>
    </form>
  );
}
