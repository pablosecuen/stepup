"use client";

import { useEffect, useMemo, useState } from "react";
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
}: {
  activeStudents: StudentRecord[];
  presetFromReplacement?: { freedByLessonId?: string; date?: string; hour?: string; minute?: string; duration?: string; modality?: string };
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

  const [cycleLengthWeeks, setCycleLengthWeeks] = useState<1 | 2 | 3 | 4>(1);
  const [weekCycles, setWeekCycles] = useState<WeekRows[]>(defaultWeekCycles(1));

  // Campos controlados — Next.js remonta el estado de React de este
  // formulario en cada ida y vuelta del Server Action (confirmado: el error
  // de `state` se refleja bien, pero un input no controlado o un `useState`
  // sin sincronizar vuelve a su valor inicial). `state.values` es el único
  // "eco" fiable de lo que la profesora ya había completado, así que estos
  // campos se re-sincronizan desde ahí cada vez que el servidor rechaza el
  // envío — nunca se pierde lo ya completado por un error de otro campo.
  const [modality, setModality] = useState(presetFromReplacement?.modality ?? "presencial");
  const [activityKind, setActivityKind] = useState("class");
  const [classTitle, setClassTitle] = useState("");
  const [date, setDate] = useState(presetFromReplacement?.date ?? "");
  const [hour, setHour] = useState(presetFromReplacement?.hour ?? "18");
  const [minute, setMinute] = useState(presetFromReplacement?.minute ?? "0");
  const [durationMinutes, setDurationMinutes] = useState(presetFromReplacement?.duration ?? "60");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function handleCycleLengthChange(weeks: 1 | 2 | 3 | 4) {
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
    if (!state.error) router.push("/calendario");
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
  const pickableStudents = useMemo(() => activeStudents.map((student) => ({ id: student.id, name: student.name, status: student.status, level: student.levels.join(" · ") })), [activeStudents]);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de nueva clase">
      <input type="hidden" name="operationId" value={operationId ?? ""} />
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
              onClick={() => setMode(value)}
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

      {mode === "single" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field label="Fecha *" htmlFor="date">
            <TextInput id="date" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hora *" htmlFor="hour-single">
            <div className="flex gap-2">
              <TextInput id="hour-single" aria-label="Hora" name="hour" type="number" min="0" max="23" required value={hour} onChange={(e) => setHour(e.target.value)} />
              <TextInput name="minute" type="number" aria-label="Minutos" min="0" max="59" required value={minute} onChange={(e) => setMinute(e.target.value)} />
            </div>
          </Field>
          <Field label="Duración (min) *" htmlFor="durationMinutes">
            <TextInput id="durationMinutes" name="durationMinutes" type="number" min="1" required value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Fecha de inicio *" htmlFor="startDate">
              <TextInput id="startDate" name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Fecha de fin (opcional)" htmlFor="endDate">
              <TextInput id="endDate" name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={setWeekCycles} />
          <input type="hidden" name="weeksJson" value={weeksJson} />
        </>
      )}

      {isReplacement && <input type="hidden" name="freedByLessonId" value={presetFromReplacement?.freedByLessonId} />}

      {state.error && <FormErrorBox message={state.error} />}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SubmitButton disabled={selected.size === 0 || !primaryStudentId || !operationId} />
        <PrivateButtonLink href="/calendario" variant="ghost">
          Cancelar
        </PrivateButtonLink>
      </div>
    </form>
  );
}
