"use client";

import { useState } from "react";
import { ChevronDownIcon, TagIcon } from "@heroicons/react/24/outline";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { createLevelAction, renameLevelAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const INITIAL_STATE: FormState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" busy={pending}>
      {pending ? "Guardando..." : label}
    </Button>
  );
}

function RenameLevelRow({ level }: { level: CustomLevelRecord }) {
  const [editing, setEditing] = useState(false);
  const boundAction = renameLevelAction.bind(null, level.id);
  const [state, formAction] = useGuardedActionState(boundAction, INITIAL_STATE);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-background py-1 pl-3.5 pr-1 text-[14.5px]">
        <span className="min-w-0 font-[650] text-textPrimary [overflow-wrap:anywhere]">{level.name}</span>
        <Button variant="ghost" onClick={() => setEditing(true)} className="shrink-0">
          Renombrar
        </Button>
      </li>
    );
  }

  return (
    <li className="rounded-md border-[1.5px] border-borderMid bg-background p-3">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <TextInput type="text" name="name" aria-label="Nuevo nombre del nivel" defaultValue={level.name} autoFocus className="min-w-[8rem] flex-1" />
        <SubmitButton label="Guardar" />
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
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
    <details className="group rounded-lg border-[1.5px] border-border bg-surface shadow-card">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 text-[15px] font-[650] text-textPrimary nav:px-5 [&::-webkit-details-marker]:hidden">
        <TagIcon className="h-5 w-5 shrink-0 text-textSecondary" aria-hidden />
        <span className="min-w-0 flex-1">Niveles personalizados ({customLevels.length})</span>
        <span className="hidden shrink-0 text-[13px] font-medium text-textMuted sm:inline">Se suman a A1–C2</span>
        <ChevronDownIcon className="h-5 w-5 shrink-0 text-textMuted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-4 pb-4 pt-3 nav:px-5">
        {customLevels.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {customLevels.map((level) => (
              <RenameLevelRow key={level.id} level={level} />
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-textMuted">Todavía no creaste ningún nivel personalizado.</p>
        )}

        <form action={createAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <TextInput type="text" name="name" aria-label="Nombre del nivel nuevo" placeholder="Nombre del nivel nuevo" className="min-w-[10rem] flex-1" />
          <SubmitButton label="Crear nivel" />
        </form>
        {createState.error && <FormErrorBox message={createState.error} />}
      </div>
    </details>
  );
}
