import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type {
  LessonRegistrationAttendanceRow,
  LessonRegistrationEvaluationRow,
  LessonRegistrationHomeworkReviewRow,
  LessonRegistrationRow,
  LessonRegistrationStudentRow,
} from "@/lib/db/database.types";
import {
  toLessonRegistrationRecord,
  toLessonRegistrationStudentRecord,
  toLessonRegistrationAttendanceRecord,
  toLessonRegistrationEvaluationRecord,
  toLessonRegistrationHomeworkReviewRecord,
  buildLessonRegistrationDetail,
  type LessonRegistrationRecord,
  type LessonRegistrationDetail,
} from "./lesson-registrations-mapping";
import { activityKindSupportsHomework } from "@/lib/calendar/activity-kind";
import { commonHomeworkTaskId, individualHomeworkTaskId, isHomeworkTaskResolved, type PendingHomeworkTask } from "@/lib/lessons/homework";

/**
 * Repositorio de registros pedagógicos — única puerta de entrada real a
 * `lesson_registrations` y sus 4 tablas hijas. Mismo patrón que
 * `calendar-lessons.ts`: lecturas simples van directo (RLS ya aísla por
 * `owner_id`), toda escritura multi-tabla pasa por una RPC atómica.
 */
export type { LessonRegistrationRecord, LessonRegistrationDetail } from "./lesson-registrations-mapping";

export class LessonRegistrationNotFoundError extends Error {}

/** Progreso real (para la lista de pendientes) de cada registro ligado a una de estas clases materializadas. */
export interface RegistrationProgressRow {
  registrationId: string;
  calendarLessonId: string;
  status: "in_progress" | "completed";
  completedParticipants: number;
  totalParticipants: number;
}

/** ¿Existe al menos un registro de clase (ligado o libre, de cualquier fecha)? Lectura mínima: una fila, sin traer datos. */
export async function hasAnyLessonRegistration(ctx: AuthenticatedDbContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.from("lesson_registrations").select("id").eq("owner_id", ctx.ownerId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function listRegistrationProgressForCalendarLessonIds(
  ctx: AuthenticatedDbContext,
  calendarLessonIds: string[]
): Promise<RegistrationProgressRow[]> {
  if (calendarLessonIds.length === 0) return [];
  const { data: registrations, error } = await ctx.supabase
    .from("lesson_registrations")
    .select("id, calendar_lesson_id, status")
    .eq("owner_id", ctx.ownerId)
    .in("calendar_lesson_id", calendarLessonIds);
  if (error) throw error;
  const rows = registrations as Pick<LessonRegistrationRow, "id" | "calendar_lesson_id" | "status">[];
  if (rows.length === 0) return [];

  const { data: participants, error: participantsError } = await ctx.supabase
    .from("lesson_registration_students")
    .select("lesson_registration_id, participant_status")
    .eq("owner_id", ctx.ownerId)
    .in(
      "lesson_registration_id",
      rows.map((r) => r.id)
    );
  if (participantsError) throw participantsError;
  const participantRows = participants as Pick<LessonRegistrationStudentRow, "lesson_registration_id" | "participant_status">[];

  return rows.map((row) => {
    const own = participantRows.filter((p) => p.lesson_registration_id === row.id);
    return {
      registrationId: row.id,
      calendarLessonId: row.calendar_lesson_id as string,
      status: row.status,
      completedParticipants: own.filter((p) => p.participant_status === "completed").length,
      totalParticipants: own.length,
    };
  });
}

async function fetchDetail(ctx: AuthenticatedDbContext, registrationId: string): Promise<LessonRegistrationDetail | null> {
  const { data: registrationRow, error } = await ctx.supabase
    .from("lesson_registrations")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("id", registrationId)
    .maybeSingle();
  if (error) throw error;
  if (!registrationRow) return null;

  const [participantsRes, attendanceRes, evaluationsRes, homeworkRes] = await Promise.all([
    ctx.supabase.from("lesson_registration_students").select("*").eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId),
    ctx.supabase.from("lesson_registration_attendance").select("*").eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId),
    ctx.supabase.from("lesson_registration_evaluations").select("*").eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId),
    ctx.supabase.from("lesson_registration_homework_reviews").select("*").eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId),
  ]);
  if (participantsRes.error) throw participantsRes.error;
  if (attendanceRes.error) throw attendanceRes.error;
  if (evaluationsRes.error) throw evaluationsRes.error;
  if (homeworkRes.error) throw homeworkRes.error;

  return buildLessonRegistrationDetail({
    registration: toLessonRegistrationRecord(registrationRow as LessonRegistrationRow),
    participants: (participantsRes.data as LessonRegistrationStudentRow[]).map(toLessonRegistrationStudentRecord),
    attendance: (attendanceRes.data as LessonRegistrationAttendanceRow[]).map(toLessonRegistrationAttendanceRecord),
    evaluations: (evaluationsRes.data as LessonRegistrationEvaluationRow[]).map(toLessonRegistrationEvaluationRecord),
    homeworkReviews: (homeworkRes.data as LessonRegistrationHomeworkReviewRow[]).map(toLessonRegistrationHomeworkReviewRecord),
  });
}

