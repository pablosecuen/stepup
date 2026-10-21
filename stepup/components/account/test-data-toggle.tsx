"use client";

import { useFormStatus } from "react-dom";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { hideTestDataAction, showTestDataAction, type DataVisibilityState } from "@/lib/actions/data-visibility";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { LiveMessage } from "@/components/account/settings-ui";

const INITIAL_STATE: DataVisibilityState = {};

function SubmitButton({ label, busyLabel, variant }: { label: string; busyLabel: string; variant: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} busy={pending}>
      {pending ? busyLabel : label}
    </Button>
  );
}

function Feedback({ state }: { state: DataVisibilityState }) {
  const message = state.done === "shown" ? "Los datos de prueba vuelven a mostrarse en todas las pantallas." : state.done === "hidden" ? "Los datos de prueba vuelven a estar ocultos." : null;
  return (
    <>
      {state.error && <FormErrorBox message={state.error} />}
      <LiveMessage>{message}</LiveMessage>
    </>
  );
}

function ShowForm() {
  const [state, formAction] = useGuardedActionState(showTestDataAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <div>
        <SubmitButton label="Volver a mostrar los datos de prueba" busyLabel="Mostrando…" variant="secondary" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

function HideForm() {
  const [state, formAction] = useGuardedActionState(hideTestDataAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <div>
        <SubmitButton label="Ocultar los datos de prueba" busyLabel="Ocultando…" variant="primary" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

/**
 * Muestra u oculta los datos de prueba confirmados. No borra nada: sólo cambia si la exclusión está vigente o revocada. El botón que se ofrece depende del estado actual (`hidden`), que viene del servidor.
 */
export function TestDataToggle({ hidden }: { hidden: boolean }) {
  return hidden ? <ShowForm /> : <HideForm />;
}
