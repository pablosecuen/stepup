"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecurrenceStatusAction, editFutureRecurrenceAction, changeParticipantsAction, endSeriesFromTodayAction, type FormState } from "@/lib/actions/calendar";
import { Dialog } from "@/components/ui/dialog";
import { SeriesSwapPanel, type SwapOption } from "@/components/calendar/series-swap-panel";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Field, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { StudentPicker } from "@/components/students/student-picker";
import { WeekdayScheduleEditor, defaultWeekCycles, resizeWeekCycles, weekCyclesToWeeksJson, type WeekRows } from "@/components/calendar/weekday-schedule-editor";
import type { RecurrenceRuleStatus } from "@/lib/db/database.types";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { nextPrimaryAfterToggle } from "@/lib/calendar/primary-selection";
import { generateOccurrences } from "@/lib/calendar/recurrence-engine";
import { CALENDAR_TIMEZONE, formatCivilDayLabel, formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { mondayOfWeekContaining } from "@/lib/calendar/weekday";
import { todayInArgentina } from "@/lib/format/date-format";

/**
 * Envío de los formularios de esta pantalla SIN `action={…}`: con `action`, React 19 reinicia el formulario al terminar la acción (incluso si
 * devolvió un error) y las casillas de los días volvían a mostrar el patrón ANTERIOR mientras el estado ya tenía el nuevo (vista previa y
 * envío distintos de lo que se veía). Con `onSubmit` la validación nativa (`required`) sigue funcionando y los campos conservan lo elegido.
 */
function submitWithoutReset(event: React.FormEvent<HTMLFormElement>, submit: (formData: FormData) => void) {
  event.preventDefault();
  submit(new FormData(event.currentTarget));
}

export function SeriesStatusActions({
  ruleId,
  status,
  weeks,
  participantIds,
  primaryStudentId,
  students,
  seriesLabel,
  scheduleLabel,
  swapOptions = [],
}: {
  /** Nombre y horario de LA serie (para decir en la confirmación exactamente qué se quita). */
  seriesLabel: string;
  scheduleLabel: string;
  swapOptions?: SwapOption[];
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
  // Aviso de choque de horario del nuevo patrón: se puede cambiar el horario o guardar igual a propósito.
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  // Cambios ya programados que este cambio reemplazaría (tramos posteriores a la fecha): se muestran y se confirman, nunca se finalizan en silencio.
  const [replaceWarning, setReplaceWarning] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [editingFuture, setEditingFuture] = useState(false);
  const [editingParticipants, setEditingParticipants] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const initialCycle = (weeks.length > 0 ? weeks.length : 1) as 1 | 2 | 3 | 4;
  const [cycleLengthWeeks, setCycleLengthWeeks] = useState<1 | 2 | 3 | 4>(initialCycle);
  const [weekCycles, setWeekCycles] = useState<WeekRows[]>(() => defaultWeekCycles(initialCycle, weeks));
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(() => new Set(participantIds));
  // "al editar, debe mostrarse el principal realmente guardado" — se
  // inicializa SIEMPRE desde el valor real de la regla, nunca recalculado.
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string>(() => primaryStudentId ?? "");
  // Fecha efectiva: por defecto HOY (hora civil de la cuenta), nunca vacía ni de otro día; la profesora la ve escrita en palabras antes de confirmar.
  const today = useMemo(() => todayInArgentina(), []);
  const [futureDate, setFutureDate] = useState(today);
  const [participantsDate, setParticipantsDate] = useState(today);
  // Primera clase que tendrá el nuevo patrón desde la fecha elegida: así se ve de entrada si el cambio cae en el día que se espera.
  const firstNewClass = useMemo(() => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(futureDate)) return null;
      const weeksOfPattern = JSON.parse(weekCyclesToWeeksJson(weekCycles)) as RecurrenceWeek[];
      const rangeStart = new Date(localDateTimeToInstantIso({ date: futureDate, hour: 0, minute: 0, timeZone: CALENDAR_TIMEZONE }));
      const [first] = generateOccurrences(
        {
          recurrenceId: "vista-previa",
          studentId: null,
          participantIds: [],
          cycleLengthWeeks: weeksOfPattern.length,
          weeks: weeksOfPattern,
          modality: "online",
          timezone: CALENDAR_TIMEZONE,
          startDate: mondayOfWeekContaining(futureDate),
          endDate: null,
          status: "active",
          classTitle: null,
          activityKind: "class",
        },
        rangeStart,
        new Date(rangeStart.getTime() + 60 * 86_400_000)
      );
      return first ? `${formatCivilDayLabelShort(instantDateKey(first.start))}, ${instantTimeLabel(first.start)}` : null;
    } catch {
      return null;
    }
  }, [futureDate, weekCycles]);

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

  function confirmEndSeries() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => endSeriesFromTodayAction(ruleId));
      if (result.error) {
        setConfirmingEnd(false);
        setError(result.error);
        return;
      }
      setConfirmingEnd(false);
      router.refresh();
    });
  }

  function submitEditFuture(formData: FormData, allowOverlap = false, confirmReplace = replaceConfirmed) {
    setError(null);
    setOverlapWarning(null);
    setReplaceWarning(null);
    if (allowOverlap) formData.set("allowOverlap", "true");
    if (confirmReplace) formData.set("confirmReplace", "true");
    formData.set("originalRecurrenceId", ruleId);
    formData.set("weeksJson", weekCyclesToWeeksJson(weekCycles));
    participantIds.forEach((id) => formData.append("participantIds", id));
    startTransition(async () => {
      const result = await guardNetwork(() => editFutureRecurrenceAction({}, formData));
      if (result.error) {
        if (result.replaces) setReplaceWarning(result.error);
        else if (result.conflict) setOverlapWarning(result.error);
        else setError(result.error);
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
              setSwapOpen(false);
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
              setSwapOpen(false);
              setEditingParticipants((v) => !v);
            }}
          >
            {editingParticipants ? "Cerrar" : "Modificar participantes"}
          </Button>
        )}
        {status === "active" && swapOptions.length >= 2 && swapOptions.some((option) => option.id === ruleId) && (
          <Button
            variant="secondary"
            aria-expanded={swapOpen}
            onClick={() => {
              setEditingFuture(false);
              setEditingParticipants(false);
              setSwapOpen((v) => !v);
            }}
          >
            {swapOpen ? "Cerrar" : "Intercambiar horarios"}
          </Button>
        )}
        {status !== "ended" && (
          <Button variant="dangerOutline" disabled={pending} onClick={() => setConfirmingEnd(true)} aria-haspopup="dialog" className="sm:ml-auto">
            Eliminar serie
          </Button>
        )}
      </div>

      {error && <FormErrorBox message={error} />}

      {swapOpen && <SeriesSwapPanel options={swapOptions} fixedId={ruleId} onClose={() => setSwapOpen(false)} />}

      {confirmingEnd && (
        <Dialog
          title="Eliminar serie"
          onClose={() => setConfirmingEnd(false)}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingEnd(false)} disabled={pending}>
                Volver
              </Button>
              <Button variant="danger" onClick={confirmEndSeries} busy={pending}>
                {pending ? "Eliminando..." : "Eliminar serie desde hoy"}
              </Button>
            </>
          }
        >
          <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">
            {seriesLabel} · {scheduleLabel}
          </p>
          <p className="text-[15px] text-textSecondary">
            Se elimina de la agenda esta serie desde hoy, {formatCivilDayLabel(today)}, incluidas sus continuaciones futuras. Dejan de aparecer en el Calendario y en las clases por registrar.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[14.5px] text-textSecondary">
            <li>Sólo se elimina ESTA serie: las demás series de tu cuenta, aunque sean del mismo alumno, no cambian.</li>
            <li>Se conservan las clases ya dictadas o registradas, sus cobros, pagos y archivos adjuntos, y las clases anteriores a hoy.</li>
            <li>Las clases futuras ya creadas de esta serie que no tengan registro quedan canceladas.</li>
          </ul>
        </Dialog>
      )}

      {editingFuture && (
        <form onSubmit={(event) => submitWithoutReset(event, submitEditFuture)} className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
          <div>
            <h3 className="font-display text-card font-semibold">Dividir: «esta y las siguientes»</h3>
            <p className="mt-0.5 text-[13.5px] text-textMuted">El nuevo patrón rige desde la fecha que elijas. Lo anterior no se modifica.</p>
          </div>
          <Field label="Desde qué fecha rige el nuevo patrón" htmlFor={`effectiveDate-${ruleId}`} hint={futureDate ? `Rige desde ${formatCivilDayLabel(futureDate)}.` : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput id={`effectiveDate-${ruleId}`} name="effectiveDate" type="date" required min={today} value={futureDate} onChange={(e) => { setFutureDate(e.target.value); setReplaceConfirmed(false); }} className="min-w-0 flex-1" />
              <Button variant="secondary" onClick={() => { setFutureDate(today); setReplaceConfirmed(false); }} disabled={futureDate === today}>
                Hoy
              </Button>
            </div>
          </Field>
          <p role="status" aria-live="polite" className="text-[14px] font-[650] text-textPrimary">
            {firstNewClass ? `Primera clase con el nuevo horario: ${firstNewClass}.` : futureDate ? "Con ese patrón no hay clases en los próximos 60 días desde esa fecha." : "Elegí la fecha desde la que rige el nuevo patrón."}
          </p>
          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={setWeekCycles} />
          <p className="text-[13.5px] text-textMuted">La agenda anterior a esa fecha queda intacta — nunca se modifica el pasado.</p>
          {replaceWarning && (
            <Notice tone="warn" title="Este cambio reemplaza cambios ya programados">
              <p className="[overflow-wrap:anywhere]">{replaceWarning}</p>
              <p className="mt-1.5">Si confirmás, esos cambios futuros dejan de regir y el nuevo patrón los reemplaza desde la fecha elegida. Las clases pasadas no se tocan.</p>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={(event) => {
                    const form = (event.currentTarget as HTMLElement).closest("form");
                    if (!form) return;
                    setReplaceConfirmed(true);
                    submitEditFuture(new FormData(form), false, true);
                  }}
                >
                  Confirmar y reemplazar
                </Button>
                <Button variant="ghost" onClick={() => setReplaceWarning(null)}>
                  Cambiar la fecha
                </Button>
              </div>
            </Notice>
          )}
          {overlapWarning && (
            <Notice tone="warn" title="El nuevo horario se superpone con otra clase">
              <p className="[overflow-wrap:anywhere]">{overlapWarning}</p>
              <p className="mt-1.5">Si estás intercambiando horarios con otra serie, guardalo igual y después cambiá la otra: hasta entonces las dos clases se verán superpuestas en el Calendario.</p>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={(event) => {
                    const form = (event.currentTarget as HTMLElement).closest("form");
                    if (form) submitEditFuture(new FormData(form), true);
                  }}
                >
                  Guardar igual (queda superpuesto)
                </Button>
                <Button variant="ghost" onClick={() => setOverlapWarning(null)}>
                  Cambiar el horario
                </Button>
              </div>
            </Notice>
          )}
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
        <form onSubmit={(event) => submitWithoutReset(event, submitChangeParticipants)} className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
          <h3 className="font-display text-card font-semibold">Modificar participantes</h3>
          <Field label="Desde qué fecha rige el nuevo grupo de alumnos" htmlFor={`participantsEffectiveDate-${ruleId}`} hint={participantsDate ? `Rige desde ${formatCivilDayLabel(participantsDate)}.` : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput id={`participantsEffectiveDate-${ruleId}`} name="participantsEffectiveDate" type="date" required min={today} value={participantsDate} onChange={(e) => setParticipantsDate(e.target.value)} className="min-w-0 flex-1" />
              <Button variant="secondary" onClick={() => setParticipantsDate(today)} disabled={participantsDate === today}>
                Hoy
              </Button>
            </div>
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