export async function getLessonRegistrationDetail(ctx: AuthenticatedDbContext, registrationId: string): Promise<LessonRegistrationDetail | null> {
  return fetchDetail(ctx, registrationId);
}

export async function getLessonRegistrationDetailByCalendarLessonId(ctx: AuthenticatedDbContext, calendarLessonId: string): Promise<LessonRegistrationDetail | null> {
  const { data, error } = await ctx.supabase
    .from("lesson_registrations")
    .select("id")
    .eq("owner_id", ctx.ownerId)
    .eq("calendar_lesson_id", calendarLessonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return fetchDetail(ctx, (data as { id: string }).id);
}

/** Sólo las fechas reales de edición (auditoría append-only) — nunca el snapshot completo, que no tiene una vista dedicada en esta ronda. */
export async function listEditHistoryTimestamps(ctx: AuthenticatedDbContext, registrationId: string): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("lesson_registration_edit_history")
    .select("edited_at")
    .eq("owner_id", ctx.ownerId)
    .eq("lesson_registration_id", registrationId)
    .order("edited_at", { ascending: false });
  if (error) throw error;
  return (data as { edited_at: string }[]).map((row) => row.edited_at);
}

/** Historial real de registros de un alumno (ficha del alumno) — más reciente primero, conserva el historial aunque el alumno esté archivado. */
export async function listLessonRegistrationsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<LessonRegistrationRecord[]> {
  const { data: rosterRows, error: rosterError } = await ctx.supabase
    .from("lesson_registration_students")
    .select("lesson_registration_id")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId);
  if (rosterError) throw rosterError;
  const registrationIds = (rosterRows as Pick<LessonRegistrationStudentRow, "lesson_registration_id">[]).map((r) => r.lesson_registration_id);
  if (registrationIds.length === 0) return [];

  const { data, error } = await ctx.supabase
    .from("lesson_registrations")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .in("id", registrationIds)
    .order("scheduled_start_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data as LessonRegistrationRow[]).map(toLessonRegistrationRecord);
}

/**
 * Tareas pendientes reales de un alumno — puerto de
 * `computePendingHomeworkTasks` (móvil): recorre sus registros YA
 * finalizados (`status = 'completed'`), sólo los que cuentan como clase
 * (`counts_as_class`) y cuyo `activity_kind` admite tareas
 * (`activityKindSupportsHomework` — un entrenamiento nunca asigna tarea a
 * una clase posterior), junta la tarea común del registro + la individual
 * de este alumno, y descarta las ya resueltas (`isHomeworkTaskResolved`).
 * Ordenadas de la más vieja a la más nueva, igual que el móvil.
 */
