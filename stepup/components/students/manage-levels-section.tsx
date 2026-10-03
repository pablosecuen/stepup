"use client";

import { useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { createLevelAction, renameLevelAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const INITIAL_STATE: FormState = {};

function SmallSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-md bg-brandBlue px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
    >
      {pending ? "Guardando..." : label}
    </button>
  );
}

function RenameLevelRow({ level }: { level: CustomLevelRecord }) {
  const [editing, setEditing] = useState(false);
  const boundAction = renameLevelAction.bind(null, level.id);
  const [state, formAction] = useGuardedActionState(boundAction, INITIAL_STATE);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <span className="text-textPrimary">{level.name}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-semibold text-brandBlue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          Renombrar
        </button>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-brandBlue/30 bg-background px-3 py-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="name"
          defaultValue={level.name}
          autoFocus
          className="min-w-[8rem] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-textPrimary focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
        <SmallSubmitButton label="Guardar" />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs font-medium text-textSecondary hover:text-textPrimary"
        >
          Cancelar
        </button>
      </form>
      {state.error && (
        <div className="mt-2">
          <FormErrorBox message={state.error} />
        </div>
      )}
    </li>
  );
}

export function ManageLevelsSection({ customLevels }: { customLevels: CustomLevelRecord[] }) {
  const [createState, createAction] = useGuardedActionState(createLevelAction, INITIAL_STATE);

  return (
    <details className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <summary className="cursor-pointer text-sm font-semibold text-textPrimary">
        Niveles personalizados ({customLevels.length})
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {customLevels.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {customLevels.map((level) => (
              <RenameLevelRow key={level.id} level={level} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-textMuted">Todavía no creaste ningún nivel personalizado.</p>
        )}

        <form action={createAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            type="text"
            name="name"
            placeholder="Nombre del nivel nuevo"
            className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
          />
          <SmallSubmitButton label="Crear nivel" />
        </form>
        {createState.error && <FormErrorBox message={createState.error} />}
      </div>
    </details>
  );
}
