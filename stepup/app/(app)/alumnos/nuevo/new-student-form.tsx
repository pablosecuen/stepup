"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { shouldRotateOperationId } from "@/lib/calendar/operation-id";
import { createStudentAction, type FormState } from "@/lib/actions/students";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { StudentFormFields } from "@/components/students/student-form-fields";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const INITIAL_STATE: FormState = {};

/** Clave de sessionStorage de la operación de alta en curso (una por pestaña; ver `useDraftOperationId`). */
const NEW_STUDENT_OPERATION_STORAGE_KEY = "teacherflow:alumnos:nuevo:operacion";

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

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      Guardar alumno
    </button>
  );
}

export function NewStudentForm({ customLevels }: { customLevels: CustomLevelRecord[] }) {
  const router = useRouter();
  const [state, formAction] = useGuardedActionState(createStudentAction, INITIAL_STATE);
  // La clave de operación nace ACÁ (navegador, una vez por borrador) y sobrevive recarga, doble envío y respuesta perdida;
  // el claim del servidor recién se crea al enviar. Hasta tenerla el envío queda bloqueado.
  const { operationId, rotate: rotateOperationId } = useDraftOperationId(NEW_STUDENT_OPERATION_STORAGE_KEY);

  // Confirmación canónica del servidor con ESTA clave (alta nueva o ya existente): rota la clave y recién ahí navega a la
  // ficha. Nunca antes: navegar con la clave vieja en sessionStorage haría que el próximo "Nuevo alumno" reencuentre al anterior.
  useEffect(() => {
    if (!shouldRotateOperationId(state.createdOperationId, operationId) || !state.createdStudentId) return;
    rotateOperationId();
    router.push(`/alumnos/${state.createdStudentId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, operationId]);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de alta de alumno">
      <input type="hidden" name="operationId" value={operationId ?? ""} />
      <StudentFormFields customLevels={customLevels} />
      {state.error && <FormErrorBox message={state.error} />}
      {state.duplicate && <DuplicateReviewPanel candidates={state.duplicate.candidates} changed={state.duplicate.changed} />}
      <SubmitButton disabled={!operationId} />
    </form>
  );
}
