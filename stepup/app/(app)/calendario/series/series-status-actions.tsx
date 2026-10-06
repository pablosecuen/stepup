"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecurrenceStatusAction, editFutureRecurrenceAction, changeParticipantsAction, type FormState } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { WeekdayScheduleEditor, defaultWeekCycles, resizeWeekCycles, weekCyclesToWeeksJson, type WeekRows } from "@/components/calendar/weekday-schedule-editor";
import type { RecurrenceRuleStatus } from "@/lib/db/database.types";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { nextPrimaryAfterToggle } from "@/lib/calendar/primary-selection";

export function SeriesStatusActions({
  ruleId,
  status,
  weeks,
  participantIds,
  primaryStudentId,
  students,
}: {
  ruleId: string;
  status: RecurrenceRuleStatus;
  weeks: RecurrenceWeek[];
  participantIds: string[];
  primaryStudentId: string | null;
  students: StudentRecord[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingFuture, setEditingFuture] = useState(false);
  const [editingParticipants, setEditingParticipants] = useState(false);
  const initialCycle = (weeks.length > 0 ? weeks.length : 1) as 1 | 2 | 3 | 4;
  const [cycleLengthWeeks, setCycleLengthWeeks] = useState<1 | 2 | 3 | 4>(initialCycle);
  const [weekCycles, setWeekCycles] = useState<WeekRows[]>(() => defaultWeekCycles(initialCycle, weeks));
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(() => new Set(participantIds));
  // "al editar, debe mostrarse el principal realmente guardado" — se
  // inicializa SIEMPRE desde el valor real de la regla, nunca recalculado.
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string>(() => primaryStudentId ?? "");

  function handleCycleLengthChange(next: 1 | 2 | 3 | 4) {
    setCycleLengthWeeks(next);
    setWeekCycles((prev) => resizeWeekCycles(prev, next));
  }

  function toggleParticipant(id: string) {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedPrimaryId(nextPrimaryAfterToggle(prev.size, Array.from(next), selectedPrimaryId));
      return next;
    });
  }

  function applyStatus(next: "active" | "paused" | "ended") {
    setError(null);
    startTransition(async () => {
      const result: FormState = await guardNetwork(() => setRecurrenceStatusAction(ruleId, next));
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
    formData.set("weeksJson", weekCyclesToWeeksJson(weekCycles));
    participantIds.forEach((id) => formData.append("participantIds", id));
    startTransition(async () => {
      const result = await guardNetwork(() => editFutureRecurrenceAction({}, formData));
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditingFuture(false);
      router.refresh();
    });
  }

  function submitChangeParticipants(formData: FormData) {
    setError(null);
    const effectiveDate = String(formData.get("participantsEffectiveDate") ?? "");
    startTransition(async () => {
      const result = await guardNetwork(() => changeParticipantsAction({
        ruleId,
        effectiveDate,
        newParticipantIds: Array.from(selectedParticipantIds),
        primaryStudentId: selectedPrimaryId || null,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditingParticipants(false);
      router.refresh();
    });
  }

  const eligibleStudents = students.filter((s) => s.status !== "archivado" || selectedParticipantIds.has(s.id));

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
            onClick={() => {
              setEditingParticipants(false);
              setEditingFuture((v) => !v);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-brandBlue hover:border-brandBlue/30"
          >
            {editingFuture ? "Cerrar" : "Editar futuras"}
          </button>
        )}
        {status !== "ended" && (
          <button
            type="button"
            onClick={() => {
              setEditingFuture(false);
              setEditingParticipants((v) => !v);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-brandBlue hover:border-brandBlue/30"
          >
            {editingParticipants ? "Cerrar" : "Modificar participantes"}
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
            <input id={`effectiveDate-${ruleId}`} name="effectiveDate" type="date" required className="rounded-md border border-borderStrong px-3 py-2 text-sm" />
          </div>
          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={setWeekCycles} />
          <p className="text-xs text-textMuted">La agenda anterior a esa fecha queda intacta — nunca se modifica el pasado.</p>
          <button type="submit" disabled={pending} className="rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Guardando..." : "Confirmar desde esa fecha"}
          </button>
        </form>
      )}

      {editingParticipants && (
        <form action={submitChangeParticipants} className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`participantsEffectiveDate-${ruleId}`} className="text-xs font-medium text-textSecondary">
              Desde qué fecha rige el nuevo grupo de alumnos
            </label>
            <input
              id={`participantsEffectiveDate-${ruleId}`}
              name="participantsEffectiveDate"
              type="date"
              required
              className="rounded-md border border-borderStrong px-3 py-2 text-sm"
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-textSecondary">Alumnos *</legend>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
              {eligibleStudents.map((student) => (
                <label key={student.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-background">
                  <input
                    type="checkbox"
                    checked={selectedParticipantIds.has(student.id)}
                    onChange={() => toggleParticipant(student.id)}
                    className="h-4 w-4 rounded border-border text-brandBlue focus:ring-brandBlue"
                  />
                  {student.name}
                </label>
              ))}
            </div>
          </fieldset>
          {selectedParticipantIds.size >= 2 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-medium text-textSecondary">Alumno principal *</legend>
              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                {eligibleStudents
                  .filter((student) => selectedParticipantIds.has(student.id))
                  .map((student) => (
                    <label key={student.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-background">
                      <input
                        type="radio"
                        name={`primaryStudentIdChoice-${ruleId}`}
                        checked={selectedPrimaryId === student.id}
                        onChange={() => setSelectedPrimaryId(student.id)}
                        className="h-4 w-4 border-border text-brandBlue focus:ring-brandBlue"
                      />
                      {student.name}
                    </label>
                  ))}
              </div>
              {!selectedPrimaryId && <p className="text-xs text-statusRojo">Elegí quién es el alumno principal.</p>}
            </fieldset>
          )}
          <FormInfoBox>
            Las clases ya pasadas o ya registradas conservan sus alumnos de siempre. Las clases entre hoy y esa fecha que todavía no se
            registraron se guardan primero con el grupo actual — nunca se reinterpreta el pasado.
          </FormInfoBox>
          <button
            type="submit"
            disabled={pending || selectedParticipantIds.size === 0 || !selectedPrimaryId}
            className="rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Guardando..." : "Confirmar desde esa fecha"}
          </button>
        </form>
      )}
    </div>
  );
}
