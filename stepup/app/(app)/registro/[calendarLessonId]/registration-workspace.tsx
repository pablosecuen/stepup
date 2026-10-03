"use client";

import { useState, useTransition } from "react";
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
import { FormErrorBox } from "@/components/auth/form-boxes";

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
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-textSecondary">{SKILL_LABEL[skill]}</span>
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        value={value ?? 0}
        onChange={(e) => onChange(normalizeSkillGradeValue(Number(e.target.value)))}
        className="h-2 flex-1 accent-brandBlue"
        aria-label={`${SKILL_LABEL[skill]}: ${value != null ? `${value} de 10` : "sin calificar"}`}
      />
      <span className="w-20 shrink-0 text-right text-xs font-semibold text-textPrimary">{value != null ? `${value}/10` : "Sin calificar"}</span>
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
function buildSaveParticipantInput(registrationId: string, studentId: string, form: ParticipantForm, nextStatus: ParticipantRegistrationStatus | null) {
  return { lessonRegistrationId: registrationId, studentId, participantStatus: nextStatus, ...parseParticipantFormFields(form) };
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
  onSaved: (status: ParticipantRegistrationStatus) => void;
}) {
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
      const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registrationId, studentId, form, nextStatus)));
      if (result.error) {
        setError(result.error);
        return;
      }
      if (nextStatus === "completed") setOpen(false);
      onSaved(nextStatus ?? status);
    });
  }

  const statusLabel = status === "completed" ? "Completado" : status === "omitted" ? "Omitido" : "Pendiente";
  const statusColor = status === "completed" ? "text-statusVerde" : status === "omitted" ? "text-textMuted" : "text-textSecondary";

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <div>
          <p className="text-sm font-semibold text-textPrimary">{name}</p>
          <p className="text-xs text-textMuted">{level}</p>
        </div>
        <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          {error && <FormErrorBox message={error} />}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Asistencia *</legend>
            <div className="flex flex-wrap gap-2">
              {ATTENDANCE_BUTTONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => updateForm({ attendanceStatus: option })}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    form.attendanceStatus === option ? "border-brandBlue bg-brandBlue/10 text-brandBlueDark" : "border-border text-textSecondary"
                  }`}
                >
                  {ATTENDANCE_STATUS_LABEL[option]}
                </button>
              ))}
            </div>
            {form.attendanceStatus === "tarde" && (
              <input
                type="number"
                min="0"
                placeholder="Minutos de tardanza"
                value={form.lateMinutes}
                onChange={(e) => updateForm({ lateMinutes: e.target.value })}
                className="mt-1 w-40 rounded-md border border-border px-2 py-1.5 text-sm"
              />
            )}
          </fieldset>

          {blockingTasks.length > 0 && (
            <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Tareas anteriores</legend>
              {pendingHomework.map((task) => (
                <div key={task.taskId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-textSecondary">{task.description}</span>
                  <div className="flex gap-1">
                    {(Object.keys(HOMEWORK_OUTCOME_LABEL) as HomeworkReviewOutcome[]).map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        onClick={() => setHomeworkOutcome(task.taskId, outcome)}
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                          form.homeworkReviews[homeworkReviewSelectionKey(task.taskId, studentId)] === outcome
                            ? "border-brandBlue bg-brandBlue/10 text-brandBlueDark"
                            : "border-border text-textSecondary"
                        }`}
                      >
                        {HOMEWORK_OUTCOME_LABEL[outcome]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-textSecondary">Nota general (1-10, opcional)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={form.generalGrade}
                onChange={(e) => updateForm({ generalGrade: e.target.value })}
                placeholder="Sin calificar"
                className="rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Notas por área (opcional)</legend>
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

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-textSecondary">Observaciones</label>
            <textarea
              value={form.individualObservation}
              onChange={(e) => updateForm({ individualObservation: e.target.value })}
              rows={2}
              className="rounded-md border border-border px-2 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-textSecondary">Fortalezas (separadas por coma)</label>
              <input value={form.strengths} onChange={(e) => updateForm({ strengths: e.target.value })} className="rounded-md border border-border px-2 py-1.5 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-textSecondary">A mejorar (separadas por coma)</label>
              <input value={form.areasToImprove} onChange={(e) => updateForm({ areasToImprove: e.target.value })} className="rounded-md border border-border px-2 py-1.5 text-sm" />
            </div>
          </div>

          {activityKind === "class" && (
            <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Tarea individual nueva (opcional)</legend>
              <input
                value={form.homeworkDescription}
                onChange={(e) => updateForm({ homeworkDescription: e.target.value })}
                placeholder="Descripción"
                className="rounded-md border border-border px-2 py-1.5 text-sm"
              />
              <input
                type="date"
                value={form.homeworkDueDate}
                onChange={(e) => updateForm({ homeworkDueDate: e.target.value })}
                className="w-48 rounded-md border border-border px-2 py-1.5 text-sm"
              />
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => save("completed")}
              disabled={pending}
              className="rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Guardando..." : "Completar alumno"}
            </button>
            <button type="button" onClick={() => save("omitted")} disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-textSecondary disabled:opacity-50">
              Omitir por ahora
            </button>
            <button type="button" onClick={() => save(null)} disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-textSecondary disabled:opacity-50">
              Guardar sin completar
            </button>
          </div>
        </div>
      )}
    </div>
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
}: {
  registration: LessonRegistrationRecord;
  participants: { studentId: string; name: string; level: string }[];
  participantStatusByStudentId: Record<string, ParticipantRegistrationStatus>;
  attendanceByStudentId: Record<string, LessonRegistrationAttendanceRecord>;
  evaluationByStudentId: Record<string, LessonRegistrationEvaluationRecord>;
  pendingHomeworkByStudentId: Record<string, PendingHomeworkTask[]>;
  scheduledStartAt: string;
  scheduledEndAt: string;
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
    startTransition(async () => {
      const headerFields = {
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
      {isFinalized && <p className="rounded-md border border-statusVerde/30 bg-statusVerde/5 px-3 py-2 text-sm font-medium text-statusVerde">Este registro ya está finalizado — podés editar cualquier dato y guardar de nuevo.</p>}

      {!countsAsClass && (
        <p className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-textSecondary">
          <span className="font-semibold text-textPrimary">{ADHOC_OUTCOME_LABEL[registration.outcome]}</span> — esta actividad no se dictó, así que no
          corresponde cargar asistencia, evaluación ni tarea. Sólo hace falta confirmar el registro.
        </p>
      )}

      {countsAsClass && isGroup && (
        <div>
          <p className="text-sm font-semibold text-textPrimary">
            Progreso: {completedCount} de {participants.length} completados
          </p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-background">
            <div className="h-full bg-brandBlue transition-all" style={{ width: `${(completedCount / Math.max(participants.length, 1)) * 100}%` }} />
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
              onSaved={(status) => handleParticipantSaved(p.studentId, status)}
            />
          ))}
        </div>
      )}

      {countsAsClass && registration.activityKind === "class" && (
        <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-textSecondary">Tarea común para todo el grupo (opcional)</legend>
          <input
            value={commonHomeworkDescription}
            onChange={(e) => setCommonHomeworkDescription(e.target.value)}
            placeholder="Descripción"
            className="rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={commonHomeworkDueDate}
            onChange={(e) => setCommonHomeworkDueDate(e.target.value)}
            className="w-48 rounded-md border border-border px-2 py-1.5 text-sm"
          />
        </fieldset>
      )}

      {countsAsClass && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-textSecondary">Duración real (minutos)</label>
          <input
            type="number"
            min="1"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="w-40 rounded-md border border-border px-2 py-1.5 text-sm"
          />
        </div>
      )}

      {error && <FormErrorBox message={error} />}

      <div>
        {allComplete ? (
          <button
            type="button"
            onClick={handleFinalize}
            disabled={pending || (isFinalized && !editOperationId)}
            className="rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card disabled:opacity-60"
          >
            {pending ? "Guardando..." : isFinalized ? "Guardar cambios" : "Finalizar registro"}
          </button>
        ) : (
          <p className="text-sm text-textMuted">Completá a todos los participantes para poder finalizar el registro. Mientras tanto, el progreso ya queda guardado.</p>
        )}
      </div>
    </div>
  );
}
