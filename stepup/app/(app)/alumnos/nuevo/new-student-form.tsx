"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { shouldRotateOperationId } from "@/lib/calendar/operation-id";
import { createStudentAction, type FormState } from "@/lib/actions/students";
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Avatar } from "@/components/ui/avatar";
import { Button, PrivateButtonLink, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { isDuplicatePanelVisible } from "@/lib/students/duplicate-review";
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
 *
 * Acciones: «Volver y editar los datos» (secundaria; sólo cierra el aviso y devuelve el foco al formulario, sin enviar nada) y
 * «Es otra persona, crear igualmente» (de menor peso que cualquier otra, para que crear un duplicado nunca sea el camino más
 * llamativo). El botón principal del formulario sigue siendo «Guardar alumno».
 */
export function DuplicateReviewPanel({
  candidates,
  changed,
  onBack,
}: {
  candidates: NonNullable<FormState["duplicate"]>["candidates"];
  changed: boolean;
  onBack: () => void;
}) {
  return (
    <Card tone="warn" role="status" className="flex flex-col gap-3.5">
      <p className="flex items-start gap-2.5 text-[15px] font-bold text-textPrimary">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
        <span>
          {changed
            ? "Los posibles duplicados cambiaron desde la última revisión — revisalos de nuevo antes de confirmar."
            : `Encontramos ${candidates.length === 1 ? "un alumno parecido" : "alumnos parecidos"}. ¿Es la misma persona?`}
        </span>
      </p>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <li key={c.id} className="flex flex-col gap-2.5 rounded-md border-[1.5px] border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar initial={avatarInitials(c.name)} tone={avatarToneFor(c.id)} size="m" />
              <div className="min-w-0">
                <p className="text-[14.5px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{c.name}</p>
                <p className="text-[13px] text-textMuted [overflow-wrap:anywhere]">{[c.phone, c.email].filter(Boolean).join(" · ") || "Sin teléfono ni email cargados"}</p>
              </div>
            </div>
            <a href={`/alumnos/${c.id}`} target="_blank" rel="noreferrer" className={`self-start ${buttonClass({ variant: "secondary" })}`}>
              Revisar alumno existente
              <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[13.5px] text-textSecondary">
        Si es otra persona, confirmá abajo para crearla de todas formas. Si es la misma, cancelá y editá los datos existentes desde su ficha.
      </p>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="secondary" onClick={onBack}>
          Volver y editar los datos
        </Button>
        <Button type="submit" name="confirmDuplicate" value="true" variant="ghost">
          Es otra persona, crear igualmente
        </Button>
      </div>
    </Card>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" busy={pending} disabled={pending || disabled}>
      Guardar alumno
    </Button>
  );
}

export function NewStudentForm({ customLevels }: { customLevels: CustomLevelRecord[] }) {
  const router = useRouter();
  const [state, formAction] = useGuardedActionState(createStudentAction, INITIAL_STATE);
  // La clave de operación nace ACÁ (navegador, una vez por borrador) y sobrevive recarga, doble envío y respuesta perdida;
  // el claim del servidor recién se crea al enviar. Hasta tenerla el envío queda bloqueado.
  const { operationId, rotate: rotateOperationId } = useDraftOperationId(NEW_STUDENT_OPERATION_STORAGE_KEY);

  const formRef = useRef<HTMLFormElement>(null);
  // Estado cuyo aviso de duplicado la persona cerró con «Volver y editar los datos» (sólo oculta; nada se envía ni se pierde).
  const [dismissedState, setDismissedState] = useState<FormState | null>(null);
  function backToEdit() {
    setDismissedState(state);
    formRef.current?.querySelector<HTMLInputElement>("#firstName")?.focus();
  }

  // Confirmación canónica del servidor con ESTA clave (alta nueva o ya existente): rota la clave y recién ahí navega a la
  // ficha. Nunca antes: navegar con la clave vieja en sessionStorage haría que el próximo "Nuevo alumno" reencuentre al anterior.
  useEffect(() => {
    if (!shouldRotateOperationId(state.createdOperationId, operationId) || !state.createdStudentId) return;
    rotateOperationId();
    router.push(`/alumnos/${state.createdStudentId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, operationId]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" aria-label="Formulario de alta de alumno">
      <input type="hidden" name="operationId" value={operationId ?? ""} />
      <StudentFormFields customLevels={customLevels} />
      {state.error && <FormErrorBox message={state.error} />}
      {state.duplicate && isDuplicatePanelVisible(state, dismissedState) && (
        <DuplicateReviewPanel candidates={state.duplicate.candidates} changed={state.duplicate.changed} onBack={backToEdit} />
      )}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SubmitButton disabled={!operationId} />
        <PrivateButtonLink href="/alumnos" variant="ghost">
          Cancelar
        </PrivateButtonLink>
      </div>
    </form>
  );
}
