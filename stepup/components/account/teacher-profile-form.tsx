"use client";

import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { saveTeacherProfileAction, type FormState } from "@/lib/actions/account";
import { FormErrorBox } from "@/components/auth/form-boxes";

const INITIAL_STATE: FormState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-md bg-brandBlue px-3.5 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
    >
      {pending ? "Guardando..." : "Guardar"}
    </button>
  );
}

export function TeacherProfileForm({ displayName }: { displayName: string }) {
  const [state, formAction] = useGuardedActionState(saveTeacherProfileAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2.5">
      <label htmlFor="displayName" className="text-xs font-medium text-textSecondary">
        Nombre visible en la app
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={displayName}
          placeholder="Tu nombre"
          className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
        <SaveButton />
      </div>
      {state.error && <FormErrorBox message={state.error} />}
    </form>
  );
}
