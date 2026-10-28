"use client";
import {AvailabilityPicker} from '@/components/calendar/availability-picker';

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGuardedActionState } from "@/lib/actions/use-guarded-action-state";
import { useFormStatus } from "react-dom";
import { createSingleLessonAction, createRecurrenceSeriesAction, type FormState } from "@/lib/actions/calendar";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { Field, SelectInput, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { StudentPicker } from "@/components/students/student-picker";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { WeekdayScheduleEditor, defaultWeekCycles, resizeWeekCycles, weekCyclesToWeeksJson, type WeekRows } from "@/components/calendar/weekday-schedule-editor";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import { nextPrimaryAfterToggle } from "@/lib/calendar/primary-selection";
import { shouldRotateOperationId } from "@/lib/calendar/operation-id";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { Notice } from "@/components/ui/notice";
import { CALENDAR_TIMEZONE, formatCivilDayLabel, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { generateOccurrences } from "@/lib/calendar/recurrence-engine";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { mondayOfWeekContaining } from "@/lib/calendar/weekday";
import { describeWeeklySessions, formatClock, parseSlotPreset, seriesWeeksFromSlot, weekdayIndexOfDate } from "@/lib/calendar/slot-preset";

const INITIAL_STATE: FormState = {};

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" busy={pending} disabled={pending || disabled}>
      Guardar
    </Button>
  );
}

async function dispatchAction(mode: "single" | "series", prevState: FormState, formData: FormData): Promise<FormState> {
  return mode === "single" ? createSingleLessonAction(prevState, formData) : createRecurrenceSeriesAction(prevState, formData);
}

