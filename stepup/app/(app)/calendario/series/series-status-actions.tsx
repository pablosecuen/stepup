"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecurrenceStatusAction, editFutureRecurrenceAction, changeParticipantsAction, endSeriesFromTodayAction, type FormState } from "@/lib/actions/calendar";
import { Dialog } from "@/components/ui/dialog";
import { SeriesSwapPanel, type SwapOption } from "@/components/calendar/series-swap-panel";
import { ChangeSchedulePanel } from "@/components/calendar/change-schedule-panel";
import { SeriesActionsMenu, type SeriesMenuGroup } from "@/components/calendar/series-actions-menu";
import { TrainingBillingConfigButton } from "@/components/payments/training-billing-config";
import { upcomingSeriesOccurrencesAction, type UpcomingSeriesOccurrence } from "@/lib/actions/schedule-change";
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
  training = null,
}: {
  /** Nombre y horario de LA serie (para decir en la confirmación exactamente qué se quita). */
  seriesLabel: string;
  scheduleLabel: string;
  swapOptions?: SwapOption[];
  /** Sólo un entrenamiento: su acuerdo de cobro (la cuota se configura o edita desde «Acciones»). */
  training?: { agreementId: string | null } | null;
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
  // «Cambiar horario»: mover una clase (o esta y las siguientes) a cualquier horario libre, sin necesidad de otra serie.
  const [changeOpen, setChangeOpen] = useState(false);
  const [upcoming, setUpcoming] = useState<UpcomingSeriesOccurrence[] | null>(null);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [changeIndex, setChangeIndex] = useState(0);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
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
      closeAll();
      router.refresh();
    });
  }

  /** Cierra cualquier formulario sin guardar, lo deja como estaba y devuelve el foco al control «Acciones» (la opción que lo abrió ya no existe). La lista no se mueve: nada crece dentro de la tarjeta. */
  function closeAll() {
    setChangeOpen(false);
    setSwapOpen(false);
    setEditingFuture(false);
    setEditingParticipants(false);
    setConfirmingEnd(false);
    setBillingOpen(false);
    setOverlapWarning(null);
    setReplaceWarning(null);
    setReplaceConfirmed(false);
    setCycleLengthWeeks(initialCycle);
    setWeekCycles(defaultWeekCycles(initialCycle, weeks));
    setSelectedParticipantIds(new Set(participantIds));
    setSelectedPrimaryId(primaryStudentId ?? "");
    setFutureDate(today);
    setParticipantsDate(today);
    window.requestAnimationFrame(() => actionsButtonRef.current?.focus({ preventScroll: true }));
  }

  function openChange() {
    setChangeOpen(true);
    setUpcoming(null);
    setUpcomingError(null);
    setChangeIndex(0);
    void guardNetwork(() => upcomingSeriesOccurrencesAction(ruleId)).then((result) => {
      if (result.error) setUpcomingError(result.error);
      else setUpcoming(result.items ?? []);
    });
  }

  function submitEditFuture(formData: FormData, confirmReplace = replaceConfirmed) {
    setError(null);
    setOverlapWarning(null);
    setReplaceWarning(null);
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
      closeAll();
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
      closeAll();
      router.refresh();
    });
  }

  const eligibleStudents = students.filter((s) => s.status !== "archivado" || selectedParticipantIds.has(s.id));
  const pickableStudents = eligibleStudents.map((student) => ({ id: student.id, name: student.name, status: student.status, level: student.levels.join(" · ") }));

  const menuGroups: SeriesMenuGroup[] = [
    {
      key: "programacion",
      heading: "Programación",
      items: [
        ...(status !== "ended" ? [{ key: "change", label: "Cambiar horario", onSelect: openChange }] : []),
        ...(status === "active" && swapOptions.length >= 2 && swapOptions.some((option) => option.id === ruleId) ? [{ key: "swap", label: "Intercambiar horarios", onSelect: () => setSwapOpen(true) }] : []),
      ],
    },
    {
      key: "miembros",
      heading: "Miembros y configuración",
      items: [
        ...(status !== "ended" ? [{ key: "members", label: "Administrar miembros", onSelect: () => setEditingParticipants(true) }] : []),
        ...(status !== "ended" ? [{ key: "future", label: "Editar futuras", onSelect: () => setEditingFuture(true) }] : []),
        ...(training ? [{ key: "billing", label: training.agreementId ? "Editar cuota" : "Configurar cuota", onSelect: () => setBillingOpen(true) }] : []),
      ],
    },
    {
      key: "estado",
      heading: "Estado",
      items: [
        ...(status === "active" ? [{ key: "pause", label: "Pausar", onSelect: () => { actionsButtonRef.current?.focus({ preventScroll: true }); applyStatus("paused"); }, disabled: pending }] : []),
        ...(status === "paused" ? [{ key: "resume", label: "Reanudar", onSelect: () => { actionsButtonRef.current?.focus({ preventScroll: true }); applyStatus("active"); }, disabled: pending }] : []),
      ],
    },
    {
      key: "peligro",
      heading: null,
      items: status !== "ended" ? [{ key: "delete", label: "Eliminar serie", destructive: true, onSelect: () => setConfirmingEnd(true) }] : [],
    },
  ];
  const dialogTitle = (action: string) => `${action} · ${seriesLabel}`;
  const hasMenu = menuGroups.some((group) => group.items.length > 0);

  return (
    <div className="shrink-0">
      {hasMenu && <SeriesActionsMenu seriesLabel={seriesLabel} groups={menuGroups} buttonRef={actionsButtonRef} />}

      {error && (
        <div className="mt-2 max-w-[260px]">
          <FormErrorBox message={error} />
        </div>
      )}

      {changeOpen && (
        <Dialog title={dialogTitle("Cambiar horario")} size="lg" onClose={closeAll}>

            <div>
              <p className="mt-0.5 text-[13.5px] text-textMuted">Mové una clase (o esta y las siguientes) a un horario libre. No hace falta otra serie: el intercambio con otra serie está aparte, en «Intercambiar horarios».</p>
            </div>
            {upcomingError && <FormErrorBox message={upcomingError} />}
            {!upcoming && !upcomingError && <p role="status">Buscando las próximas clases…</p>}
            {upcoming && upcoming.length === 0 && <Notice tone="info">Esta serie no tiene clases próximas para cambiar.</Notice>}
            {upcoming && upcoming.length > 0 && (
              <>
                <Field label="Clase que querés cambiar" htmlFor={`change-occurrence-${ruleId}`}>
                  <select id={`change-occurrence-${ruleId}`} value={changeIndex} onChange={(event) => setChangeIndex(Number(event.target.value))} className="min-h-11 w-full rounded-md border-[1.5px] border-borderStrong bg-surface px-3 text-[15px]">
                    {upcoming.map((item, index) => (
                      <option key={item.id} value={index}>{`${formatCivilDayLabelShort(instantDateKey(item.start))} · ${instantTimeLabel(item.start)}–${instantTimeLabel(item.end)}`}</option>
                    ))}
                  </select>
                </Field>
                <ChangeSchedulePanel key={upcoming[changeIndex].id} occurrence={upcoming[changeIndex]} initialScope="series" onCancel={closeAll} onDone={() => { closeAll(); router.refresh(); }} />
              </>
            )}

        </Dialog>
      )}

      {swapOpen && (
        <Dialog title={dialogTitle("Intercambiar horarios")} size="lg" onClose={closeAll}>
          <SeriesSwapPanel options={swapOptions} fixedId={ruleId} onClose={closeAll} />
        </Dialog>
      )}

      {confirmingEnd && (
        <Dialog
          title="Eliminar serie"
          onClose={() => closeAll()}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" onClick={() => closeAll()} disabled={pending}>
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
        <Dialog title={dialogTitle("Editar futuras")} size="lg" onClose={closeAll}>
          <form onSubmit={(event) => submitWithoutReset(event, submitEditFuture)} className="flex flex-col gap-4">
            <p className="text-[13.5px] text-textMuted">Dividir: «esta y las siguientes». El nuevo patrón rige desde la fecha que elijas. Lo anterior no se modifica.</p>
            <Field label="Desde qué fecha rige el nuevo patrón" htmlFor={`effectiveDate-${ruleId}`} hint={futureDate ? `Rige desde ${formatCivilDayLabel(futureDate)}.` : undefined}>
              <div data-series-effective-date className="grid w-full max-w-[300px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <TextInput id={`effectiveDate-${ruleId}`} name="effectiveDate" type="date" required min={today} value={futureDate} onChange={(e) => { setFutureDate(e.target.value); setReplaceConfirmed(false); }} className="min-w-0" />
                <Button variant="secondary" className="min-h-[46px] shrink-0 px-3" onClick={() => { setFutureDate(today); setReplaceConfirmed(false); }} disabled={futureDate === today}>
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
                      submitEditFuture(new FormData(form), true);
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
              <Notice tone="warn" title="El nuevo horario se superpone con otra clase o está bloqueado">
                <p className="[overflow-wrap:anywhere]">{overlapWarning}</p>
                <p className="mt-1.5">No se puede dejar dos clases superpuestas: elegí otro horario libre. Si querés intercambiar horarios con otra serie, usá «Intercambiar horarios», que cambia las dos a la vez.</p>
                <div className="mt-2.5">
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
              <Button variant="ghost" onClick={closeAll}>
                Volver
              </Button>
            </div>
          </form>

        </Dialog>
      )}

      {editingParticipants && (
        <Dialog title={dialogTitle("Administrar miembros")} size="lg" onClose={closeAll}>
          <form onSubmit={(event) => submitWithoutReset(event, submitChangeParticipants)} className="flex flex-col gap-4">
            <Field label="Desde qué fecha rige el nuevo grupo de alumnos" htmlFor={`participantsEffectiveDate-${ruleId}`} hint={participantsDate ? `Rige desde ${formatCivilDayLabel(participantsDate)}.` : undefined}>
              <div data-series-effective-date className="grid w-full max-w-[300px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <TextInput id={`participantsEffectiveDate-${ruleId}`} name="participantsEffectiveDate" type="date" required min={today} value={participantsDate} onChange={(e) => setParticipantsDate(e.target.value)} className="min-w-0" />
                <Button variant="secondary" className="min-h-[46px] shrink-0 px-3" onClick={() => setParticipantsDate(today)} disabled={participantsDate === today}>
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
              <Button variant="ghost" onClick={closeAll}>
                Volver
              </Button>
            </div>
          </form>

        </Dialog>
      )}

      {training && (
        <TrainingBillingConfigButton recurrenceRuleId={ruleId} agreementId={training.agreementId} seriesLabel={seriesLabel} open={billingOpen} onOpenChange={(next) => { if (next) setBillingOpen(true); else closeAll(); }} />
      )}
    </div>
  );
}
