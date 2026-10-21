"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveParticipantAction, finalizeRegistrationAction, editCompletedRegistrationAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationAttendanceRecord, LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import type { ParticipantRegistrationStatus } from "@/lib/lessons/group-progress";
import { ATTENDANCE_STATUS_LABEL, hasResolvedAttendanceStatus, type AttendanceStatus } from "@/lib/lessons/attendance";
import { getBlockingHomeworkTasks, homeworkReviewSelectionKey, type PendingHomeworkTask, type HomeworkReviewOutcome } from "@/lib/lessons/homework";
import { normalizeSkillGradeValue } from "@/lib/lessons/grades";
import { SKILLS, SKILL_LABEL, type Skill } from "@/lib/lessons/skills";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { CheckCircleIcon, CheckIcon, ChevronDownIcon, ClockIcon, MinusCircleIcon } from "@heroicons/react/24/outline";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";

import { PedagogicalContentEditor } from "@/components/registro/pedagogical-content-editor";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import { validatePedagogicalContent } from "@/lib/lessons/pedagogical-content";
import type { LessonContent } from "@/lib/repositories/lesson-content-mapping";
import { saveLessonContentDraftAction } from "@/lib/actions/lesson-registrations";

const HOMEWORK_OUTCOME_LABEL: Record<HomeworkReviewOutcome, string> = {
  realizada: "Realizada",
  parcial: "Parcial",
  no_realizada: "No realizada",
  ya_no_corresponde: "Ya no corresponde",
};
const ATTENDANCE_BUTTONS: AttendanceStatus[] = ["presente", "tarde", "ausente_aviso", "ausente"];

interface ParticipantForm {
  attendanceStatus: AttendanceStatus | null;
  lateMinutes: string;
  generalGrade: string;
  skillGrades: Record<string, number>;
  individualObservation: string;
  strengths: string;
  areasToImprove: string;
  homeworkDescription: string;
  homeworkDueDate: string;
  homeworkReviews: Record<string, HomeworkReviewOutcome>;
}

function buildInitialForm(
  attendance: LessonRegistrationAttendanceRecord | undefined,
  evaluation: LessonRegistrationEvaluationRecord | undefined
): ParticipantForm {
  return {
    attendanceStatus: attendance?.status && attendance.status !== "sin_registrar" ? attendance.status : null,
    lateMinutes: attendance?.lateMinutes != null ? String(attendance.lateMinutes) : "",
    generalGrade: evaluation?.generalGrade != null ? String(evaluation.generalGrade) : "",
    skillGrades: evaluation?.skillGrades ?? {},
    individualObservation: evaluation?.individualObservation ?? "",
    strengths: evaluation?.strengths.join(", ") ?? "",
    areasToImprove: evaluation?.areasToImprove.join(", ") ?? "",
    homeworkDescription: evaluation?.individualHomeworkDescription ?? "",
    homeworkDueDate: evaluation?.individualHomeworkDueDate ?? "",
    homeworkReviews: {},
  };
}

// Chip + control numérico por área — puerto real de `SkillGradeChips.tsx`
// (móvil): 0 (o vacío) significa "sin calificar" y NUNCA se persiste como
// nota real (`normalizeSkillGradeValue`), sólo 1-10 es una nota real.
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

// Parsing puro y compartido de un `ParticipantForm` — única fuente para los
// tres caminos que persisten los datos de un participante (guardado
// individual de la tarjeta, `saveParticipantAction` del registro inicial, y
// el array de participantes de `editCompletedRegistrationAction`), para que
// los tres persistan exactamente los mismos campos de la misma forma.
function parseParticipantFormFields(form: ParticipantForm) {
  return {
    attendanceStatus: form.attendanceStatus,
    lateMinutes: form.attendanceStatus === "tarde" && form.lateMinutes ? Number(form.lateMinutes) : null,
    generalGrade: form.generalGrade ? Number(form.generalGrade) : null,
    skillGrades: form.skillGrades,
    strengths: form.strengths
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    areasToImprove: form.areasToImprove
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    individualObservation: form.individualObservation.trim() || null,
    individualHomeworkDescription: form.homeworkDescription.trim() || null,
    individualHomeworkDueDate: form.homeworkDueDate || null,
    homeworkReviews: Object.entries(form.homeworkReviews).map(([key, outcome]) => ({ taskId: key.split("::")[0], outcome })),
  };
}