export function NewLessonForm({
  activeStudents,
  presetFromReplacement,
  returnHref = "/calendario",
}: {
  activeStudents: StudentRecord[];
  presetFromReplacement?: { freedByLessonId?: string; date?: string; hour?: string; minute?: string; duration?: string; modality?: string };
  /** Dónde se vuelve al guardar o cancelar: la semana o el día desde el que se abrió (por omisión, el Calendario). */
  returnHref?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "series">("single");
  // Idempotencia real (20261001150000): un UUID estable por borrador, generado UNA vez acá en el
  // cliente (sessionStorage — sobrevive recarga, falla de red y respuesta perdida; una pestaña
  // duplicada hereda la copia). Se rota recién cuando el servidor confirma la operación.
  const { operationId, rotate: rotateOperationId } = useDraftOperationId("teacherflow:calendario:nueva:operacion");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primaryStudentId, setPrimaryStudentId] = useState<string>("");
  const isReplacement = !!presetFromReplacement?.freedByLessonId;
  // Horario del espacio libre que se tocó en el Calendario (día civil + hora de la grilla): rige para la clase única Y para la serie. Sin él (entrada desde «Nueva clase»), la selección manual de siempre.
  const slot = isReplacement ? null : parseSlotPreset(presetFromReplacement ?? {});
  // Qué parte se editó a mano: mientras no se toque, pasar de clase única a serie (o al revés) traslada lo elegido; después se respeta lo que escribió la profesora.
  const singleTouched = useRef(false);
  const seriesTouched = useRef(false);

  const [cycleLengthWeeks, setCycleLengthWeeks] = useState<1 | 2 | 3 | 4>(1);
  const [weekCycles, setWeekCycles] = useState<WeekRows[]>(() => defaultWeekCycles(1, slot ? seriesWeeksFromSlot(slot) : undefined));

  // Campos controlados — Next.js remonta el estado de React de este
  // formulario en cada ida y vuelta del Server Action (confirmado: el error
  // de `state` se refleja bien, pero un input no controlado o un `useState`
  // sin sincronizar vuelve a su valor inicial). `state.values` es el único
  // "eco" fiable de lo que la profesora ya había completado, así que estos
  // campos se re-sincronizan desde ahí cada vez que el servidor rechaza el
  // envío — nunca se pierde lo ya completado por un error de otro campo.
  const [modality, setModality] = useState(presetFromReplacement?.modality ?? "presencial");
  const [activityKind, setActivityKind] = useState("class");
  const [allowBlocked,setAllowBlocked]=useState(false),[allowOverlap,setAllowOverlap]=useState(false);
  const [classTitle, setClassTitle] = useState("");
  const [date, setDate] = useState(presetFromReplacement?.date ?? "");
  const [hour, setHour] = useState(presetFromReplacement?.hour ?? "18");
  const [minute, setMinute] = useState(presetFromReplacement?.minute ?? "0");
  const [durationMinutes, setDurationMinutes] = useState(presetFromReplacement?.duration ?? "60");
  const [startDate, setStartDate] = useState(() => slot?.date ?? "");
  const [endDate, setEndDate] = useState("");

  function seedSeriesFrom(from: { date: string; hour: number; minute: number; durationMinutes: number }) {
    setStartDate(from.date);
    setCycleLengthWeeks(1);
    setWeekCycles(defaultWeekCycles(1, seriesWeeksFromSlot(from)));
  }

  /** Cambiar de clase única a serie (y volver) conserva lo elegido: el día y la hora viajan de un modo al otro mientras el destino no se haya editado a mano. */
  function switchMode(next: "single" | "series") {
    if (next === mode) return;
    if (next === "series" && !seriesTouched.current) {
      const current = parseSlotPreset({ date, hour, minute, duration: durationMinutes });
      if (current) seedSeriesFrom(current);
    }
    if (next === "single" && !singleTouched.current && seriesTouched.current && startDate) {
      setDate(startDate);
      const firstRows = weekCycles[0] ?? [];
      const sameWeekday = firstRows[weekdayIndexOfDate(startDate)];
      const row = sameWeekday?.enabled ? sameWeekday : firstRows.find((r) => r.enabled);
      if (row?.enabled) {
        setHour(String(row.hour));
        setMinute(String(row.minute));
        setDurationMinutes(String(row.durationMinutes));
      }
    }
    setMode(next);
  }

  /** «Volver a lo elegido»: deja el día y la hora del espacio tocado en el Calendario, en ambos modos. */
  function restoreSlot() {
    if (!slot) return;
    singleTouched.current = false;
    seriesTouched.current = false;
    setDate(slot.date);
    setHour(String(slot.hour));
    setMinute(String(slot.minute));
    setDurationMinutes(String(slot.durationMinutes));
    seedSeriesFrom(slot);
  }

  function handleCycleLengthChange(weeks: 1 | 2 | 3 | 4) {
    seriesTouched.current = true;
    setCycleLengthWeeks(weeks);
    setWeekCycles((prev) => resizeWeekCycles(prev, weeks));
  }

  const boundAction = (prevState: FormState, formData: FormData) => dispatchAction(mode, prevState, formData);
  const [state, formAction] = useGuardedActionState(boundAction, INITIAL_STATE);

  // Re-sincroniza los campos controlados desde `state.values` cuando el
  // servidor rechaza el envío. Tiene que ser un efecto (nunca un ajuste
  // durante el render): confirmado que React 19 ejecuta un reset nativo del
  // `<form>` DESPUÉS de cada ida y vuelta de un Server Action — si se
  // reescriben los campos síncronamente durante el render, ese reset
  // nativo posterior los pisa igual. Un efecto corre después del commit,
  // así que gana la carrera contra el reset nativo del navegador.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const values = state.values;
    if (!values) return;
    setSelected(new Set(values.participantIds));
    if (values.mode) setMode(values.mode);
    if (values.mode === "single") singleTouched.current = true;
    if (values.mode === "series") seriesTouched.current = true;
    setPrimaryStudentId(values.primaryStudentId || "");
    setModality(values.modality || (presetFromReplacement?.modality ?? "presencial"));
    setActivityKind(values.activityKind || "class");
    setClassTitle(values.classTitle);
    if (values.date) setDate(values.date);
    if (values.hour) setHour(values.hour);
    if (values.minute) setMinute(values.minute);
    if (values.durationMinutes) setDurationMinutes(values.durationMinutes);
    if (values.startDate) setStartDate(values.startDate);
    setEndDate(values.endDate);
    if (values.weeksJson) {
      try {
        const weeks = JSON.parse(values.weeksJson) as RecurrenceWeek[];
        if (Array.isArray(weeks) && weeks.length > 0) {
          const nextCycle = weeks.length as 1 | 2 | 3 | 4;
          setCycleLengthWeeks(nextCycle);
          setWeekCycles(defaultWeekCycles(nextCycle, weeks));
        }
      } catch {
        // JSON inválido ya se hubiera rechazado del lado del servidor antes de llegar acá.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Confirmación canónica del servidor (clase o serie ya existe con ESTA clave): rota la clave
  // para el próximo borrador y, si no quedó ningún aviso, vuelve al calendario. El servidor ya
  // no usa redirect() acá: navegar antes de rotar dejaría la clave vieja en sessionStorage y el
  // próximo borrador "recrearía" la clase anterior en vez de crear una nueva.
  useEffect(() => {
    if (!shouldRotateOperationId(state.createdOperationId, operationId)) return;
    rotateOperationId();
    if (!state.error) router.push(returnHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, operationId]);

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPrimaryStudentId(nextPrimaryAfterToggle(prev.size, Array.from(next), primaryStudentId));
      return next;
    });
  }

  const weeksJson = weekCyclesToWeeksJson(weekCycles);
  const currentSingle = parseSlotPreset({ date, hour, minute, duration: durationMinutes });
  const currentWeeks = useMemo(() => JSON.parse(weekCyclesToWeeksJson(weekCycles)) as RecurrenceWeek[], [weekCycles]);
  const describedWeeks = describeWeeklySessions(currentWeeks);
  // Vista previa: la PRIMERA clase real que generaría el motor con lo cargado (misma regla y misma zona horaria que usa el servidor al guardar).
  const firstClassLabel = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || currentWeeks.every((week) => week.sessions.length === 0)) return null;
    try {
      const rangeStart = new Date(localDateTimeToInstantIso({ date: startDate, hour: 0, minute: 0, timeZone: CALENDAR_TIMEZONE }));
      const [first] = generateOccurrences(
        { recurrenceId: "vista-previa", studentId: null, participantIds: [], cycleLengthWeeks: currentWeeks.length, weeks: currentWeeks, modality: "online", timezone: CALENDAR_TIMEZONE, startDate: mondayOfWeekContaining(startDate), endDate: null, status: "active", classTitle: null, activityKind: "class" },
        rangeStart,
        new Date(rangeStart.getTime() + 60 * 86_400_000)
      );
      return first ? `${formatCivilDayLabel(instantDateKey(first.start))}, ${instantTimeLabel(first.start)}` : null;
    } catch {
      return null;
    }
  }, [startDate, currentWeeks]);
  const scheduleSummary =
    mode === "single"
      ? currentSingle ? `${formatCivilDayLabel(currentSingle.date)} · ${formatClock(currentSingle.hour, currentSingle.minute)}` : "Completá la fecha y la hora."
      : startDate && describedWeeks
        ? `${cycleLengthWeeks > 1 ? `Ciclo de ${cycleLengthWeeks} semanas, ` : "Se repite "}${describedWeeks}, desde el ${formatCivilDayLabel(startDate)}.`
        : "Completá la fecha de inicio y al menos un día.";
  const matchesSlot = !slot
    || (mode === "single"
      ? date === slot.date && Number(hour) === slot.hour && Number(minute) === slot.minute && Number(durationMinutes) === slot.durationMinutes
      : startDate === slot.date && cycleLengthWeeks === 1 && describedWeeks === describeWeeklySessions(seriesWeeksFromSlot(slot)) && currentWeeks[0]?.sessions.length === 1 && currentWeeks[0].sessions[0].durationMinutes === slot.durationMinutes);
  const pickableStudents = useMemo(() => activeStudents.map((student) => ({ id: student.id, name: student.name, status: student.status, level: student.levels.join(" · ") })), [activeStudents]);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de nueva clase">
      <input type="hidden" name="operationId" value={operationId ?? ""} />
      <input type="hidden" name="allowBlocked" value={String(allowBlocked)} /><input type="hidden" name="allowOverlap" value={String(allowOverlap)} />
      {!isReplacement && (
        <div className="flex gap-1 rounded-md border-[1.5px] border-border bg-paperDeep p-1">
          {(
            [
              ["single", "Clase única"],
              ["series", "Serie semanal"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => switchMode(value)}
              aria-pressed={mode === value}
              className={`min-h-11 flex-1 rounded-sm px-3 text-[14.5px] font-[650] transition-colors ${mode === value ? "bg-surface text-textPrimary shadow-subtle" : "text-textSecondary hover:text-textPrimary"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <fieldset className="min-w-0 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-6">
        <legend className="px-2 text-label font-bold uppercase text-textMuted">Alumnos (sólo activos) *</legend>
        {/* Buscador con lupa (como la app anterior): filtra la lista sin perder a los elegidos, que viajan en el formulario como campos ocultos. */}
        <StudentPicker students={pickableStudents} selectedIds={selected} onToggle={toggleStudent} hiddenInputName="participantIds" />
        {selected.size > 0 && <p className="mt-2 text-[13.5px] text-textMuted">{selected.size === 1 ? "1 alumno elegido." : `${selected.size} alumnos elegidos.`}</p>}

        {selected.size >= 2 && (
          <fieldset className="mt-4 min-w-0">
            <legend className="text-sm font-[650] text-textSecondary">Alumno principal *</legend>
            <div className={`${choiceGroupClass} mt-2`}>
              {activeStudents
                .filter((student) => selected.has(student.id))
                .map((student) => (
                  <label key={student.id} className={choiceRowClass}>
                    <input
                      type="radio"
                      name="primaryStudentIdChoice"
                      value={student.id}
                      checked={primaryStudentId === student.id}
                      onChange={() => setPrimaryStudentId(student.id)}
                      className={checkClass}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{student.name}</span>
                  </label>
                ))}
            </div>
            {!primaryStudentId && <p className="mt-1.5 text-[13px] font-semibold text-bad">Elegí quién es el alumno principal.</p>}
          </fieldset>
        )}
      </fieldset>
      <input type="hidden" name="primaryStudentId" value={primaryStudentId} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Modalidad" htmlFor="modality">
          <SelectInput id="modality" name="modality" value={modality} onChange={(e) => setModality(e.target.value)}>
            {Object.entries(MODALITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Tipo de actividad" htmlFor="activityKind">
          <SelectInput id="activityKind" name="activityKind" value={activityKind} onChange={(e) => setActivityKind(e.target.value)}>
            {Object.entries(ACTIVITY_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <Field label="Título (opcional)" htmlFor="classTitle">
        <TextInput id="classTitle" name="classTitle" type="text" placeholder="Ej: Clase de conversación" value={classTitle} onChange={(e) => setClassTitle(e.target.value)} />
      </Field>

      {slot && (
        <Notice tone="info" title="Horario elegido en el Calendario">
          <p className="[overflow-wrap:anywhere]">{scheduleSummary}</p>
          {mode === "series" && firstClassLabel && <p role="status" className="mt-1 font-[650] [overflow-wrap:anywhere]">Primera clase: {firstClassLabel}.</p>}
          <p className="mt-1 text-[13.5px]">Ya está cargado abajo; podés cambiarlo en los campos de {mode === "single" ? "fecha y hora" : "fecha de inicio y días"}.</p>
          {!matchesSlot && (
            <div className="mt-2.5">
              <Button variant="secondary" onClick={restoreSlot}>
                Volver a lo elegido
              </Button>
            </div>
          )}
        </Notice>
      )}

      {!slot && mode === "series" && firstClassLabel && <p role="status" className="text-[14.5px] font-[650] text-textPrimary [overflow-wrap:anywhere]">Primera clase: {firstClassLabel}.</p>}

      {mode === "single" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <AvailabilityPicker date={date} time={`${hour.padStart(2,'0')}:${minute.padStart(2,'0')}`} duration={Number(durationMinutes)||60} onDurationChange={value=>setDurationMinutes(String(value))} onSelect={(date,time)=>{setDate(date);setHour(String(Number(time.slice(0,2))));setMinute(String(Number(time.slice(3,5))));}} />
          <Field label="Fecha *" htmlFor="date">
            <TextInput id="date" name="date" type="date" required value={date} onChange={(e) => { singleTouched.current = true; setDate(e.target.value); }} />
          </Field>
          <Field label="Hora *" htmlFor="hour-single">
            <div className="flex gap-2">
              <TextInput id="hour-single" aria-label="Hora" name="hour" type="number" min="0" max="23" required value={hour} onChange={(e) => { singleTouched.current = true; setHour(e.target.value); }} />
              <TextInput name="minute" type="number" aria-label="Minutos" min="0" max="59" required value={minute} onChange={(e) => { singleTouched.current = true; setMinute(e.target.value); }} />
            </div>
          </Field>
          <Field label="Duración (min) *" htmlFor="durationMinutes">
            <TextInput id="durationMinutes" name="durationMinutes" type="number" min="1" required value={durationMinutes} onChange={(e) => { singleTouched.current = true; setDurationMinutes(e.target.value); }} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Fecha de inicio *" htmlFor="startDate">
              <TextInput id="startDate" name="startDate" type="date" required value={startDate} onChange={(e) => { seriesTouched.current = true; setStartDate(e.target.value); }} />
            </Field>
            <AvailabilityPicker date={startDate} time={`${hour.padStart(2,'0')}:${minute.padStart(2,'0')}`} duration={Number(durationMinutes)||60} onDurationChange={value=>setDurationMinutes(String(value))} onSelect={(date,time)=>seedSeriesFrom({date,hour:Number(time.slice(0,2)),minute:Number(time.slice(3,5)),durationMinutes:Number(durationMinutes)||60})} />
            <Field label="Fecha de fin (opcional)" htmlFor="endDate">
              <TextInput id="endDate" name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={(next) => { seriesTouched.current = true; setWeekCycles(next); }} />
          <input type="hidden" name="weeksJson" value={weeksJson} />
        </>
      )}

      {isReplacement && <input type="hidden" name="freedByLessonId" value={presetFromReplacement?.freedByLessonId} />}

      {state.error && <FormErrorBox message={state.error} />}
      {(state.error?.includes('bloqueado')||allowBlocked)&&<label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={allowBlocked} onChange={e=>setAllowBlocked(e.target.checked)} className="h-5 w-5" required />Agendar igualmente sobre este bloqueo de disponibilidad</label>}
      {(state.error?.includes('superpone')||allowOverlap)&&<label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={allowOverlap} onChange={e=>setAllowOverlap(e.target.checked)} className="h-5 w-5" required />Confirmo que quiero superponer estas clases</label>}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SubmitButton disabled={selected.size === 0 || !primaryStudentId || !operationId} />
        <PrivateButtonLink href={returnHref} variant="ghost">
          Cancelar
        </PrivateButtonLink>
      </div>
    </form>
  );
}