export async function listPendingHomeworkTasksForStudent(
  ctx: AuthenticatedDbContext,
  studentId: string,
  options?: { excludeOriginLessonRegistrationId?: string }
): Promise<PendingHomeworkTask[]> {
  const registrations = await listLessonRegistrationsForStudent(ctx, studentId);
  const eligible = registrations.filter(
    (r) => r.status === "completed" && r.countsAsClass && activityKindSupportsHomework(r.activityKind) && r.id !== options?.excludeOriginLessonRegistrationId
  );
  if (eligible.length === 0) return [];

  const { data: evaluationRows, error: evaluationError } = await ctx.supabase
    .from("lesson_registration_evaluations")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .in(
      "lesson_registration_id",
      eligible.map((r) => r.id)
    );
  if (evaluationError) throw evaluationError;
  const evaluationByRegistrationId = new Map(
    (evaluationRows as LessonRegistrationEvaluationRow[]).map((row) => [row.lesson_registration_id, toLessonRegistrationEvaluationRecord(row)])
  );

  const tasks: PendingHomeworkTask[] = [];
  eligible.forEach((registration) => {
    if (registration.homeworkDescription) {
      tasks.push({
        taskId: commonHomeworkTaskId(registration.id),
        studentId,
        description: registration.homeworkDescription,
        dueDate: registration.homeworkDueDate,
        originLessonRegistrationId: registration.id,
        assignedAt: registration.scheduledStartAt ?? registration.createdAt,
      });
    }
    const evaluation = evaluationByRegistrationId.get(registration.id);
    if (evaluation?.individualHomeworkDescription) {
      tasks.push({
        taskId: individualHomeworkTaskId(registration.id, studentId),
        studentId,
        description: evaluation.individualHomeworkDescription,
        dueDate: evaluation.individualHomeworkDueDate,
        originLessonRegistrationId: registration.id,
        assignedAt: registration.scheduledStartAt ?? registration.createdAt,
      });
    }
  });
  if (tasks.length === 0) return [];

  const { data: reviewRows, error: reviewError } = await ctx.supabase
    .from("lesson_registration_homework_reviews")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .in(
      "task_id",
      tasks.map((t) => t.taskId)
    );
  if (reviewError) throw reviewError;
  const resolvedTaskIds = new Set(
    (reviewRows as LessonRegistrationHomeworkReviewRow[]).filter((row) => isHomeworkTaskResolved(row.outcome)).map((row) => row.task_id)
  );

  return tasks
    .filter((task) => !resolvedTaskIds.has(task.taskId))
    .sort((a, b) => new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime());
}

/** Evaluaciones reales de un alumno a través de sus registros finalizados — para "Progreso" (promedio, fortalezas, a mejorar). */
export async function listEvaluationsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<{ registration: LessonRegistrationRecord; evaluation: ReturnType<typeof toLessonRegistrationEvaluationRecord> }[]> {
  const registrations = await listLessonRegistrationsForStudent(ctx, studentId);
  const completed = registrations.filter((r) => r.status === "completed" && r.countsAsClass);
  if (completed.length === 0) return [];

  const { data, error } = await ctx.supabase
    .from("lesson_registration_evaluations")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .in(
      "lesson_registration_id",
      completed.map((r) => r.id)
    );
  if (error) throw error;
  const evaluationByRegistrationId = new Map((data as LessonRegistrationEvaluationRow[]).map((row) => [row.lesson_registration_id, toLessonRegistrationEvaluationRecord(row)]));

  return completed
    .map((registration) => ({ registration, evaluation: evaluationByRegistrationId.get(registration.id) }))
    .filter((entry): entry is { registration: LessonRegistrationRecord; evaluation: ReturnType<typeof toLessonRegistrationEvaluationRecord> } => !!entry.evaluation);
}

// ---------------------------------------------------------------------------
// Mutaciones — RPC atómicas (ver supabase/migrations/20260921120000_lesson_registration_rpcs.sql)
// ---------------------------------------------------------------------------

export interface StartLessonRegistrationInput {
  calendarLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: "individual" | "group";
  startAt: string | null;
  endAt: string | null;
  modality: string;
  classTitle: string | null;
  activityKind: string;
  countsAsClass: boolean;
  color: string;
  participants: { studentId: string; studentName: string; level: string }[];
  /** Sólo tienen efecto real en el camino ad-hoc (`calendarLessonId: null`) — ver `lib/lessons/adhoc.ts`. */
  outcome?: string;
  holidayException?: boolean;
  /** Obligatorio cuando `calendarLessonId` es `null` — idempotencia real del camino ad-hoc (ver migración). Generado UNA vez del lado del cliente, nunca acá. */
  operationId?: string | null;
  /** Sólo tienen efecto real cuando `outcome === 'cancelada_tarde'` — Fase 5, cierre de Cancelada/Reprogramada. */
  lateCancellationPolicy?: string | null;
  lateCancellationPercentage?: number | null;
  /** Enlace de trazabilidad hacia el registro original `'reprogramada'` que esta clase reemplaza — Fase 5. */
  rescheduledFromRegistrationId?: string | null;
}

