"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveTeacherProfileAction, type FormState } from "@/lib/actions/account";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { LiveMessage } from "@/components/account/settings-ui";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" busy={pending}>
      {pending ? "Guardando..." : "Guardar"}
    </Button>
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
        <TextInput
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={displayName}
          placeholder="Tu nombre"
          onChange={() => setEditedAfter(state)}
          className="min-w-[10rem] flex-1 sm:max-w-xs"
        />
        <SaveButton />
      </div>
      {state.error && <FormErrorBox message={state.error} />}
      <LiveMessage>{showSaved ? "Nombre guardado." : null}</LiveMessage>
    </form>
  );
}
