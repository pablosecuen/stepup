"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecurrenceStatusAction, editFutureRecurrenceAction, changeParticipantsAction, type FormState } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Field, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { StudentPicker } from "@/components/students/student-picker";
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
  const pickableStudents = eligibleStudents.map((student) => ({ id: student.id, name: student.name, status: student.status, level: student.levels.join(" · ") }));

  return (
    <div className="mt-3 flex flex-col gap-3 border-t-[1.5px] border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "active" && (
          <Button variant="secondary" disabled={pending} onClick={() => applyStatus("paused")}>
            Pausar
          </Button>
        )}
        {status === "paused" && (
          <Button variant="secondary" disabled={pending} onClick={() => applyStatus("active")}>
            Reanudar
          </Button>
        )}
        {status !== "ended" && (
          <Button
            variant="secondary"
            aria-expanded={editingFuture}
            onClick={() => {
              setEditingParticipants(false);
              setEditingFuture((v) => !v);
            }}
          >
            {editingFuture ? "Cerrar" : "Editar futuras"}
          </Button>
        )}
        {status !== "ended" && (
          <Button
            variant="secondary"
            aria-expanded={editingParticipants}
            onClick={() => {
              setEditingFuture(false);
              setEditingParticipants((v) => !v);
            }}
          >
            {editingParticipants ? "Cerrar" : "Modificar participantes"}
          </Button>
        )}
        {status !== "ended" && (
          <Button variant="dangerGhost" disabled={pending} onClick={() => applyStatus("ended")} className="sm:ml-auto">
            Finalizar
          </Button>
        )}
      </div>

      {error && <FormErrorBox message={error} />}

      {editingFuture && (
        <form action={submitEditFuture} className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
          <div>
            <h3 className="font-display text-card font-semibold">Dividir: «esta y las siguientes»</h3>
            <p className="mt-0.5 text-[13.5px] text-textMuted">El nuevo patrón rige desde la fecha que elijas. Lo anterior no se modifica.</p>
          </div>
          <Field label="Desde qué fecha rige el nuevo patrón" htmlFor={`effectiveDate-${ruleId}`}>
            <TextInput id={`effectiveDate-${ruleId}`} name="effectiveDate" type="date" required />
          </Field>
          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={setWeekCycles} />
          <p className="text-[13.5px] text-textMuted">La agenda anterior a esa fecha queda intacta — nunca se modifica el pasado.</p>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button type="submit" variant="primary" busy={pending}>
              {pending ? "Guardando..." : "Confirmar desde esa fecha"}
            </Button>
            <Button variant="ghost" onClick={() => setEditingFuture(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {editingParticipants && (
        <form action={submitChangeParticipants} className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
          <h3 className="font-display text-card font-semibold">Modificar participantes</h3>
          <Field label="Desde qué fecha rige el nuevo grupo de alumnos" htmlFor={`participantsEffectiveDate-${ruleId}`}>
            <TextInput id={`participantsEffectiveDate-${ruleId}`} name="participantsEffectiveDate" type="date" required />
          </Field>
          <fieldset className="min-w-0">
            <legend className="text-sm font-[650] text-textSecondary">Alumnos *</legend>
            <div className="mt-2">
              <StudentPicker students={pickableStudents} selectedIds={selectedParticipantIds} onToggle={toggleParticipant} />
            </div>
          </fieldset>
          {selectedParticipantIds.size >= 2 && (
            <fieldset className="min-w-0">
              <legend className="text-sm font-[650] text-textSecondary">Alumno principal *</legend>
              <div className={`${choiceGroupClass} mt-2`}>
                {eligibleStudents
                  .filter((student) => selectedParticipantIds.has(student.id))
                  .map((student) => (
                    <label key={student.id} className={choiceRowClass}>
                      <input
                        type="radio"
                        name={`primaryStudentIdChoice-${ruleId}`}
                        checked={selectedPrimaryId === student.id}
                        onChange={() => setSelectedPrimaryId(student.id)}
                        className={checkClass}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{student.name}</span>
                    </label>
                  ))}
              </div>
              {!selectedPrimaryId && <p className="mt-1.5 text-[13px] font-semibold text-bad">Elegí quién es el alumno principal.</p>}
            </fieldset>
          )}
          <FormInfoBox>
            Las clases ya pasadas o ya registradas conservan sus alumnos de siempre. Las clases entre hoy y esa fecha que todavía no se
            registraron se guardan primero con el grupo actual — nunca se reinterpreta el pasado.
          </FormInfoBox>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button type="submit" variant="primary" busy={pending} disabled={selectedParticipantIds.size === 0 || !selectedPrimaryId}>
              {pending ? "Guardando..." : "Confirmar desde esa fecha"}
            </Button>
            <Button variant="ghost" onClick={() => setEditingParticipants(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
