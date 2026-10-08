"use client";

import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { updateStudentAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { StudentFormFields } from "@/components/students/student-form-fields";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";
import type { StudentRecord } from "@/lib/repositories/students-mapping";

const INITIAL_STATE: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" busy={pending}>
      Guardar cambios
    </Button>
  );
}

export function EditStudentForm({ student, customLevels }: { student: StudentRecord; customLevels: CustomLevelRecord[] }) {
  const boundAction = updateStudentAction.bind(null, student.id);
  const [state, formAction] = useGuardedActionState(boundAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label={`Editar a ${student.name}`}>
      <StudentFormFields defaultValues={student} customLevels={customLevels} />
      {state.error && <FormErrorBox message={state.error} />}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SubmitButton />
        <PrivateButtonLink href={`/alumnos/${student.id}`} variant="ghost">
          Cancelar
        </PrivateButtonLink>
      </div>
    </form>
  );
}
