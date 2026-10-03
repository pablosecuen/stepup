"use client";

import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { createStudentAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { StudentFormFields } from "@/components/students/student-form-fields";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const INITIAL_STATE: FormState = {};

/**
 * Panel de posible duplicado — nunca inserta nada por sí mismo. Ofrece
 * exactamente las 3 opciones pedidas: cancelar (editar y reenviar, o
 * volver a "Nuevo alumno" para reclamar OTRO borrador), revisar el
 * alumno existente, o confirmar explícitamente "es otra persona". El
 * servidor ya calculó y ALMACENÓ estos candidatos en el borrador — el
 * navegador sólo los muestra, nunca reenvía ningún id: confirmar vuelve a
 * mandar únicamente `claimId` + `confirmDuplicate=true`, el servidor
 * revalida todo desde cero contra lo que él mismo guardó.
 */
function DuplicateReviewPanel({ candidates, changed }: { candidates: NonNullable<FormState["duplicate"]>["candidates"]; changed: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">
        {changed
          ? "Los posibles duplicados cambiaron desde la última revisión — revisalos de nuevo antes de confirmar."
          : `Encontramos ${candidates.length === 1 ? "un alumno parecido" : "alumnos parecidos"}. ¿Es la misma persona?`}
      </p>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-3 py-2">
            <div>
              <p className="font-medium text-neutralInk">{c.name}</p>
              <p className="text-xs text-neutralInk/70">
                {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin teléfono ni email cargados"}
              </p>
            </div>
            <a
              href={`/alumnos/${c.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-brandBlue underline underline-offset-2"
            >
              Revisar alumno existente
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-800">
        Si es otra persona, confirmá abajo para crearla de todas formas. Si es la misma, cancelá y editá los datos existentes desde su ficha.
      </p>
      <button
        type="submit"
        name="confirmDuplicate"
        value="true"
        className="self-start rounded-md border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
      >
        Es otra persona, crear igualmente
      </button>
    </div>
  );
}

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

export function NewStudentForm({ customLevels, claimId }: { customLevels: CustomLevelRecord[]; claimId: string }) {
  const [state, formAction] = useGuardedActionState(createStudentAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de alta de alumno">
      {/* Borrador reclamado server-side por la página (nunca generado acá) — ver `claim_student_creation()`. */}
      <input type="hidden" name="claimId" value={claimId} />
      <StudentFormFields customLevels={customLevels} />
      {state.error && <FormErrorBox message={state.error} />}
      {state.duplicate && <DuplicateReviewPanel candidates={state.duplicate.candidates} changed={state.duplicate.changed} />}
      <SubmitButton />
    </form>
  );
}
