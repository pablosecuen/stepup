"use client";

import { useId, useState, type CSSProperties } from "react";
import { CheckIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { EditableTextList } from "./editable-text-list";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput, checkClass } from "@/components/ui/field";
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from "@/lib/lessons/attendance";
import { homeworkReviewSelectionKey, type HomeworkReviewOutcome, type PendingHomeworkTask } from "@/lib/lessons/homework";
import { normalizeSkillGradeValue } from "@/lib/lessons/grades";
import { isStudentHomeworkPersonalized } from "@/lib/lessons/registration-form";
import { SKILLS, SKILL_LABEL, type Skill } from "@/lib/lessons/skills";
import { formatCivilDate, formatInstantDate } from "@/lib/format/date-format";
import { HomeworkDateChoices } from "./homework-schedule";

/**
 * Piezas del formulario de registro de una clase que comparten la clase individual y cada participante de un grupo — mismos campos, mismos
 * rótulos y mismo orden que la app anterior (`EvaluationSection`, `ParticipantRegistrationBlock`, `PendingHomeworkCard`, `HomeworkSection`).
 */

export interface ParticipantForm {
  attendanceStatus: AttendanceStatus | null;
  lateMinutes: string;
  generalGrade: string;
  skillGrades: Record<string, number>;
  individualObservation: string;
  strengths: string[];
  areasToImprove: string[];
  homeworkDescription: string;
  homeworkDueDate: string;
  homeworkReviews: Record<string, HomeworkReviewOutcome>;
}

export const HOMEWORK_OUTCOME_LABEL: Record<HomeworkReviewOutcome, string> = {
  realizada: "Realizada",
  parcial: "Realizada parcialmente",
  no_realizada: "No realizada",
  ya_no_corresponde: "Ya no corresponde",
};

/** Clave del borrador de «agregar» de una lista de un participante (la usa el guardado para incorporar lo pendiente). */
export function participantDraftKey(studentId: string, list: "strengths" | "areasToImprove"): string {
  return `participante:${studentId}:${list}`;
}

export const ATTENDANCE_BUTTONS: AttendanceStatus[] = ["presente", "tarde", "ausente_aviso", "ausente"];