export async function startLessonRegistration(ctx: AuthenticatedDbContext, input: StartLessonRegistrationInput): Promise<LessonRegistrationRecord> {
  const { data, error } = await ctx.supabase.rpc("start_lesson_registration", {
    p_payload: {
      calendar_lesson_id: input.calendarLessonId,
      recurrence_id: input.recurrenceId,
      occurrence_key: input.occurrenceKey,
      recurrence_index: input.recurrenceIndex,
      primary_student_id: input.primaryStudentId,
      student_name: input.studentName,
      level: input.level,
      lesson_type: input.lessonType,
      start_at: input.startAt,
      end_at: input.endAt,
      modality: input.modality,
      class_title: input.classTitle,
      activity_kind: input.activityKind,
      counts_as_class: input.countsAsClass,
      color: input.color,
      participants: input.participants.map((p) => ({ student_id: p.studentId, student_name: p.studentName, level: p.level })),
      outcome: input.outcome,
      holiday_exception: input.holidayException,
      operation_id: input.operationId,
      late_cancellation_policy: input.lateCancellationPolicy ?? null,
      late_cancellation_percentage: input.lateCancellationPercentage ?? null,
      rescheduled_from_registration_id: input.rescheduledFromRegistrationId ?? null,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new LessonRegistrationNotFoundError("No encontrado.");
    throw error;
  }
  return toLessonRegistrationRecord(data as LessonRegistrationRow);
}

export interface EditCompletedRegistrationParticipantInput {
  studentId: string;
  attendance: { status: string; lateMinutes: number | null } | null;
  evaluation: {
    generalGrade: number | null;
    skillGrades: Record<string, number>;
    strengths: string[];
    areasToImprove: string[];
    individualObservation: string | null;
    individualHomeworkDescription: string | null;
    individualHomeworkDueDate: string | null;
  } | null;
  homeworkReviews: { taskId: string; outcome: string }[];
}

export interface EditCompletedRegistrationInput {
  lessonRegistrationId: string;
  /** Idempotencia real de esta edición — generado UNA vez del lado del cliente por cada intento de "Guardar cambios", nunca acá. */
  editOperationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  countsAsClass?: boolean;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  /** Corrección post-finalización de la política de cancelación tardía — Fase 5. */
  lateCancellationPolicy?: string | null;
  lateCancellationPercentage?: number | null;
  participants: EditCompletedRegistrationParticipantInput[];
}

/**
 * Única vía real para editar un registro ya finalizado — snapshot de
 * auditoría + todos los cambios académicos (encabezado + N participantes)
 * en UNA SOLA RPC atómica (ver `edit_completed_lesson_registration` en
 * `20260922100000_adhoc_registration_and_edit_history.sql`). Nunca dos
 * escrituras separadas del lado del cliente.
 */
export async function editCompletedLessonRegistration(ctx: AuthenticatedDbContext, input: EditCompletedRegistrationInput): Promise<LessonRegistrationRecord> {
  const payload: Record<string, unknown> = {
    lesson_registration_id: input.lessonRegistrationId,
    edit_operation_id: input.editOperationId,
    participants: input.participants.map((p) => ({
      student_id: p.studentId,
      attendance: p.attendance ? { status: p.attendance.status, late_minutes: p.attendance.lateMinutes } : null,
      evaluation: p.evaluation
        ? {
            general_grade: p.evaluation.generalGrade,
            skill_grades: p.evaluation.skillGrades,
            strengths: p.evaluation.strengths,
            areas_to_improve: p.evaluation.areasToImprove,
            individual_observation: p.evaluation.individualObservation,
            individual_homework_description: p.evaluation.individualHomeworkDescription,
            individual_homework_due_date: p.evaluation.individualHomeworkDueDate,
          }
        : null,
      homework_reviews: p.homeworkReviews.map((h) => ({ task_id: h.taskId, outcome: h.outcome })),
    })),
  };
  if (input.homeworkDescription !== undefined) payload.homework_description = input.homeworkDescription;
  if (input.homeworkDueDate !== undefined) payload.homework_due_date = input.homeworkDueDate;
  if (input.countsAsClass !== undefined) payload.counts_as_class = input.countsAsClass;
  if (input.actualStartedAt !== undefined) payload.actual_started_at = input.actualStartedAt;
  if (input.actualEndedAt !== undefined) payload.actual_ended_at = input.actualEndedAt;
  if (input.lateCancellationPolicy !== undefined) payload.late_cancellation_policy = input.lateCancellationPolicy;
  if (input.lateCancellationPercentage !== undefined) payload.late_cancellation_percentage = input.lateCancellationPercentage;

  const { data, error } = await ctx.supabase.rpc("edit_completed_lesson_registration", { p_payload: payload });
  if (error) {
    if (error.code === "P0002") throw new LessonRegistrationNotFoundError("No encontrado.");
    throw error;
  }
  return toLessonRegistrationRecord(data as LessonRegistrationRow);
}

export interface SaveParticipantRegistrationInput {
  lessonRegistrationId: string;
  studentId: string;
  participantStatus: "pending" | "completed" | "omitted" | null;
  attendance: { status: string; lateMinutes: number | null } | null;
  evaluation: {
    generalGrade: number | null;
    skillGrades: Record<string, number>;
    strengths: string[];
    areasToImprove: string[];
    individualObservation: string | null;
    individualHomeworkDescription: string | null;
    individualHomeworkDueDate: string | null;
    billedAmount: number | null;
  } | null;
  homeworkReviews: { taskId: string; outcome: string }[];
}

export async function saveParticipantRegistration(ctx: AuthenticatedDbContext, input: SaveParticipantRegistrationInput): Promise<void> {
  const { error } = await ctx.supabase.rpc("save_participant_registration", {
    p_payload: {
      lesson_registration_id: input.lessonRegistrationId,
      student_id: input.studentId,
      participant_status: input.participantStatus,
      attendance: input.attendance ? { status: input.attendance.status, late_minutes: input.attendance.lateMinutes } : null,
      evaluation: input.evaluation
        ? {
            general_grade: input.evaluation.generalGrade,
            skill_grades: input.evaluation.skillGrades,
            strengths: input.evaluation.strengths,
            areas_to_improve: input.evaluation.areasToImprove,
            individual_observation: input.evaluation.individualObservation,
            individual_homework_description: input.evaluation.individualHomeworkDescription,
            individual_homework_due_date: input.evaluation.individualHomeworkDueDate,
            billed_amount: input.evaluation.billedAmount,
          }
        : null,
      homework_reviews: input.homeworkReviews.map((h) => ({ task_id: h.taskId, outcome: h.outcome })),
    },
  });
  if (error) {
    if (error.code === "P0002") throw new LessonRegistrationNotFoundError("No encontrado.");
    throw error;
  }
}

export interface FinalizeLessonRegistrationInput {
  lessonRegistrationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  billedAmount?: number | null;
  countsAsClass?: boolean;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
}

export async function finalizeLessonRegistration(ctx: AuthenticatedDbContext, input: FinalizeLessonRegistrationInput): Promise<LessonRegistrationRecord> {
  const payload: Record<string, unknown> = { lesson_registration_id: input.lessonRegistrationId };
  if (input.homeworkDescription !== undefined) payload.homework_description = input.homeworkDescription;
  if (input.homeworkDueDate !== undefined) payload.homework_due_date = input.homeworkDueDate;
  if (input.billedAmount !== undefined) payload.billed_amount = input.billedAmount;
  if (input.countsAsClass !== undefined) payload.counts_as_class = input.countsAsClass;
  if (input.actualStartedAt !== undefined) payload.actual_started_at = input.actualStartedAt;
  if (input.actualEndedAt !== undefined) payload.actual_ended_at = input.actualEndedAt;

  const { data, error } = await ctx.supabase.rpc("finalize_lesson_registration", { p_payload: payload });
  if (error) {
    if (error.code === "P0002") throw new LessonRegistrationNotFoundError("No encontrado.");
    throw error;
  }
  return toLessonRegistrationRecord(data as LessonRegistrationRow);
}

/**
 * TODOS los registros del owner (cualquier alumno) anclados dentro de un
 * rango real — fuente para Analíticas financieras (Fase 7: horas
 * dictadas/canceladas/reprogramadas, modalidad, valor programado de la
 * hora). El ancla real es `scheduled_start_at` si existe (clase ligada a
 * Calendario), si no `created_at` (registro ad-hoc sin horario propio,
 * mismo criterio ya usado en `listCompletedRegistrationsForStudentReport`).
 */
export async function listLessonRegistrationsInRange(ctx: AuthenticatedDbContext, rangeStartIso: string, rangeEndIso: string): Promise<LessonRegistrationRecord[]> {
  const { data, error } = await ctx.supabase
    .from("lesson_registrations")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .or(`scheduled_start_at.gte.${rangeStartIso},scheduled_start_at.is.null`)
    .order("scheduled_start_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  const all = (data as LessonRegistrationRow[]).map(toLessonRegistrationRecord);
  return all.filter((r) => {
    const anchor = r.scheduledStartAt ?? r.createdAt;
    return anchor >= rangeStartIso && anchor <= rangeEndIso;
  });
}

/** Roster real (uno por alumno participante) de un conjunto de registros — necesario para "alumnos únicos atendidos" (Fase 7), donde una clase grupal debe expandirse a cada participante real. */
export async function listRosterForRegistrationIds(ctx: AuthenticatedDbContext, registrationIds: string[]): Promise<{ registrationId: string; studentId: string }[]> {
  if (registrationIds.length === 0) return [];
  const { data, error } = await ctx.supabase
    .from("lesson_registration_students")
    .select("lesson_registration_id, student_id")
    .eq("owner_id", ctx.ownerId)
    .in("lesson_registration_id", registrationIds);
  if (error) throw error;
  return (data as Pick<LessonRegistrationStudentRow, "lesson_registration_id" | "student_id">[]).map((row) => ({ registrationId: row.lesson_registration_id, studentId: row.student_id }));
}

/** Forma mínima real que necesita `buildStudentReportData` (Fase 7) — un registro dictado + la asistencia/evaluación de ESE alumno, nunca de otros participantes de una clase compartida. */
export interface RegistrationForStudentReportRow {
  registrationId: string;
  /** Instante real de la clase (programada → real → alta del registro): para mostrar su día en hora de Argentina. */
  anchorAt: string;
  dateKey: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  homeworkDescription: string | null;
  attendance: { status: "presente" | "ausente" | "tarde" | "ausente_aviso" | "sin_registrar"; lateMinutes: number | null } | null;
  evaluation: {
    generalGrade: number | null;
    skillGrades: Record<string, number>;
    strengths: string[];
    areasToImprove: string[];
    individualHomeworkDescription: string | null;
  } | null;
}

/**
 * Clases REALMENTE dictadas de un alumno (`status: 'completed'`,
 * `counts_as_class: true`) con la asistencia/evaluación de ESE alumno —
 * fuente real para Reportes (Fase 7). Nunca incluye `individualObservation`
 * (nota interna) ni ningún campo financiero (`billed_amount`) — la
 * selección de columnas ni los pide.
 */
export async function listCompletedRegistrationsForStudentReport(ctx: AuthenticatedDbContext, studentId: string): Promise<RegistrationForStudentReportRow[]> {
  const registrations = await listLessonRegistrationsForStudent(ctx, studentId);
  const held = registrations.filter((r) => r.status === "completed" && r.countsAsClass);
  if (held.length === 0) return [];

  const registrationIds = held.map((r) => r.id);
  const [attendanceResult, evaluationResult] = await Promise.all([
    ctx.supabase.from("lesson_registration_attendance").select("*").eq("owner_id", ctx.ownerId).eq("student_id", studentId).in("lesson_registration_id", registrationIds),
    ctx.supabase.from("lesson_registration_evaluations").select("*").eq("owner_id", ctx.ownerId).eq("student_id", studentId).in("lesson_registration_id", registrationIds),
  ]);
  if (attendanceResult.error) throw attendanceResult.error;
  if (evaluationResult.error) throw evaluationResult.error;

  const attendanceByRegistrationId = new Map(
    (attendanceResult.data as LessonRegistrationAttendanceRow[]).map((row) => [row.lesson_registration_id, toLessonRegistrationAttendanceRecord(row)])
  );
  const evaluationByRegistrationId = new Map(
    (evaluationResult.data as LessonRegistrationEvaluationRow[]).map((row) => [row.lesson_registration_id, toLessonRegistrationEvaluationRecord(row)])
  );

  return held
    .map((registration) => {
      const anchor = registration.scheduledStartAt ?? registration.actualStartedAt ?? registration.createdAt;
      const attendance = attendanceByRegistrationId.get(registration.id);
      const evaluation = evaluationByRegistrationId.get(registration.id);
      return {
        registrationId: registration.id,
        anchorAt: anchor,
        dateKey: anchor.slice(0, 10),
        scheduledStartAt: registration.scheduledStartAt,
        scheduledEndAt: registration.scheduledEndAt,
        actualStartedAt: registration.actualStartedAt,
        actualEndedAt: registration.actualEndedAt,
        homeworkDescription: registration.homeworkDescription,
        attendance: attendance ? { status: attendance.status, lateMinutes: attendance.lateMinutes } : null,
        evaluation: evaluation
          ? {
              generalGrade: evaluation.generalGrade,
              skillGrades: evaluation.skillGrades,
              strengths: evaluation.strengths,
              areasToImprove: evaluation.areasToImprove,
              individualHomeworkDescription: evaluation.individualHomeworkDescription,
            }
          : null,
      };
    })
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
}
