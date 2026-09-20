"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changeStudentStatusAction, type ChangeStatusFormState } from "@/lib/actions/students";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS } from "@/lib/students/constants";
import type { StudentStatus } from "@/lib/db/database.types";

const INITIAL_STATE: ChangeStatusFormState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {label}
    </button>
  );
}

/**
 * Cambio de estado — pausar/dar de baja/archivar/restaurar. Cada envío
 * llama al RPC atómico `change_student_status` (historial + alumno en la
 * misma transacción). El botón se deshabilita mientras está pendiente
 * (`useFormStatus`) — mismo criterio anti-doble-toque que el resto de la
 * app (formularios de auth).
 *
 * "Archivar" NUNCA poda la agenda futura del alumno todavía (esa función
 * depende de `recurrence_rules`/`calendar_lessons` reales — Fase 3): se lo
 * indica explícitamente para no simular una función que todavía no existe.
 */
export function ChangeStatusForm({ studentId, currentStatus }: { studentId: string; currentStatus: StudentStatus }) {
  const boundAction = changeStudentStatusAction.bind(null, studentId);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);
  const today = new Date().toISOString().slice(0, 10);

  if (currentStatus !== "activo") {
    return (
      <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
        <input type="hidden" name="status" value="activo" />
        <input type="hidden" name="occurredOn" value={today} />
        <p className="text-sm text-textSecondary">
          Este alumno está <strong>{STUDENT_STATUS_LABEL[currentStatus].toLowerCase()}</strong>.
        </p>
        {state.error && <FormErrorBox message={state.error} />}
        {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
        <div>
          <SubmitButton label="Restaurar (volver a activo)" />
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <input type="hidden" name="occurredOn" value={today} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="status" className="text-sm font-medium text-textSecondary">
          Cambiar estado a
        </label>
        <select
          id="status"
          name="status"
          defaultValue="pausado"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-textPrimary focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          {STUDENT_STATUS_OPTIONS.filter((s) => s !== "activo").map((option) => (
            <option key={option} value={option}>
              {STUDENT_STATUS_LABEL[option]}
            </option>
          ))}
        </select>
      </div>
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
      <p className="text-xs text-textMuted">
        Archivar no quita al alumno de clases futuras todavía — esa función depende de Calendario (Fase 3). El historial de
        clases y cobros nunca se borra al cambiar de estado.
      </p>
      {state.error && <FormErrorBox message={state.error} />}
      {state.success && <FormInfoBox>Estado actualizado.</FormInfoBox>}
      <div>
        <SubmitButton label="Aplicar cambio de estado" />
      </div>
    </form>
  );
}
