"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { resendConfirmationAction, type AuthFormState } from "@/lib/auth/actions";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";

// Mismo cooldown que móvil (AuthEmailConfirmationScreen.tsx,
// RESEND_COOLDOWN_SECONDS = 30) — cuenta regresiva puramente visual,
// Supabase igual aplica su propio límite real del lado del servidor.
const RESEND_COOLDOWN_SECONDS = 30;

function ResendButton({ cooldown }: { cooldown: number }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || cooldown > 0;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="text-sm font-semibold text-brandBlue transition hover:underline disabled:cursor-not-allowed disabled:text-textMuted disabled:no-underline"
    >
      {cooldown > 0 ? `Podrás reenviar en ${cooldown} segundos` : "Reenviar enlace"}
    </button>
  );
}

export function ResendConfirmationForm({ email }: { email: string }) {
  const [state, formAction] = useActionState<AuthFormState & { sent?: boolean }, FormData>(resendConfirmationAction, {});
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Reinicia la cuenta regresiva cuando un reenvío exitoso cambia `state`
  // — ajuste de estado durante el render (patrón recomendado por React
  // para "reset cuando cambia algo"), no un efecto: evita el commit extra
  // que dispara react-hooks/set-state-in-effect.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.sent) setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <form action={formAction} className="flex flex-col items-center gap-2">
      <input type="hidden" name="email" value={email} />
      <ResendButton cooldown={cooldown} />
      {state.sent && <FormInfoBox>Te enviamos un nuevo enlace.</FormInfoBox>}
      {state.error && <FormErrorBox message={state.error} />}
    </form>
  );
}
