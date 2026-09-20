"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createStudentAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { StudentFormFields } from "@/components/students/student-form-fields";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const INITIAL_STATE: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      Guardar alumno
    </button>
  );
}

export function NewStudentForm({ customLevels }: { customLevels: CustomLevelRecord[] }) {
  const [state, formAction] = useActionState(createStudentAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de alta de alumno">
      <StudentFormFields customLevels={customLevels} />
      {state.error && <FormErrorBox message={state.error} />}
      <SubmitButton />
    </form>
  );
}
