"use client";

import { useMemo, useState } from "react";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { changeStudentStatusAction, type ChangeStatusFormState } from "@/lib/actions/students";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS } from "@/lib/students/constants";
import type { StudentStatus } from "@/lib/db/database.types";
import { todayInArgentina } from "@/lib/format/date-format";

const INITIAL_STATE: ChangeStatusFormState = {};

const RADIO_OPTION =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-[1.5px] border-border bg-surface px-3 py-2.5 text-[15px] text-textPrimary has-[:checked]:border-ink has-[:checked]:bg-surface2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2";

function SubmitButton({ label, disabled, destructive }: { label: string; disabled?: boolean; destructive?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={destructive ? "dangerOutline" : "secondary"} busy={pending} disabled={disabled}>
      {label}
    </Button>
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
 *
 * Presentación: tarjeta propia al final del Resumen, separada de las acciones normales. Al elegir «Archivado» el botón pasa a
 * contorno rojo (acción con consecuencias); la lógica del formulario no cambió.
 */
export function ChangeStatusForm({ studentId, currentStatus }: { studentId: string; currentStatus: StudentStatus }) {
  const boundAction = changeStudentStatusAction.bind(null, studentId);
  const [state, formAction] = useGuardedActionState(boundAction, INITIAL_STATE);
  const today = todayInArgentina();
  // Estable durante toda la vida de este formulario — un reintento o doble
  // clic reenvía el MISMO id, nunca uno nuevo (idempotencia real del lado servidor).
  const operationId = useMemo(() => crypto.randomUUID(), []);
  const [selectedStatus, setSelectedStatus] = useState<StudentStatus>("pausado");
  const [removeFromFuture, setRemoveFromFuture] = useState<"true" | "false" | "">("");

  if (currentStatus !== "activo") {
    return (
      <Card padded={false}>
        <CardHeader title="Cambiar estado" />
        <form action={formAction} className="flex flex-col gap-3 px-4 pb-4 nav:px-5 nav:pb-5">
          <input type="hidden" name="status" value="activo" />
          <input type="hidden" name="occurredOn" value={today} />
          <input type="hidden" name="operationId" value={operationId} />
          <p className="text-[15px] text-textSecondary">
            Este alumno está <strong className="text-textPrimary">{STUDENT_STATUS_LABEL[currentStatus].toLowerCase()}</strong>.
          </p>
          <p className="text-[13.5px] text-textMuted">
            Restaurar vuelve el estado a activo — nunca recrea sola la agenda que se haya quitado al archivar. Pagos, cargos, reportes
            e historial nunca se tocaron ni se tocan al restaurar.
          </p>
          {state.error && <FormErrorBox message={state.error} />}
          {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
          <div>
            <SubmitButton label="Restaurar (volver a activo)" />
          </div>
        </form>
      </Card>
    );
  }

  const isArchiving = selectedStatus === "archivado";
  const canSubmit = !isArchiving || removeFromFuture !== "";

  return (
    <Card padded={false}>
      <CardHeader title="Cambiar estado" />
      <form action={formAction} className="flex flex-col gap-4 px-4 pb-4 nav:px-5 nav:pb-5">
        <input type="hidden" name="occurredOn" value={today} />
        <input type="hidden" name="operationId" value={operationId} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cambiar estado a" htmlFor="status">
            <SelectInput
              id="status"
              name="status"
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value as StudentStatus);
                setRemoveFromFuture("");
              }}
            >
              {STUDENT_STATUS_OPTIONS.filter((s) => s !== "activo").map((option) => (
                <option key={option} value={option}>
                  {STUDENT_STATUS_LABEL[option]}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Motivo (opcional)" htmlFor="reason">
            <TextInput id="reason" name="reason" type="text" />
          </Field>
        </div>

        {isArchiving && (
          <fieldset className="flex min-w-0 flex-col gap-2.5 rounded-md border-[1.5px] border-warnLine bg-warnSoft p-3.5">
            <legend className="px-1 text-sm font-[650] text-textPrimary">Agenda futura (elegí una opción)</legend>
            <label className={RADIO_OPTION}>
              <input
                type="radio"
                name="removeFromFuture"
                value="false"
                checked={removeFromFuture === "false"}
                onChange={() => setRemoveFromFuture("false")}
                className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
              />
              Conservar la agenda futura
            </label>
            <label className={RADIO_OPTION}>
              <input
                type="radio"
                name="removeFromFuture"
                value="true"
                checked={removeFromFuture === "true"}
                onChange={() => setRemoveFromFuture("true")}
                className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
              />
              Quitar de clases y series futuras
            </label>
            <p className="text-[13.5px] text-textSecondary">
              {removeFromFuture === "true"
                ? "Se cancelan las clases sueltas futuras donde es el único participante, y se termina cada serie donde es el único participante. Donde hay otros alumnos, la actividad de ellos sigue igual — se promueve a otro participante como principal, nunca se cancela por él."
                : removeFromFuture === "false"
                  ? "Las clases y series ya agendadas siguen exactamente igual."
                  : "Sin elegir todavía — el envío queda bloqueado hasta marcar una opción."}
            </p>
            <p className="text-[13.5px] text-textSecondary">
              Pagos, cargos, reportes e historial nunca se borran, elijas lo que elijas. Nada de esto es reversible automáticamente:
              restaurar más adelante vuelve el estado a activo, pero nunca reconstruye sola la agenda que se haya quitado acá.
            </p>
          </fieldset>
        )}

        {!isArchiving && <p className="text-[13.5px] text-textMuted">El historial de clases y cobros nunca se borra al cambiar de estado.</p>}

        {state.error && <FormErrorBox message={state.error} />}
        {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
        <div>
          <SubmitButton label="Aplicar cambio de estado" disabled={!canSubmit} destructive={isArchiving} />
        </div>
      </form>
    </Card>
  );
}
