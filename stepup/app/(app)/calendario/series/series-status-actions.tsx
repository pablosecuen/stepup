"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecurrenceStatusAction, editFutureRecurrenceAction, type FormState } from "@/lib/actions/calendar";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { WeekdayScheduleEditor, defaultWeekdayRows, weekdayRowsToWeeksJson, type WeekdayRow } from "@/components/calendar/weekday-schedule-editor";
import type { RecurrenceRuleStatus } from "@/lib/db/database.types";
import type { RecurrenceWeek } from "@/lib/calendar/types";

export function SeriesStatusActions({
  ruleId,
  status,
  weeks,
  participantIds,
}: {
  ruleId: string;
  status: RecurrenceRuleStatus;
  weeks: RecurrenceWeek[];
  participantIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingFuture, setEditingFuture] = useState(false);
  const [weekdayRows, setWeekdayRows] = useState<WeekdayRow[]>(() => defaultWeekdayRows(weeks));

  function applyStatus(next: "active" | "paused" | "ended") {
    setError(null);
    startTransition(async () => {
      const result: FormState = await setRecurrenceStatusAction(ruleId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitEditFuture(formData: FormData) {
    setError(null);
    formData.set("originalRecurrenceId", ruleId);
    formData.set("weeksJson", weekdayRowsToWeeksJson(weekdayRows));
    participantIds.forEach((id) => formData.append("participantIds", id));
    startTransition(async () => {
      const result = await editFutureRecurrenceAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditingFuture(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        {status === "active" && (
          <button type="button" disabled={pending} onClick={() => applyStatus("paused")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textPrimary hover:border-brandBlue/30 disabled:opacity-50">
            Pausar
          </button>
        )}
        {status === "paused" && (
          <button type="button" disabled={pending} onClick={() => applyStatus("active")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textPrimary hover:border-brandBlue/30 disabled:opacity-50">
            Reanudar
          </button>
        )}
        {status !== "ended" && (
          <button type="button" disabled={pending} onClick={() => applyStatus("ended")} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-statusRojo hover:border-statusRojo/30 disabled:opacity-50">
            Finalizar
          </button>
        )}
        {status !== "ended" && (
          <button
            type="button"
            onClick={() => setEditingFuture((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-brandBlue hover:border-brandBlue/30"
          >
            {editingFuture ? "Cerrar" : "Editar futuras"}
          </button>
        )}
      </div>

      {error && <FormErrorBox message={error} />}

      {editingFuture && (
        <form action={submitEditFuture} className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`effectiveDate-${ruleId}`} className="text-xs font-medium text-textSecondary">
              Desde qué fecha rige el nuevo patrón
            </label>
            <input id={`effectiveDate-${ruleId}`} name="effectiveDate" type="date" required className="rounded-md border border-border px-3 py-2 text-sm" />
          </div>
          <WeekdayScheduleEditor rows={weekdayRows} onChange={setWeekdayRows} />
          <p className="text-xs text-textMuted">La agenda anterior a esa fecha queda intacta — nunca se modifica el pasado.</p>
          <button type="submit" disabled={pending} className="rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Guardando..." : "Confirmar desde esa fecha"}
          </button>
        </form>
      )}
    </div>
  );
}
