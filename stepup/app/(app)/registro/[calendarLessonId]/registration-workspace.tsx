"use client";

import { useId, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveParticipantAction, finalizeRegistrationAction, editCompletedRegistrationAction, saveLessonContentDraftAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import type { LessonRegistrationRecord } from "@/lib/repositories/lesson-registrations";
import type { LessonRegistrationAttendanceRecord, LessonRegistrationEvaluationRecord } from "@/lib/repositories/lesson-registrations-mapping";
import type { ParticipantRegistrationStatus } from "@/lib/lessons/group-progress";
import { ATTENDANCE_STATUS_LABEL, hasResolvedAttendanceStatus } from "@/lib/lessons/attendance";
import { getBlockingHomeworkTasks, homeworkReviewSelectionKey, type PendingHomeworkTask, type HomeworkReviewOutcome } from "@/lib/lessons/homework";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { activityKindSupportsHomework } from "@/lib/calendar/activity-kind";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import {
  firstOpenParticipant,
  formatGroupProgressLabel,
  formatMissingParticipants,
  homeworkFieldsFor,
  initialAttendanceStatus,
  initialDurationMinutes,
  isGroupRegistration,
  showsPendingHomeworkReview,
  summarizeGroupRegistration,
} from "@/lib/lessons/registration-form";
import { CheckCircleIcon, ChevronDownIcon, ClockIcon, MinusCircleIcon } from "@heroicons/react/24/outline";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { InternalNotesCard, PedagogicalContentEditor } from "@/components/registro/pedagogical-content-editor";
import { AttendanceChoice, EvaluationFields, HomeworkFields, PendingHomeworkReview, PersonalizedHomework, type ParticipantForm } from "@/components/registro/registration-form-parts";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import { validatePedagogicalContent } from "@/lib/lessons/pedagogical-content";
import type { LessonContent, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";

function buildInitialForm(attendance: LessonRegistrationAttendanceRecord | undefined, evaluation: LessonRegistrationEvaluationRecord | undefined, isGroup: boolean): ParticipantForm {
  const saved = attendance?.status && attendance.status !== "sin_registrar" ? attendance.status : null;
  return {
    attendanceStatus: initialAttendanceStatus(saved, isGroup),
    lateMinutes: attendance?.lateMinutes != null ? String(attendance.lateMinutes) : "",
    generalGrade: evaluation?.generalGrade != null ? String(evaluation.generalGrade) : "",
    skillGrades: evaluation?.skillGrades ?? {},
    individualObservation: evaluation?.individualObservation ?? "",
    strengths: evaluation?.strengths ?? [],
    areasToImprove: evaluation?.areasToImprove ?? [],
    homeworkDescription: evaluation?.individualHomeworkDescription ?? "",
    homeworkDueDate: evaluation?.individualHomeworkDueDate ?? "",
    homeworkReviews: {},
  };
}

// Parsing puro y compartido de un `ParticipantForm` — única fuente para los tres caminos que persisten los datos de un participante
// (guardado de su tarjeta, `saveParticipantAction` del registro inicial, y el array de participantes de `editCompletedRegistrationAction`),
// para que los tres persistan exactamente los mismos campos de la misma forma.
function parseParticipantFormFields(form: ParticipantForm) {
  return {
    attendanceStatus: form.attendanceStatus,
    lateMinutes: form.attendanceStatus === "tarde" && form.lateMinutes ? Number(form.lateMinutes) : null,
    generalGrade: form.generalGrade ? Number(form.generalGrade) : null,
    skillGrades: form.skillGrades,
    strengths: form.strengths.map((s) => s.trim()).filter(Boolean),
    areasToImprove: form.areasToImprove.map((s) => s.trim()).filter(Boolean),
    individualObservation: form.individualObservation.trim() || null,
    individualHomeworkDescription: form.homeworkDescription.trim() || null,
    individualHomeworkDueDate: form.homeworkDueDate || null,
    homeworkReviews: Object.entries(form.homeworkReviews).map(([key, outcome]) => ({ taskId: key.split("::")[0], outcome })),
  };
}

// Payload real de `saveParticipantAction` — usado por el registro inicial (todavía `in_progress`).
function buildSaveParticipantInput(registrationId: string, studentId: string, form: ParticipantForm, nextStatus: ParticipantRegistrationStatus | null, content?: PedagogicalContentInput) {
  return { lessonRegistrationId: registrationId, studentId, participantStatus: nextStatus, content, ...parseParticipantFormFields(form) };
}

// Un elemento del array `participants` de `editCompletedRegistrationAction` — nunca lleva `participantStatus` (la RPC atómica de edición
// nunca cambia el estado de avance de un participante, sólo sus datos académicos).
function buildEditParticipantInput(studentId: string, form: ParticipantForm) {
  return { studentId, ...parseParticipantFormFields(form) };
}

const STATUS_LABEL: Record<ParticipantRegistrationStatus, string> = { pending: "Pendiente", completed: "Completado", omitted: "Omitido por ahora" };

/** Un bloque del formulario: tarjeta con su título, en el orden de la app anterior. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`}>
      <Card padded={false}>
        <CardHeader title={<span id={`${id}-title`}>{title}</span>} />
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-4 nav:px-5 nav:pb-5">{children}</div>
      </Card>
    </section>
  );
}

/** Un participante de un grupo: encabezado replegable (nombre + estado) y, desplegado, asistencia, tarea pendiente, evaluación, tarea personalizada y las dos acciones. */
function ParticipantCard({
  studentId,
  name,
  level,
  status,
  isOpen,
  onToggle,
  form,
  onFormChange,
  supportsHomework,
  pendingHomework,
  attendanceError,
  homeworkError,
  busy,
  onComplete,
  onOmit,
}: {
  studentId: string;
  name: string;
  level: string;
  status: ParticipantRegistrationStatus;
  isOpen: boolean;
  onToggle: () => void;
  form: ParticipantForm;
  onFormChange: (patch: Partial<ParticipantForm>) => void;
  supportsHomework: boolean;
  pendingHomework: PendingHomeworkTask[];
  attendanceError: boolean;
  homeworkError: boolean;
  busy: boolean;
  onComplete: () => void;
  onOmit: () => void;
}) {
  const statusBadge =
    status === "completed" ? (
      <Badge tone="ok" icon={<CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />}>
        {STATUS_LABEL[status]}
      </Badge>
    ) : status === "omitted" ? (
      <Badge tone="warn" icon={<MinusCircleIcon className="h-3.5 w-3.5" aria-hidden />}>
        {STATUS_LABEL[status]}
      </Badge>
    ) : (
      <Badge icon={<ClockIcon className="h-3.5 w-3.5" aria-hidden />}>{STATUS_LABEL[status]}</Badge>
    );
  const levelAndAttendance = [level, form.attendanceStatus ? ATTENDANCE_STATUS_LABEL[form.attendanceStatus] : null].filter(Boolean).join(" · ");

  return (
    <Card padded={false}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left">
        <Avatar initial={avatarInitials(name)} tone={avatarToneFor(studentId)} size="m" />
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-bold text-textPrimary [overflow-wrap:anywhere]">{name}</p>
          {levelAndAttendance && <p className="text-[13.5px] text-textMuted [overflow-wrap:anywhere]">{levelAndAttendance}</p>}
        </div>
        {statusBadge}
        <ChevronDownIcon className={`h-5 w-5 shrink-0 text-textMuted transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {isOpen && (
        <div className="flex flex-col gap-5 border-t-[1.5px] border-border p-4 nav:p-5">
          <AttendanceChoice
            studentName={name}
            status={form.attendanceStatus}
            lateMinutes={form.lateMinutes}
            onChange={(attendanceStatus) => onFormChange({ attendanceStatus })}
            onLateMinutesChange={(lateMinutes) => onFormChange({ lateMinutes })}
            showMissingError={attendanceError}
          />

          {supportsHomework && showsPendingHomeworkReview({ isGroup: true, attendanceStatus: form.attendanceStatus }) && (
            <PendingHomeworkReview
              tasks={pendingHomework}
              studentId={studentId}
              studentName={name}
              reviews={form.homeworkReviews}
              onSelect={(taskId, outcome) => onFormChange({ homeworkReviews: { ...form.homeworkReviews, [homeworkReviewSelectionKey(taskId, studentId)]: outcome } })}
              showMissingError={homeworkError}
            />
          )}

          <EvaluationFields studentName={name} form={form} onChange={onFormChange} />

          {supportsHomework && <PersonalizedHomework studentName={name} form={form} onChange={onFormChange} />}

          <div className="flex flex-col gap-2.5 sm:max-w-sm">
            <Button variant="primary" onClick={onComplete} busy={busy} disabled={busy}>
              {busy ? "Guardando..." : "Completar alumno"}
            </Button>
            <Button variant="secondary" onClick={onOmit} disabled={busy} aria-label={`Omitir por ahora a ${name}`}>
              Omitir por ahora
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
  materialLibrary,
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
  /** Biblioteca de materiales de la cuenta (para elegirlos en la clase). */
  materialLibrary?: LibraryMaterial[];
}) {
  const router = useRouter();
  const homeworkId = useId();
  // Idempotencia real de ESTA edición que sobrevive una RECARGA — persistida en `sessionStorage`, identificada por `registration.id` (para no
  // confundir el borrador de edición de UN registro con el de otro). Se recupera si ya había un intento sin confirmar sobre ESTE registro, se
  // genera sólo si no existe, y se limpia ÚNICAMENTE tras una respuesta exitosa confirmada. Sólo tiene efecto cuando el registro ya estaba
  // finalizado — el primer finalizado usa `finalizeRegistrationAction`, que no necesita snapshot ni idempotencia por id.
  const { operationId: editOperationId, clear: clearEditOperationId } = useDraftOperationId(`teacherflow:registro-edit:${registration.id}`);

  const isGroup = isGroupRegistration(participants.length);
  const order = participants.map((p) => p.studentId);
  const [statusByStudentId, setStatusByStudentId] = useState(participantStatusByStudentId);
  const [formByStudentId, setFormByStudentId] = useState<Record<string, ParticipantForm>>(() =>
    Object.fromEntries(participants.map((p) => [p.studentId, buildInitialForm(attendanceByStudentId[p.studentId], evaluationByStudentId[p.studentId], isGroup)]))
  );
  const [openParticipantId, setOpenParticipantId] = useState<string | null>(() => firstOpenParticipant(order, participantStatusByStudentId));
  const [attendanceErrorId, setAttendanceErrorId] = useState<string | null>(null);
  const [homeworkErrorId, setHomeworkErrorId] = useState<string | null>(null);
  const [busyParticipantId, setBusyParticipantId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(() => String(initialDurationMinutes({ actualStartedAt: registration.actualStartedAt, actualEndedAt: registration.actualEndedAt, scheduledStartAt, scheduledEndAt })));
  const [commonHomeworkDescription, setCommonHomeworkDescription] = useState(registration.homeworkDescription ?? "");
  const [commonHomeworkDueDate, setCommonHomeworkDueDate] = useState(registration.homeworkDueDate ?? "");

  const [content, setContent] = useState<PedagogicalContentInput>(() => ({
    topics: initialContent?.topics ?? [],
    objectives: initialContent?.objectives ?? [],
    activities: initialContent?.activities ?? [],
    activityNotes: initialContent?.activityNotes ?? "",
    internalNotes: initialContent?.internalNotes ?? "",
    materialIds: initialContent?.materials.map((m) => m.legacyId) ?? [],
  }));
  const [progressSaved, setProgressSaved] = useState(false);
  function handleContentChange(next: PedagogicalContentInput) {
    setContent(next);
    setProgressSaved(false);
  }

  const supportsHomework = activityKindSupportsHomework(registration.activityKind);
  const homeworkFields = homeworkFieldsFor({ supportsHomework, isGroup });
  const completedCount = Object.values(statusByStudentId).filter((s) => s === "completed").length;
  const allComplete = participants.every((p) => statusByStudentId[p.studentId] === "completed");
  const isFinalized = registration.status === "completed";
  // Cuando el resultado no implica que la actividad se dictó (profesora ausente, feriado sin excepción — ver `lib/lessons/adhoc.ts`), no hay
  // asistencia/evaluación/tarea que completar: el servidor ya insertó a todos los participantes como `completed` (`start_lesson_registration`),
  // así que acá sólo hace falta ocultar las secciones que no aplican, mismo criterio que `classHeld` en el móvil (que ni las muestra).
  const countsAsClass = registration.countsAsClass;
  const contentTitle = registration.activityKind === "training" ? "Contenido del entrenamiento" : "Contenido pedagógico";

  function handleParticipantFormChange(studentId: string, patch: Partial<ParticipantForm>) {
    setFormByStudentId((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));
    setProgressSaved(false);
    if ("attendanceStatus" in patch && attendanceErrorId === studentId) setAttendanceErrorId(null);
    if ("homeworkReviews" in patch && homeworkErrorId === studentId) setHomeworkErrorId(null);
  }

  /** Tareas anteriores de un alumno que bloquean «Completar»: sólo las que se ven y sólo si no las revisó (un entrenamiento nunca bloquea). */
  function blockingTasksFor(studentId: string) {
    const form = formByStudentId[studentId];
    if (isGroup && !showsPendingHomeworkReview({ isGroup, attendanceStatus: form.attendanceStatus })) return [];
    return getBlockingHomeworkTasks(registration.activityKind, pendingHomeworkByStudentId[studentId] ?? [], form.homeworkReviews);
  }

  function handleParticipantSaved(studentId: string, status: ParticipantRegistrationStatus) {
    // Actualización local inmediata (progreso/barra/botón «Finalizar» reaccionan al toque, sin esperar un round-trip) + refresh en segundo
    // plano para que el resto de los datos del servidor también queden al día — la fuente real es la fila de `lesson_registration_students`.
    const next = { ...statusByStudentId, [studentId]: status };
    setStatusByStudentId(next);
    setOpenParticipantId(firstOpenParticipant(order, next));
    router.refresh();
  }

  /** «Completar alumno» / «Omitir por ahora» de un participante de un grupo: guarda sus datos y pasa al próximo alumno pendiente. */
  function saveParticipant(studentId: string, nextStatus: "completed" | "omitted") {
    setError(null);
    setProgressSaved(false);
    if (!validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    const form = formByStudentId[studentId];
    if (nextStatus === "completed") {
      if (!hasResolvedAttendanceStatus(form.attendanceStatus)) {
        setAttendanceErrorId(studentId);
        return;
      }
      if (blockingTasksFor(studentId).length > 0) {
        setHomeworkErrorId(studentId);
        return;
      }
    }
    setAttendanceErrorId(null);
    setHomeworkErrorId(null);
    setBusyParticipantId(studentId);
    startTransition(async () => {
      const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registration.id, studentId, form, nextStatus, content)));
      setBusyParticipantId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      handleParticipantSaved(studentId, nextStatus);
    });
  }

  const headerTimes = { scheduledStartAt, actualDurationMinutes: Number(durationMinutes) || null };

  /** «Guardar progreso»: guarda TODO lo cargado sin finalizar (contenido, duración, tarea y los datos de cada alumno, sin cambiar su estado). */
  function handleSaveProgress() {
    setError(null);
    setProgressSaved(false);
    if (!validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    startTransition(async () => {
      const draft = await guardNetwork(() => saveLessonContentDraftAction({
        lessonRegistrationId: registration.id,
        content,
        homeworkDescription: homeworkFields.common ? commonHomeworkDescription.trim() || null : undefined,
        homeworkDueDate: homeworkFields.common ? commonHomeworkDueDate || null : undefined,
        ...headerTimes,
      }));
      if (draft.error) {
        setError(draft.error);
        return;
      }
      for (const p of participants) {
        const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registration.id, p.studentId, formByStudentId[p.studentId], null)));
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      setProgressSaved(true);
      router.refresh();
    });
  }

  function handleFinalize() {
    setError(null);
    if (countsAsClass && !validatePedagogicalContent(content)) {
      setError("Completá o eliminá los temas, objetivos o actividades que quedaron vacíos.");
      return;
    }
    // Clase individual: «Guardar registro» completa al único alumno — mismas exigencias que «Completar alumno» (la asistencia no se pregunta).
    if (countsAsClass && !isGroup && !isFinalized) {
      const studentId = participants[0].studentId;
      if (blockingTasksFor(studentId).length > 0) {
        setHomeworkErrorId(studentId);
        setError("Falta elegir qué pasó con la tarea anterior.");
        return;
      }
    }
    startTransition(async () => {
      const headerFields = {
        content: countsAsClass ? content : undefined,
        homeworkDescription: countsAsClass && supportsHomework ? commonHomeworkDescription.trim() || null : undefined,
        homeworkDueDate: countsAsClass && supportsHomework ? commonHomeworkDueDate || null : undefined,
        actualDurationMinutes: countsAsClass ? Number(durationMinutes) || null : null,
        scheduledStartAt: countsAsClass ? scheduledStartAt : null,
      };

      if (isFinalized) {
        if (!editOperationId) return; // todavía no se recuperó/generó el id — nunca enviar sin él.
        // Editar un registro ya finalizado — UNA sola llamada atómica (snapshot de auditoría + todos los cambios académicos de encabezado y de
        // cada participante, en la misma transacción real del servidor). Nunca dos operaciones separadas del lado del cliente: «Guardar
        // cambios» espera exactamente lo que dice — todo lo que la profesora ve en pantalla, atómico o nada.
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
        // Recién ahora, con la respuesta exitosa confirmada, se limpia el borrador — un error nunca llega hasta acá, así que el mismo
        // editOperationId sigue disponible para un reintento real.
        clearEditOperationId();
        router.push("/registro");
        return;
      }

      // Primer finalizado (todavía `in_progress`): cada participante de un grupo ya se guardó por su cuenta vía «Completar alumno»; igual se
      // vuelca el formulario vigente una última vez (estado intacto) para no perder un ajuste de último momento. En una clase individual este
      // mismo paso es el que completa al único alumno. `finalizeRegistrationAction` sólo toca el encabezado (no hay «antes» que conservar).
      for (const p of participants) {
        const form = formByStudentId[p.studentId];
        const result = await guardNetwork(() => saveParticipantAction(buildSaveParticipantInput(registration.id, p.studentId, form, countsAsClass && !isGroup ? "completed" : null)));
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

  const summary = summarizeGroupRegistration(participants.map((p) => formByStudentId[p.studentId]));
  const missingCount = participants.length - completedCount;
  const single = participants[0];
  const singleForm = formByStudentId[single.studentId];
  const savedAttendanceNote = !isGroup && singleForm.attendanceStatus && singleForm.attendanceStatus !== "presente" ? ATTENDANCE_STATUS_LABEL[singleForm.attendanceStatus] : null;

  return (
    <div className="flex flex-col gap-4">
      {isFinalized && <Notice tone="ok">Este registro ya está finalizado — podés editar cualquier dato y guardar de nuevo.</Notice>}

      {!countsAsClass && (
        <Notice tone="info">
          <span className="font-bold text-textPrimary">{ADHOC_OUTCOME_LABEL[registration.outcome]}</span> — esta actividad no se dictó, así que no
          corresponde cargar asistencia, evaluación ni tarea. Sólo hace falta confirmar el registro.
        </Notice>
      )}

      {countsAsClass && isGroup && (
        <div>
          <p className="text-[15px] font-bold text-textPrimary">{formatGroupProgressLabel(completedCount, participants.length)}</p>
          <div aria-hidden className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-paperDeep">
            <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${(completedCount / Math.max(participants.length, 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 1) Clase individual: la tarea pendiente de la clase anterior, antes que nada (el alumno ya encabeza la pantalla). */}
      {countsAsClass && !isGroup && savedAttendanceNote && <Notice tone="info">Asistencia registrada: {savedAttendanceNote}{singleForm.attendanceStatus === "tarde" && singleForm.lateMinutes ? ` (${singleForm.lateMinutes} min)` : ""}.</Notice>}
      {countsAsClass && !isGroup && homeworkFields.pendingReview && (pendingHomeworkByStudentId[single.studentId] ?? []).length > 0 && (
        <PendingHomeworkReview
          tasks={pendingHomeworkByStudentId[single.studentId] ?? []}
          studentId={single.studentId}
          studentName={single.name}
          reviews={singleForm.homeworkReviews}
          onSelect={(taskId, outcome) => handleParticipantFormChange(single.studentId, { homeworkReviews: { ...singleForm.homeworkReviews, [homeworkReviewSelectionKey(taskId, single.studentId)]: outcome } })}
          showMissingError={homeworkErrorId === single.studentId}
        />
      )}

      {/* 2) Duración real. */}
      {countsAsClass && (
        <Card>
          <div className="sm:w-60">
            <Field label="Duración real (minutos)" htmlFor="registro-duration">
              <TextInput id="registro-duration" type="number" min="1" value={durationMinutes} onChange={(e) => { setDurationMinutes(e.target.value); setProgressSaved(false); }} />
            </Field>
          </div>
        </Card>
      )}

      {/* 3) Clase individual: la evaluación del único alumno. */}
      {countsAsClass && !isGroup && (
        <Block title="Evaluación">
          <EvaluationFields studentName={single.name} form={singleForm} onChange={(patch) => handleParticipantFormChange(single.studentId, patch)} />
        </Block>
      )}

      {/* 4) Contenido pedagógico (temas, objetivos, actividades, notas, evidencias y materiales). */}
      {countsAsClass && (
        <PedagogicalContentEditor title={contentTitle} value={content} onChange={handleContentChange} files={{ registrationId: registration.id, attachments: initialContent?.attachments ?? [], library: materialLibrary ?? [] }} />
      )}

      {/* 5) Grupo: los participantes, uno por vez. */}
      {countsAsClass && isGroup && (
        <section aria-label="Participantes" className="flex flex-col gap-3">
          <h2 className="font-display text-card font-semibold">Participantes</h2>
          {participants.map((p) => (
            <ParticipantCard
              key={p.studentId}
              studentId={p.studentId}
              name={p.name}
              level={p.level}
              status={statusByStudentId[p.studentId] ?? "pending"}
              isOpen={openParticipantId === p.studentId}
              onToggle={() => setOpenParticipantId(openParticipantId === p.studentId ? null : p.studentId)}
              form={formByStudentId[p.studentId]}
              onFormChange={(patch) => handleParticipantFormChange(p.studentId, patch)}
              supportsHomework={supportsHomework}
              pendingHomework={pendingHomeworkByStudentId[p.studentId] ?? []}
              attendanceError={attendanceErrorId === p.studentId}
              homeworkError={homeworkErrorId === p.studentId}
              busy={busyParticipantId === p.studentId}
              onComplete={() => saveParticipant(p.studentId, "completed")}
              onOmit={() => saveParticipant(p.studentId, "omitted")}
            />
          ))}
        </section>
      )}

      {/* 6) Observaciones internas. */}
      {countsAsClass && <InternalNotesCard value={content.internalNotes} onChange={(internalNotes) => handleContentChange({ ...content, internalNotes })} />}

      {/* 7) Tarea para la próxima clase — UNA sola, la común: en una clase individual es la tarea del único alumno. */}
      {countsAsClass && homeworkFields.common && (
        <Block title="Tarea para la próxima clase">
          <HomeworkFields
            idPrefix={homeworkId}
            description={commonHomeworkDescription}
            dueDate={commonHomeworkDueDate}
            onDescriptionChange={(value) => { setCommonHomeworkDescription(value); setProgressSaved(false); }}
            onDueDateChange={(value) => { setCommonHomeworkDueDate(value); setProgressSaved(false); }}
          />
        </Block>
      )}

      {/* 8) Grupo: resumen de lo marcado hasta ahora. */}
      {countsAsClass && isGroup && (
        <Block title="Resumen">
          <ul className="flex flex-col gap-1 text-[15px] text-textSecondary">
            <li>Presentes: {summary.present}</li>
            <li>Llegadas tarde: {summary.late}</li>
            <li>Ausentes con aviso: {summary.absentWithNotice}</li>
            <li>Ausentes: {summary.absent}</li>
            <li>Total de participantes: {summary.total}</li>
            <li>Tareas personalizadas: {summary.personalizedHomework}</li>
          </ul>
          {!allComplete && <p className="text-[14.5px] font-semibold text-warn">Faltan {missingCount} alumno(s) por completar para poder finalizar.</p>}
        </Block>
      )}

      {error && <FormErrorBox message={error} />}
      {progressSaved && (
        <p role="status" className="text-[15px] font-semibold text-ok">
          Progreso guardado.
        </p>
      )}

      {/* 9) Acciones. Grupo incompleto: «Guardar progreso» + cuántos faltan; completo o clase individual: un solo botón principal. */}
      <div className="flex flex-col items-start gap-2.5">
        {countsAsClass && isGroup && !allComplete ? (
          <>
            <Button variant="primary" size="lg" onClick={handleSaveProgress} busy={pending && busyParticipantId === null} disabled={pending}>
              {pending && busyParticipantId === null ? "Guardando..." : "Guardar progreso"}
            </Button>
            <p className="text-[15px] text-textMuted">{formatMissingParticipants(missingCount)}</p>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" onClick={handleFinalize} busy={pending} disabled={(isFinalized && !editOperationId) || pending}>
              {pending ? "Guardando..." : isFinalized ? "Guardar cambios" : isGroup ? "Finalizar registro" : countsAsClass ? "Guardar registro" : "Finalizar registro"}
            </Button>
            {countsAsClass && !isGroup && !isFinalized && (
              <Button variant="secondary" onClick={handleSaveProgress} disabled={pending}>
                Guardar progreso
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
