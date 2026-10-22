"use client";

import { useId, useState } from "react";
import { CheckIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { AddItemRow, editIndexKey, editTextKey, useDraft } from "./draft-items";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput, checkClass } from "@/components/ui/field";
import { ATTENDANCE_STATUS_LABEL, type AttendanceStatus } from "@/lib/lessons/attendance";
import { homeworkReviewSelectionKey, type HomeworkReviewOutcome, type PendingHomeworkTask } from "@/lib/lessons/homework";
import { normalizeSkillGradeValue } from "@/lib/lessons/grades";
import { isStudentHomeworkPersonalized } from "@/lib/lessons/registration-form";
import { SKILLS, SKILL_LABEL, type Skill } from "@/lib/lessons/skills";
import { formatCivilDate, formatInstantDate } from "@/lib/format/date-format";

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

// Control numérico por área — 0 (o vacío) significa «sin calificar» y NUNCA se persiste como nota real (`normalizeSkillGradeValue`).
function SkillGradeField({ skill, value, onChange }: { skill: Skill; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:flex-nowrap">
      <span className="w-full shrink-0 text-[14.5px] text-textSecondary sm:w-32">{SKILL_LABEL[skill]}</span>
      <div className="flex min-h-11 min-w-[140px] flex-1 items-center">
        <input
          type="range"
          min="0"
          max="10"
          step="1"
          value={value ?? 0}
          onChange={(e) => onChange(normalizeSkillGradeValue(Number(e.target.value)))}
          className="h-2 w-full accent-accent"
          aria-label={`${SKILL_LABEL[skill]}: ${value != null ? `${value} de 10` : "sin calificar"}`}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-[14px] font-bold tf-num text-textPrimary">{value != null ? `${value}/10` : "Sin calificar"}</span>
    </div>
  );
}

/** Cambio de un formulario de participante: un parche o una función del formulario VIGENTE (para sumar sin pisar lo que otro campo acaba de cambiar). */
export type ParticipantFormPatch = Partial<ParticipantForm> | ((form: ParticipantForm) => Partial<ParticipantForm>);

/**
 * Lista de textos cortos (fortalezas, aspectos a mejorar): cada uno es una etiqueta con dos acciones SEPARADAS — «Editar» (abre el texto actual en el
 * mismo lugar, se confirma o se cancela; conserva el orden y la posición) y «Quitar». Se agrega con «+», con Enter o al soltar el campo (✅ de iOS).
 * La etiqueta crece según su texto (nunca se trunca ni se fija su alto) y el texto tiene su propio espacio, independiente de los botones.
 */
export function ChipListField({ label, placeholder, draftKey, items, onItemsChange }: { label: string; placeholder: string; draftKey: string; items: string[]; onItemsChange: (update: (items: string[]) => string[]) => void }) {
  const id = useId();
  const edit = useDraft(editTextKey(draftKey));
  const editIndex = useDraft(editIndexKey(draftKey));
  // Qué etiqueta se está editando y su texto viven en el almacén de borradores del formulario: si se guarda con una edición abierta, el guardado la
  // incorpora en su lugar (nunca se pierde) y la cierra.
  const editingIndex = editIndex.text !== "" && Number.isInteger(Number(editIndex.text)) ? Number(editIndex.text) : null;

  function startEdit(index: number) {
    editIndex.set(String(index));
    edit.set(items[index]);
  }
  function finishEdit(confirm: boolean) {
    const index = editingIndex;
    const text = edit.take().trim();
    editIndex.take();
    if (!confirm || index === null || !text) return;
    onItemsChange((current) => current.map((item, i) => (i === index ? text : item)));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="mb-1 text-[14px] font-bold text-textPrimary">{label}</legend>
      {items.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-2">
          {items.map((item, index) =>
            editingIndex === index ? (
              <li key={`${index}-edit`} className="flex w-full min-w-0 flex-col gap-2 rounded-[20px] border-[1.5px] border-ink bg-surface p-2.5">
                <TextInput
                  aria-label={`Editar: ${item}`}
                  autoFocus
                  enterKeyHint="done"
                  autoComplete="off"
                  value={edit.text}
                  onChange={(event) => edit.set(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishEdit(true);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      finishEdit(false);
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => finishEdit(true)} disabled={!edit.text.trim()} aria-label={`Guardar el cambio de: ${item}`}>
                    Guardar cambio
                  </Button>
                  <Button variant="secondary" onClick={() => finishEdit(false)} aria-label={`Cancelar la edición de: ${item}`}>
                    Cancelar
                  </Button>
                </div>
              </li>
            ) : (
              <li key={`${index}-${item}`} className="flex min-w-0 max-w-full items-center gap-0.5 rounded-[20px] border border-border bg-paperDeep py-1 pl-4 pr-1 text-[15px] leading-snug text-textPrimary">
                <span className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">{item}</span>
                <button type="button" onClick={() => startEdit(index)} aria-label={`Editar ${item}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-textMuted hover:bg-border hover:text-textPrimary">
                  <PencilSquareIcon className="h-[18px] w-[18px]" aria-hidden />
                </button>
                <button type="button" onClick={() => onItemsChange((current) => current.filter((_, i) => i !== index))} aria-label={`Quitar ${item}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-textMuted hover:bg-border hover:text-textPrimary">
                  <XMarkIcon className="h-5 w-5" aria-hidden />
                </button>
              </li>
            )
          )}
        </ul>
      )}
      <AddItemRow draftKey={draftKey} id={id} label={placeholder} placeholder={placeholder} onAdd={(text) => onItemsChange((current) => [...current, text])} />
    </fieldset>
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
      <fieldset className="flex min-w-0 flex-col gap-1">
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
      <ChipListField label="Fortalezas observadas" placeholder="Agregar fortaleza" draftKey={participantDraftKey(studentId, "strengths")} items={form.strengths} onItemsChange={(update) => onChange((current) => ({ strengths: update(current.strengths) }))} />
      <ChipListField label="Aspectos a mejorar" placeholder="Agregar aspecto a mejorar" draftKey={participantDraftKey(studentId, "areasToImprove")} items={form.areasToImprove} onItemsChange={(update) => onChange((current) => ({ areasToImprove: update(current.areasToImprove) }))} />
      <Field label="Observación individual (puede aparecer en su reporte)" htmlFor={`${id}-obs`}>
        <TextArea id={`${id}-obs`} rows={3} aria-label={`Observación individual de ${studentName}`} placeholder="Ej. Mejoró mucho la fluidez esta clase" value={form.individualObservation} onChange={(e) => onChange({ individualObservation: e.target.value })} />
      </Field>
    </div>
  );
}

/** «Tarea para realizar» + «Fecha de entrega (opcional)»: la caja de tarea de la clase (común) y, en un grupo, la personalizada de un alumno. */
export function HomeworkFields({ idPrefix, description, dueDate, onDescriptionChange, onDueDateChange, ariaSuffix = "" }: { idPrefix: string; description: string; dueDate: string; onDescriptionChange: (value: string) => void; onDueDateChange: (value: string) => void; ariaSuffix?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
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
export function PersonalizedHomework({ studentName, form, onChange }: { studentName: string; form: ParticipantForm; onChange: (patch: ParticipantFormPatch) => void }) {
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
          <HomeworkFields idPrefix={id} ariaSuffix={` de ${studentName}`} description={form.homeworkDescription} dueDate={form.homeworkDueDate} onDescriptionChange={(homeworkDescription) => onChange({ homeworkDescription })} onDueDateChange={(homeworkDueDate) => onChange({ homeworkDueDate })} />
        </>
      )}
    </div>
  );
}
