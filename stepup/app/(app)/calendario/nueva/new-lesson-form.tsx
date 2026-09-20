"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createSingleLessonAction, createRecurrenceSeriesAction, type FormState } from "@/lib/actions/calendar";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { WeekdayScheduleEditor, defaultWeekCycles, resizeWeekCycles, weekCyclesToWeeksJson, type WeekRows } from "@/components/calendar/weekday-schedule-editor";

const INITIAL_STATE: FormState = {};

const inputClassName =
  "rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue";
const labelClassName = "text-sm font-medium text-textSecondary";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex items-center justify-center gap-2 rounded-md bg-brandBlue px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
    >
      {pending && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      Guardar
    </button>
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
  const [mode, setMode] = useState<"single" | "series">("single");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isReplacement = !!presetFromReplacement?.freedByLessonId;

  const [cycleLengthWeeks, setCycleLengthWeeks] = useState<1 | 2 | 3 | 4>(1);
  const [weekCycles, setWeekCycles] = useState<WeekRows[]>(defaultWeekCycles(1));

  function handleCycleLengthChange(weeks: 1 | 2 | 3 | 4) {
    setCycleLengthWeeks(weeks);
    setWeekCycles((prev) => resizeWeekCycles(prev, weeks));
  }

  const boundAction = (prevState: FormState, formData: FormData) => dispatchAction(mode, prevState, formData);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const weeksJson = weekCyclesToWeeksJson(weekCycles);

  return (
    <form action={formAction} className="flex flex-col gap-5" aria-label="Formulario de nueva clase">
      {!isReplacement && (
        <div className="flex rounded-pill border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`flex-1 rounded-pill px-3 py-1.5 text-sm font-semibold transition-colors ${mode === "single" ? "bg-brandBlue text-white" : "text-textSecondary"}`}
          >
            Clase única
          </button>
          <button
            type="button"
            onClick={() => setMode("series")}
            className={`flex-1 rounded-pill px-3 py-1.5 text-sm font-semibold transition-colors ${mode === "series" ? "bg-brandBlue text-white" : "text-textSecondary"}`}
          >
            Serie semanal
          </button>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClassName}>Alumnos (sólo activos) *</legend>
        <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
          {activeStudents.length === 0 && <p className="text-xs text-textMuted">No hay alumnos activos todavía.</p>}
          {activeStudents.map((student) => (
            <label key={student.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background">
              <input
                type="checkbox"
                name="participantIds"
                value={student.id}
                checked={selected.has(student.id)}
                onChange={() => toggleStudent(student.id)}
                className="h-4 w-4 rounded border-border text-brandBlue focus:ring-brandBlue"
              />
              {student.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="modality" className={labelClassName}>
            Modalidad
          </label>
          <select id="modality" name="modality" defaultValue={presetFromReplacement?.modality ?? "presencial"} className={inputClassName}>
            {Object.entries(MODALITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activityKind" className={labelClassName}>
            Tipo de actividad
          </label>
          <select id="activityKind" name="activityKind" defaultValue="class" className={inputClassName}>
            {Object.entries(ACTIVITY_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="classTitle" className={labelClassName}>
          Título (opcional)
        </label>
        <input id="classTitle" name="classTitle" type="text" placeholder="Ej: Clase de conversación" className={inputClassName} />
      </div>

      {mode === "single" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="date" className={labelClassName}>
              Fecha *
            </label>
            <input id="date" name="date" type="date" required defaultValue={presetFromReplacement?.date} className={inputClassName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hour-single" className={labelClassName}>
              Hora *
            </label>
            <div className="flex gap-1.5">
              <input
                id="hour-single"
                name="hour"
                type="number"
                min="0"
                max="23"
                required
                defaultValue={presetFromReplacement?.hour ?? "18"}
                className={inputClassName}
              />
              <input name="minute" type="number" min="0" max="59" required defaultValue={presetFromReplacement?.minute ?? "0"} className={inputClassName} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="durationMinutes" className={labelClassName}>
              Duración (min) *
            </label>
            <input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min="1"
              required
              defaultValue={presetFromReplacement?.duration ?? "60"}
              className={inputClassName}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="startDate" className={labelClassName}>
                Fecha de inicio *
              </label>
              <input id="startDate" name="startDate" type="date" required className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="endDate" className={labelClassName}>
                Fecha de fin (opcional)
              </label>
              <input id="endDate" name="endDate" type="date" className={inputClassName} />
            </div>
          </div>

          <WeekdayScheduleEditor cycleLengthWeeks={cycleLengthWeeks} onCycleLengthChange={handleCycleLengthChange} weekCycles={weekCycles} onChange={setWeekCycles} />
          <input type="hidden" name="weeksJson" value={weeksJson} />
        </>
      )}

      {isReplacement && <input type="hidden" name="freedByLessonId" value={presetFromReplacement?.freedByLessonId} />}

      {state.error && <FormErrorBox message={state.error} />}
      <SubmitButton />
    </form>
  );
}