/** Botón de opción en forma de píldora (asistencia y revisión de tareas): el elegido lleva tinta y tilde, nunca sólo color. */
export function ChoicePill({ selected, onClick, children, compact = false }: { selected: boolean; onClick: () => void; children: React.ReactNode; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] ${compact ? "px-3.5 text-[14px]" : "px-4 text-[14.5px]"} font-[650] transition-colors duration-150 ${
        selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
      }`}
    >
      {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  );
}

/** Asistencia de un participante de un grupo: Presente / Tarde / Ausente con aviso / Ausente (+ minutos si llegó tarde). */
export function AttendanceChoice({ studentName, status, lateMinutes, onChange, onLateMinutesChange, showMissingError }: { studentName: string; status: AttendanceStatus | null; lateMinutes: string; onChange: (status: AttendanceStatus) => void; onLateMinutesChange: (value: string) => void; showMissingError: boolean }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-[14px] font-bold text-textPrimary">Asistencia</legend>
      <div className="flex flex-wrap gap-2">
        {ATTENDANCE_BUTTONS.map((option) => (
          <ChoicePill key={option} selected={status === option} onClick={() => onChange(option)}>
            <span className="sr-only">{studentName}: </span>
            {ATTENDANCE_STATUS_LABEL[option]}
          </ChoicePill>
        ))}
      </div>
      {status === "tarde" && (
        <div className="sm:w-56">
          <TextInput type="number" min="0" aria-label="Minutos de tardanza" placeholder="Minutos de tardanza" value={lateMinutes} onChange={(e) => onLateMinutesChange(e.target.value)} />
        </div>
      )}
      {showMissingError && (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          Falta indicar asistencia de {studentName}
        </p>
      )}
    </fieldset>
  );
}

/** «Tarea pendiente»: una tarjeta por tarea de una clase anterior; hay que elegir qué pasó con cada una (nunca viene elegida). */
export function PendingHomeworkReview({ tasks, studentId, studentName, reviews, onSelect, showMissingError }: { tasks: PendingHomeworkTask[]; studentId: string; studentName: string; reviews: Record<string, HomeworkReviewOutcome>; onSelect: (taskId: string, outcome: HomeworkReviewOutcome) => void; showMissingError: boolean }) {
  if (tasks.length === 0) return null;
  const unanswered = tasks.some((task) => !reviews[homeworkReviewSelectionKey(task.taskId, studentId)]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {tasks.map((task) => (
        <fieldset key={task.taskId} className="flex min-w-0 flex-col gap-2.5 rounded-md border-[1.5px] border-warnLine bg-warnSoft p-3.5">
          <legend className="px-1 text-[14px] font-bold text-textPrimary">Tarea pendiente</legend>
          <span className="text-[15px] text-textPrimary [overflow-wrap:anywhere]">{task.description}</span>
          {task.dueDate && <span className="text-[13px] text-textMuted">Fecha de entrega: {formatCivilDate(task.dueDate)}</span>}
          <span className="text-[13px] text-textMuted">Asignada el {formatInstantDate(task.assignedAt)}</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(HOMEWORK_OUTCOME_LABEL) as HomeworkReviewOutcome[]).map((outcome) => (
              <ChoicePill key={outcome} compact selected={reviews[homeworkReviewSelectionKey(task.taskId, studentId)] === outcome} onClick={() => onSelect(task.taskId, outcome)}>
                {HOMEWORK_OUTCOME_LABEL[outcome]}
              </ChoicePill>
            ))}
          </div>
        </fieldset>
      ))}
      {showMissingError && unanswered && (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          Falta elegir qué pasó con la tarea de {studentName}
        </p>
      )}
    </div>
  );
}

// Control numérico por área — 0 (o vacío) significa «sin calificar» y NUNCA se persiste como nota real (`normalizeSkillGradeValue`); la escala es 1–10, paso 1.
// Compacto (ancho máximo, no ocupa toda la pantalla), con el nombre y el valor juntos arriba del control; la barra es el `<input type="range">` nativo —clic sobre la pista, arrastre
// con mouse, trackpad o dedo, y teclado— con una pista y un tirador grandes (`.tf-grade`); «−» y «+» de 48×48 px ajustan de a un paso sin depender de un arrastre preciso.
const GRADE_MIN = 0;
const GRADE_MAX = 10;
const STEP_BUTTON =
  "inline-flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-md border-[1.5px] border-borderStrong bg-surface text-[24px] font-bold leading-none text-textPrimary transition-colors hover:border-ink active:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40";

function SkillGradeField({ skill, value, onChange }: { skill: Skill; value: number | null; onChange: (value: number | null) => void }) {
  const label = SKILL_LABEL[skill];
  const current = value ?? GRADE_MIN;
  const set = (next: number) => onChange(normalizeSkillGradeValue(Math.min(GRADE_MAX, Math.max(GRADE_MIN, next))));
  const spoken = value != null ? `${value} de 10` : "sin calificar";
  return (
    <div role="group" aria-label={label} className="w-full max-w-[320px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-[650] text-textSecondary">{label}</span>
        <span className="whitespace-nowrap text-[15px] font-bold tf-num text-textPrimary">{value != null ? `${value}/10` : "Sin calificar"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" className={STEP_BUTTON} onClick={() => set(current - 1)} disabled={current <= GRADE_MIN} aria-label={`Bajar la nota de ${label}`}>
          −
        </button>
        <input
          type="range"
          min={GRADE_MIN}
          max={GRADE_MAX}
          step="1"
          value={current}
          onChange={(e) => onChange(normalizeSkillGradeValue(Number(e.target.value)))}
          style={{ "--tf-fill": `${(current / GRADE_MAX) * 100}%` } as CSSProperties}
          className="tf-grade min-w-0 flex-1"
          aria-label={`${label}: ${spoken}`}
          aria-valuetext={spoken}
        />
        <button type="button" className={STEP_BUTTON} onClick={() => set(current + 1)} disabled={current >= GRADE_MAX} aria-label={`Subir la nota de ${label}`}>
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label={`Dejar ${label} sin calificar`}
        aria-pressed={value == null}
        className="mt-2 inline-flex min-h-11 items-center rounded-pill border-[1.5px] border-borderMid bg-surface px-3 text-[14px] text-textSecondary transition-colors hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Sin calificar
      </button>
    </div>
  );
}

/** Cambio de un formulario de participante: un parche o una función del formulario VIGENTE (para sumar sin pisar lo que otro campo acaba de cambiar). */
export type ParticipantFormPatch = Partial<ParticipantForm> | ((form: ParticipantForm) => Partial<ParticipantForm>);

/**
 * Lista de textos cortos (fortalezas, aspectos a mejorar): la MISMA lista editable que temas, objetivos y actividades (`EditableTextList`): cada texto se
 * muestra completo, con «Editar» y «Eliminar» separados; editar conserva el orden y la posición y se guarda o se cancela. Se agrega con «+», Enter o al soltar el campo.
 */
export function ChipListField({ label, singular, placeholder, draftKey, items, onItemsChange }: { label: string; singular: string; placeholder: string; draftKey: string; items: string[]; onItemsChange: (update: (items: string[]) => string[]) => void }) {
  return (
    <EditableTextList
      label={label}
      singular={singular}
      placeholder={placeholder}
      draftKey={draftKey}
      items={items.map((text) => ({ text }))}
      onEditText={(index, text) => onItemsChange((current) => current.map((item, i) => (i === index ? text : item)))}
      onRemove={(index) => onItemsChange((current) => current.filter((_, i) => i !== index))}
      onAdd={(text) => onItemsChange((current) => [...current, text])}
    />
  );
}

/**
 * Evaluación de un alumno — todo opcional: nota general de la clase, notas por área, fortalezas observadas, aspectos a mejorar y la
 * observación individual (ésta SÍ puede aparecer en el reporte de ESE alumno; la interna de la clase nunca).
 */
export function EvaluationFields({ studentName, studentId, form, onChange }: { studentName: string; studentId: string; form: ParticipantForm; onChange: (patch: ParticipantFormPatch) => void }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-[13.5px] text-textMuted">Todo lo de acá abajo es opcional — completá sólo lo que quieras calificar en esta clase.</p>
      <div className="sm:w-72">
        <Field label="Nota general de la clase (1-10)" htmlFor={`${id}-grade`}>
          <TextInput id={`${id}-grade`} type="number" min="1" max="10" value={form.generalGrade} onChange={(e) => onChange({ generalGrade: e.target.value })} placeholder="Sin calificar" />
        </Field>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 text-[14px] font-bold text-textPrimary">Notas por área (opcional)</legend>
        {SKILLS.map((skill) => (
          <SkillGradeField
            key={skill}
            skill={skill}
            value={normalizeSkillGradeValue(form.skillGrades[skill] ?? null)}
            onChange={(value) =>
              onChange({
                skillGrades: value == null ? Object.fromEntries(Object.entries(form.skillGrades).filter(([key]) => key !== skill)) : { ...form.skillGrades, [skill]: value },
              })
            }
          />
        ))}
      </fieldset>
      <ChipListField label="Fortalezas observadas" singular="Fortaleza" placeholder="Agregar fortaleza" draftKey={participantDraftKey(studentId, "strengths")} items={form.strengths} onItemsChange={(update) => onChange((current) => ({ strengths: update(current.strengths) }))} />
      <ChipListField label="Aspectos a mejorar" singular="Aspecto a mejorar" placeholder="Agregar aspecto a mejorar" draftKey={participantDraftKey(studentId, "areasToImprove")} items={form.areasToImprove} onItemsChange={(update) => onChange((current) => ({ areasToImprove: update(current.areasToImprove) }))} />
      <Field label="Observación individual (puede aparecer en su reporte)" htmlFor={`${id}-obs`}>
        <TextArea id={`${id}-obs`} rows={3} aria-label={`Observación individual de ${studentName}`} placeholder="Ej. Mejoró mucho la fluidez esta clase" value={form.individualObservation} onChange={(e) => onChange({ individualObservation: e.target.value })} />
      </Field>
    </div>
  );
}

/** «Tarea para realizar» + «Fecha de entrega (opcional)»: la caja de tarea de la clase (común) y, en un grupo, la personalizada de un alumno. */
export function HomeworkFields({ idPrefix, description, dueDate, onDescriptionChange, onDueDateChange, ariaSuffix = "", studentId }: { idPrefix: string; description: string; dueDate: string; onDescriptionChange: (value: string) => void; onDueDateChange: (value: string) => void; ariaSuffix?: string;studentId?:string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <HomeworkDateChoices value={dueDate} onChange={onDueDateChange} studentId={studentId} />
      <Field label="Tarea para realizar" htmlFor={`${idPrefix}-desc`} hint="Esta tarea aparecerá como pendiente cuando registres la próxima clase del alumno.">
        <TextArea id={`${idPrefix}-desc`} rows={3} placeholder="Ej. Ejercicios de present perfect, unidad 5" aria-label={`Tarea para realizar${ariaSuffix}`} value={description} onChange={(e) => onDescriptionChange(e.target.value)} />
      </Field>
      <div className="sm:w-60">
        <Field label="Fecha de entrega (opcional)" htmlFor={`${idPrefix}-due`}>
          <TextInput id={`${idPrefix}-due`} type="date" aria-label={`Fecha de entrega${ariaSuffix}`} value={dueDate} onChange={(e) => onDueDateChange(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

/**
 * «Personalizar tarea para este alumno» (sólo en un grupo): acción EXPLÍCITA, replegada salvo que el alumno ya tenga una tarea propia
 * (reabrir nunca esconde datos guardados). Desactivarla limpia la tarea personalizada y vuelve a heredar la común — nunca dos cajas de tarea
 * a la vez para el mismo alumno.
 */
export function PersonalizedHomework({ studentName, studentId, form, onChange }: { studentName: string; studentId?:string; form: ParticipantForm; onChange: (patch: ParticipantFormPatch) => void }) {
  const id = useId();
  const [expanded, setExpanded] = useState(isStudentHomeworkPersonalized(form.homeworkDescription));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-[650] text-textPrimary">
        <input
          type="checkbox"
          className={checkClass}
          checked={expanded}
          aria-label={`Personalizar tarea para ${studentName}`}
          onChange={() => {
            if (expanded) onChange({ homeworkDescription: "", homeworkDueDate: "" });
            setExpanded(!expanded);
          }}
        />
        Personalizar tarea para este alumno
      </label>
      {expanded && (
        <>
          <p className="text-[13px] text-textMuted">Reemplaza la tarea común sólo para {studentName}.</p>
          <HomeworkFields idPrefix={id} studentId={studentId} ariaSuffix={` de ${studentName}`} description={form.homeworkDescription} dueDate={form.homeworkDueDate} onDescriptionChange={(homeworkDescription) => onChange({ homeworkDescription })} onDueDateChange={(homeworkDueDate) => onChange({ homeworkDueDate })} />
        </>
      )}
    </div>
  );
}