// Payload real de `saveParticipantAction` — usado por el registro inicial
// (guardado individual de cada tarjeta, todavía `in_progress`).
function buildSaveParticipantInput(registrationId: string, studentId: string, form: ParticipantForm, nextStatus: ParticipantRegistrationStatus | null, content?: PedagogicalContentInput) {
  return { lessonRegistrationId: registrationId, studentId, participantStatus: nextStatus, content, ...parseParticipantFormFields(form) };
}

// Un elemento del array `participants` de `editCompletedRegistrationAction`
// — nunca lleva `participantStatus` (la RPC atómica de edición nunca
// cambia el estado de avance de un participante, sólo sus datos académicos).
function buildEditParticipantInput(studentId: string, form: ParticipantForm) {
  return { studentId, ...parseParticipantFormFields(form) };
}

function ParticipantCard({
  registrationId,
  studentId,
  name,
  level,
  activityKind,
  status,
  form,
  onFormChange,
  pendingHomework,
  content,
  onSaved,
}: {
  registrationId: string;
  studentId: string;
  name: string;
  level: string;
  activityKind: string;
  status: ParticipantRegistrationStatus;
  form: ParticipantForm;
  onFormChange: (patch: Partial<ParticipantForm>) => void;
  pendingHomework: PendingHomeworkTask[];
  content: PedagogicalContentInput;
  onSaved: (status: ParticipantRegistrationStatus) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(status === "pending");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blockingTasks = getBlockingHomeworkTasks(activityKind, pendingHomework, form.homeworkReviews);

  function updateForm(patch: Partial<ParticipantForm>) {
    onFormChange(patch);
  }

  function setHomeworkOutcome(taskId: string, outcome: HomeworkReviewOutcome) {
    updateForm({ homeworkReviews: { ...form.homeworkReviews, [homeworkReviewSelectionKey(taskId, studentId)]: outcome } });
  }

  function save(nextStatus: ParticipantRegistrationStatus | null) {
    setError(null);
    if (!validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    if (nextStatus === "completed") {
      if (!hasResolvedAttendanceStatus(form.attendanceStatus)) {
        setError("Elegí la asistencia antes de completar a este alumno.");
        return;
      }
      if (blockingTasks.length > 0) {
        setError("Tiene tareas anteriores sin revisar.");
        return;
      }
    }
    startTransition(async () => {
      const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registrationId, studentId, form, nextStatus, content)));
      if (result.error) {
        setError(result.error);
        return;
      }
      if (nextStatus === "completed") setOpen(false);
      onSaved(nextStatus ?? status);
    });
  }

  const statusLabel = status === "completed" ? "Completado" : status === "omitted" ? "Omitido" : "Pendiente";
  const statusBadge =
    status === "completed" ? (
      <Badge tone="ok" icon={<CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />}>
        {statusLabel}
      </Badge>
    ) : status === "omitted" ? (
      <Badge icon={<MinusCircleIcon className="h-3.5 w-3.5" aria-hidden />}>{statusLabel}</Badge>
    ) : (
      <Badge icon={<ClockIcon className="h-3.5 w-3.5" aria-hidden />}>{statusLabel}</Badge>
    );
  const levelAndAttendance = [level, form.attendanceStatus ? ATTENDANCE_STATUS_LABEL[form.attendanceStatus] : null].filter(Boolean).join(" · ");

  return (
    <Card padded={false}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left">
        <Avatar initial={avatarInitials(name)} tone={avatarToneFor(studentId)} size="m" />
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-bold text-textPrimary [overflow-wrap:anywhere]">{name}</p>
          {levelAndAttendance && <p className="text-[13.5px] text-textMuted [overflow-wrap:anywhere]">{levelAndAttendance}</p>}
        </div>
        {statusBadge}
        <ChevronDownIcon className={`h-5 w-5 shrink-0 text-textMuted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t-[1.5px] border-border p-4 nav:p-5">
          {error && <FormErrorBox message={error} />}

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-label font-bold uppercase text-textMuted">Asistencia *</legend>
            <div className="flex flex-wrap gap-2">
              {ATTENDANCE_BUTTONS.map((option) => {
                const selected = form.attendanceStatus === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => updateForm({ attendanceStatus: option })}
                    aria-pressed={form.attendanceStatus === option}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${
                      selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
                    }`}
                  >
                    {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                    {ATTENDANCE_STATUS_LABEL[option]}
                  </button>
                );
              })}
            </div>
            {form.attendanceStatus === "tarde" && (
              <div className="sm:w-56">
                <TextInput type="number" min="0" aria-label="Minutos de tardanza" placeholder="Minutos de tardanza" value={form.lateMinutes} onChange={(e) => updateForm({ lateMinutes: e.target.value })} />
              </div>
            )}
          </fieldset>

          {activityKind === "class" && pendingHomework.length > 0 && (
            <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border-[1.5px] border-warnLine bg-warnSoft p-3.5">
              <legend className="px-1 text-label font-bold uppercase text-textMuted">Tareas anteriores</legend>
              {pendingHomework.map((task) => (
                <div key={task.taskId} className="flex flex-col gap-2">
                  <span className="text-[15px] text-textPrimary [overflow-wrap:anywhere]">{task.description}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(HOMEWORK_OUTCOME_LABEL) as HomeworkReviewOutcome[]).map((outcome) => {
                      const selected = form.homeworkReviews[homeworkReviewSelectionKey(task.taskId, studentId)] === outcome;
                      return (
                        <button
                          key={outcome}
                          type="button"
                          onClick={() => setHomeworkOutcome(task.taskId, outcome)}
                          aria-pressed={form.homeworkReviews[homeworkReviewSelectionKey(task.taskId, studentId)] === outcome}
                          className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-3.5 text-[14px] font-[650] transition-colors ${
                            selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
                          }`}
                        >
                          {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                          {HOMEWORK_OUTCOME_LABEL[outcome]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </fieldset>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nota general (1-10, opcional)" htmlFor={`${uid}-grade`}>
              <TextInput id={`${uid}-grade`} type="number" min="1" max="10" value={form.generalGrade} onChange={(e) => updateForm({ generalGrade: e.target.value })} placeholder="Sin calificar" />
            </Field>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-label font-bold uppercase text-textMuted">Notas por área (opcional)</legend>
            {SKILLS.map((skill) => (
              <SkillGradeField
                key={skill}
                skill={skill}
                value={normalizeSkillGradeValue(form.skillGrades[skill] ?? null)}
                onChange={(value) =>
                  updateForm({
                    skillGrades:
                      value == null
                        ? Object.fromEntries(Object.entries(form.skillGrades).filter(([k]) => k !== skill))
                        : { ...form.skillGrades, [skill]: value },
                  })
                }
              />
            ))}
          </fieldset>

          <Field label="Observaciones" htmlFor={`${uid}-obs`}>
            <TextArea id={`${uid}-obs`} value={form.individualObservation} onChange={(e) => updateForm({ individualObservation: e.target.value })} rows={3} />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Fortalezas (separadas por coma)" htmlFor={`${uid}-str`}>
              <TextInput id={`${uid}-str`} value={form.strengths} onChange={(e) => updateForm({ strengths: e.target.value })} />
            </Field>
            <Field label="A mejorar (separadas por coma)" htmlFor={`${uid}-imp`}>
              <TextInput id={`${uid}-imp`} value={form.areasToImprove} onChange={(e) => updateForm({ areasToImprove: e.target.value })} />
            </Field>
          </div>

          {activityKind === "class" && (
            <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
              <legend className="px-2 text-label font-bold uppercase text-textMuted">Tarea individual nueva (opcional)</legend>
              <TextInput value={form.homeworkDescription} onChange={(e) => updateForm({ homeworkDescription: e.target.value })} aria-label="Descripción de la tarea individual" placeholder="Descripción" />
              <div className="sm:w-60">
                <TextInput type="date" aria-label="Fecha de entrega de la tarea individual" value={form.homeworkDueDate} onChange={(e) => updateForm({ homeworkDueDate: e.target.value })} />
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <Button variant="primary" onClick={() => save("completed")} busy={pending}>
              {pending ? "Guardando..." : "Completar alumno"}
            </Button>
            <Button variant="secondary" onClick={() => save("omitted")} disabled={pending}>
              Omitir por ahora
            </Button>
            <Button variant="ghost" onClick={() => save(null)} disabled={pending}>
              Guardar sin completar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function RegistrationWorkspace({
  registration,
  participants,
  participantStatusByStudentId,
  attendanceByStudentId,
  evaluationByStudentId,
  pendingHomeworkByStudentId,
  scheduledStartAt,
  scheduledEndAt,
  initialContent,
}: {
  registration: LessonRegistrationRecord;
  participants: { studentId: string; name: string; level: string }[];
  participantStatusByStudentId: Record<string, ParticipantRegistrationStatus>;
  attendanceByStudentId: Record<string, LessonRegistrationAttendanceRecord>;
  evaluationByStudentId: Record<string, LessonRegistrationEvaluationRecord>;
  pendingHomeworkByStudentId: Record<string, PendingHomeworkTask[]>;
  scheduledStartAt: string;
  scheduledEndAt: string;
  initialContent?: LessonContent | null;
}) {
  const router = useRouter();
  // Idempotencia real de ESTA edición que sobrevive una RECARGA (a pedido
  // explícito de Joaquín) — persistida en `sessionStorage`, identificada
  // por `registration.id` (para no confundir el borrador de edición de UN
  // registro con el de otro, si la profesora edita varios en la misma
  // pestaña/sesión). Se recupera si ya había un intento sin confirmar
  // sobre ESTE registro, se genera sólo si no existe, y se limpia
  // ÚNICAMENTE tras una respuesta exitosa confirmada. Sólo tiene efecto
  // real cuando el registro ya estaba finalizado — el primer finalizado
  // usa `finalizeRegistrationAction`, que no necesita snapshot ni
  // idempotencia por id (su propia RPC ya es idempotente por status).
  const { operationId: editOperationId, clear: clearEditOperationId } = useDraftOperationId(`teacherflow:registro-edit:${registration.id}`);
  const [statusByStudentId, setStatusByStudentId] = useState(participantStatusByStudentId);
  const [formByStudentId, setFormByStudentId] = useState<Record<string, ParticipantForm>>(() =>
    Object.fromEntries(participants.map((p) => [p.studentId, buildInitialForm(attendanceByStudentId[p.studentId], evaluationByStudentId[p.studentId])]))
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initialDurationMinutes = Math.max(1, Math.round((new Date(scheduledEndAt).getTime() - new Date(scheduledStartAt).getTime()) / 60_000)) || 60;
  const [durationMinutes, setDurationMinutes] = useState(String(initialDurationMinutes));
  const [commonHomeworkDescription, setCommonHomeworkDescription] = useState(registration.homeworkDescription ?? "");
  const [commonHomeworkDueDate, setCommonHomeworkDueDate] = useState(registration.homeworkDueDate ?? "");

  const [content, setContent] = useState<PedagogicalContentInput>(() => ({
    topics: initialContent?.topics ?? [],
    objectives: initialContent?.objectives ?? [],
    activities: initialContent?.activities ?? [],
    activityNotes: initialContent?.activityNotes ?? "",
    internalNotes: initialContent?.internalNotes ?? "",
  }));
  const [draftSaved, setDraftSaved] = useState(false);
  function handleContentChange(next: PedagogicalContentInput) {
    setContent(next);
    setDraftSaved(false);
  }
  function handleSaveContentDraft() {
    setError(null);
    if (!validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    startTransition(async () => {
      const result = await guardNetwork(() => saveLessonContentDraftAction({ lessonRegistrationId: registration.id, content }));
      if (result.error) { setError(result.error); return; }
      setDraftSaved(true);
      router.refresh();
    });
  }

  const isGroup = participants.length > 1;
  const completedCount = Object.values(statusByStudentId).filter((s) => s === "completed").length;
  const allComplete = participants.every((p) => statusByStudentId[p.studentId] === "completed");
  const isFinalized = registration.status === "completed";
  // Cuando el resultado no implica que la actividad se dictó (profesora
  // ausente, feriado sin excepción — ver `lib/lessons/adhoc.ts`), no hay
  // asistencia/evaluación/tarea que completar: el servidor ya insertó a
  // todos los participantes como `completed` (`start_lesson_registration`),
  // así que acá sólo hace falta ocultar las secciones que no aplican,
  // mismo criterio que `classHeld` en el móvil (que ni las muestra).
  const countsAsClass = registration.countsAsClass;

  function handleParticipantFormChange(studentId: string, patch: Partial<ParticipantForm>) {
    setFormByStudentId((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));
  }

  function handleParticipantSaved(studentId: string, status: ParticipantRegistrationStatus) {
    // Actualización local inmediata (progreso/barra/botón "Finalizar" reaccionan
    // al toque, sin esperar un round-trip) + refresh en segundo plano para que
    // el resto de los datos del servidor (updated_at, etc.) también queden al
    // día — cerrar y reabrir la página siempre refleja lo mismo porque la
    // fuente real es la fila de `lesson_registration_students`, nunca un
    // estado efímero que sólo viviera en el navegador.
    setStatusByStudentId((prev) => ({ ...prev, [studentId]: status }));
    router.refresh();
  }

  function handleFinalize() {
    setError(null);
    if (countsAsClass && !validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    startTransition(async () => {
      const headerFields = {
        content: countsAsClass ? content : undefined,
        homeworkDescription: countsAsClass && registration.activityKind === "class" ? commonHomeworkDescription.trim() || null : undefined,
        homeworkDueDate: countsAsClass && registration.activityKind === "class" ? commonHomeworkDueDate || null : undefined,
        actualDurationMinutes: countsAsClass ? Number(durationMinutes) || null : null,
        scheduledStartAt: countsAsClass ? scheduledStartAt : null,
      };

      if (isFinalized) {
        if (!editOperationId) return; // todavía no se recuperó/generó el id — nunca enviar sin él.
        // Editar un registro ya finalizado — UNA sola llamada atómica
        // (snapshot de auditoría + todos los cambios académicos de
        // encabezado y de cada participante, en la misma transacción real
        // del servidor). Nunca dos operaciones separadas del lado del
        // cliente: "Guardar cambios" espera exactamente lo que dice —
        // todo lo que la profesora ve en pantalla, atómico o nada.
        const result = await guardNetwork(() => editCompletedRegistrationAction({
          lessonRegistrationId: registration.id,
          editOperationId,
          ...headerFields,
          participants: participants.map((p) => buildEditParticipantInput(p.studentId, formByStudentId[p.studentId])),
        }));
        if (result.error) {
          setError(result.error);
          return;
        }
        // Recién ahora, con la respuesta exitosa confirmada, se limpia el
        // borrador — un error de arriba nunca llega hasta acá, así que el
        // mismo editOperationId sigue disponible para un reintento real.
        clearEditOperationId();
        router.push("/registro");
        return;
      }

      // Primer finalizado (todavía `in_progress`): cada participante ya se
      // guardó de forma independiente vía su propio "Completar alumno"
      // (`saveParticipantAction`, ya idempotente por las constraints
      // reales de cada tabla hija) — igual se vuelca el formulario vigente
      // una última vez acá (nextStatus: null preserva su estado real)
      // para no perder un ajuste de último momento hecho sin volver a
      // tocar "Completar alumno". `finalizeRegistrationAction` sólo toca
      // el encabezado y no necesita snapshot (no hay "antes" que conservar
      // en un primer finalizado).
      for (const p of participants) {
        const form = formByStudentId[p.studentId];
        const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registration.id, p.studentId, form, null)));
        if (result.error) {
          setError(result.error);
          return;
        }
      }

      const result = await guardNetwork(() => finalizeRegistrationAction({ lessonRegistrationId: registration.id, ...headerFields }));
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/registro");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {isFinalized && <Notice tone="ok">Este registro ya está finalizado — podés editar cualquier dato y guardar de nuevo.</Notice>}

      {!countsAsClass && (
        <Notice tone="info">
          <span className="font-bold text-textPrimary">{ADHOC_OUTCOME_LABEL[registration.outcome]}</span> — esta actividad no se dictó, así que no
          corresponde cargar asistencia, evaluación ni tarea. Sólo hace falta confirmar el registro.
        </Notice>
      )}

      {countsAsClass && (
        <>
          <PedagogicalContentEditor value={content} onChange={handleContentChange} />
          {!isFinalized && <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleSaveContentDraft} busy={pending}>Guardar contenido sin finalizar</Button>
            {draftSaved && <p role="status" className="text-sm text-textSecondary">Contenido guardado.</p>}
          </div>}
        </>
      )}

      {countsAsClass && isGroup && (
        <div>
          <p className="text-[15px] font-bold text-textPrimary">
            Progreso: {completedCount} de {participants.length} completados
          </p>
          <div aria-hidden className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-paperDeep">
            <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${(completedCount / Math.max(participants.length, 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {countsAsClass && (
        <div className="flex flex-col gap-3">
          {participants.map((p) => (
            <ParticipantCard
              key={p.studentId}
              registrationId={registration.id}
              studentId={p.studentId}
              name={p.name}
              level={p.level}
              activityKind={registration.activityKind}
              status={statusByStudentId[p.studentId] ?? "pending"}
              form={formByStudentId[p.studentId]}
              onFormChange={(patch) => handleParticipantFormChange(p.studentId, patch)}
              pendingHomework={pendingHomeworkByStudentId[p.studentId] ?? []}
              content={content}
              onSaved={(status) => handleParticipantSaved(p.studentId, status)}
            />
          ))}
        </div>
      )}

      {countsAsClass && registration.activityKind === "class" && (
        <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5">
          <legend className="px-2 text-label font-bold uppercase text-textMuted">Tarea común para todo el grupo (opcional)</legend>
          <TextInput value={commonHomeworkDescription} onChange={(e) => setCommonHomeworkDescription(e.target.value)} aria-label="Descripción de la tarea común" placeholder="Descripción" />
          <div className="sm:w-60">
            <TextInput type="date" aria-label="Fecha de entrega de la tarea común" value={commonHomeworkDueDate} onChange={(e) => setCommonHomeworkDueDate(e.target.value)} />
          </div>
        </fieldset>
      )}

      {countsAsClass && (
        <div className="sm:w-60">
          <Field label="Duración real (minutos)" htmlFor="registro-duration">
            <TextInput id="registro-duration" type="number" min="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </Field>
        </div>
      )}

      {error && <FormErrorBox message={error} />}

      <div>
        {allComplete ? (
          <Button variant="primary" size="lg" onClick={handleFinalize} busy={pending} disabled={isFinalized && !editOperationId}>
            {pending ? "Guardando..." : isFinalized ? "Guardar cambios" : "Finalizar registro"}
          </Button>
        ) : (
          <p className="text-[15px] text-textMuted">Completá a todos los participantes para poder finalizar el registro. Mientras tanto, el progreso ya queda guardado.</p>
        )}
      </div>
    </div>
  );
}
