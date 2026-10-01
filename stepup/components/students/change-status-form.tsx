"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { changeStudentStatusAction, type ChangeStatusFormState } from "@/lib/actions/students";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS } from "@/lib/students/constants";
import type { StudentStatus } from "@/lib/db/database.types";

const INITIAL_STATE: ChangeStatusFormState = {};

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {label}
    </button>
  );
}

/**
 * Cambio de estado — pausar/dar de baja/archivar/restaurar. Único punto
 * real de la web para cambiar el estado de un alumno (a diferencia del
 * móvil, que tiene dos caminos no equivalentes — acá queda unificado desde
 * el vamos). Cada envío llama al RPC atómico correspondiente (historial +
 * alumno, y para archivar además la poda de agenda, todo en la misma
 * transacción). El botón se deshabilita mientras está pendiente
 * (`useFormStatus`) — mismo criterio anti-doble-toque que el resto de la
 * app.
 *
 * Decisión de producto confirmada (Fase 10): nunca hard delete — archivar/
 * restaurar es el flujo definitivo. Al archivar, la elección entre
 * conservar o quitar la agenda futura es SIEMPRE explícita, nunca
 * preseleccionada — el envío queda bloqueado hasta que la profesora la
 * marca a propósito.
 */
export function ChangeStatusForm({ studentId, currentStatus }: { studentId: string; currentStatus: StudentStatus }) {
  const boundAction = changeStudentStatusAction.bind(null, studentId);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);
  const today = new Date().toISOString().slice(0, 10);
  // Estable durante toda la vida de este formulario — un reintento o doble
  // clic reenvía el MISMO id, nunca uno nuevo (idempotencia real del lado servidor).
  const operationId = useMemo(() => crypto.randomUUID(), []);
  const [selectedStatus, setSelectedStatus] = useState<StudentStatus>("pausado");
  const [removeFromFuture, setRemoveFromFuture] = useState<"true" | "false" | "">("");

  if (currentStatus !== "activo") {
    return (
      <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
        <input type="hidden" name="status" value="activo" />
        <input type="hidden" name="occurredOn" value={today} />
        <input type="hidden" name="operationId" value={operationId} />
        <p className="text-sm text-textSecondary">
          Este alumno está <strong>{STUDENT_STATUS_LABEL[currentStatus].toLowerCase()}</strong>.
        </p>
        <p className="text-xs text-textMuted">
          Restaurar vuelve el estado a activo — nunca recrea sola la agenda que se haya quitado al archivar. Pagos, cargos, reportes
          e historial nunca se tocaron ni se tocan al restaurar.
        </p>
        {state.error && <FormErrorBox message={state.error} />}
        {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
        <div>
          <SubmitButton label="Restaurar (volver a activo)" />
        </div>
      </form>
    );
  }

  const isArchiving = selectedStatus === "archivado";
  const canSubmit = !isArchiving || removeFromFuture !== "";

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <input type="hidden" name="occurredOn" value={today} />
      <input type="hidden" name="operationId" value={operationId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="status" className="text-sm font-medium text-textSecondary">
          Cambiar estado a
        </label>
        <select
          id="status"
          name="status"
          value={selectedStatus}
          onChange={(e) => {
            setSelectedStatus(e.target.value as StudentStatus);
            setRemoveFromFuture("");
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-textPrimary focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          {STUDENT_STATUS_OPTIONS.filter((s) => s !== "activo").map((option) => (
            <option key={option} value={option}>
              {STUDENT_STATUS_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      {isArchiving && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
          <legend className="px-1 text-sm font-medium text-textSecondary">Agenda futura (elegí una opción)</legend>
          <label className="flex items-start gap-2 text-sm text-textPrimary">
            <input
              type="radio"
              name="removeFromFuture"
              value="false"
              checked={removeFromFuture === "false"}
              onChange={() => setRemoveFromFuture("false")}
              className="mt-0.5"
            />
            Conservar la agenda futura
          </label>
          <label className="flex items-start gap-2 text-sm text-textPrimary">
            <input
              type="radio"
              name="removeFromFuture"
              value="true"
              checked={removeFromFuture === "true"}
              onChange={() => setRemoveFromFuture("true")}
              className="mt-0.5"
            />
            Quitar de clases y series futuras
          </label>
          <p className="mt-1 text-xs text-textMuted">
            {removeFromFuture === "true"
              ? "Se cancelan las clases sueltas futuras donde es el único participante, y se termina cada serie donde es el único participante. Donde hay otros alumnos, la actividad de ellos sigue igual — se promueve a otro participante como principal, nunca se cancela por él."
              : removeFromFuture === "false"
                ? "Las clases y series ya agendadas siguen exactamente igual."
                : "Sin elegir todavía — el envío queda bloqueado hasta marcar una opción."}
          </p>
          <p className="text-xs text-textMuted">
            Pagos, cargos, reportes e historial nunca se borran, elijas lo que elijas. Nada de esto es reversible automáticamente:
            restaurar más adelante vuelve el estado a activo, pero nunca reconstruye sola la agenda que se haya quitado acá.
          </p>
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reason" className="text-sm font-medium text-textSecondary">
          Motivo (opcional)
        </label>
        <input
          id="reason"
          name="reason"
          type="text"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-textPrimary focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        />
      </div>

      {!isArchiving && (
        <p className="text-xs text-textMuted">
          El historial de clases y cobros nunca se borra al cambiar de estado.
        </p>
      )}

      {state.error && <FormErrorBox message={state.error} />}
      {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
      <div>
        <SubmitButton label="Aplicar cambio de estado" disabled={!canSubmit} />
      </div>
    </form>
  );
}
