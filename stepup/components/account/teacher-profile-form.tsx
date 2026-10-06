"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveTeacherProfileAction, type FormState } from "@/lib/actions/account";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { BUTTON_PRIMARY, FIELD_CLASS, LiveMessage } from "@/components/account/settings-ui";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={BUTTON_PRIMARY}>
      {pending ? "Guardando..." : "Guardar"}
    </button>
  );
}

export function TeacherProfileForm({ displayName }: { displayName: string }) {
  const [state, formAction] = useGuardedActionState(saveTeacherProfileAction, INITIAL_STATE);
  // El «guardado» se anuncia hasta que la persona vuelve a editar el nombre.
  const [editedAfter, setEditedAfter] = useState<FormState | null>(null);
  const showSaved = state.saved === true && !state.error && editedAfter !== state;

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <label htmlFor="displayName" className="sr-only">
        Nombre visible
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={displayName}
          placeholder="Tu nombre"
          onChange={() => setEditedAfter(state)}
          className={`${FIELD_CLASS} min-w-[10rem] flex-1`}
        />
        <SaveButton />
      </div>
      {state.error && <FormErrorBox message={state.error} />}
      <LiveMessage>{showSaved ? "Nombre guardado." : null}</LiveMessage>
    </form>
  );
}
