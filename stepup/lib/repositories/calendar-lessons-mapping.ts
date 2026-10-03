import { parseOperationId } from "../calendar/operation-id.ts";
import type { ActivityKind, CalendarLessonRow, CalendarLessonStatus, CalendarLessonType, CalendarModality } from "../db/database.types.ts";

/**
 * Lógica PURA del repositorio de clases materializadas — separada para
 * poder probarla con `node --test` sin Supabase/Next.
 */
export interface CalendarLessonRecord {
  id: string;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: CalendarLessonType;
  startAt: string;
  endAt: string;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  isRecurring: boolean;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  recurrenceIndex: number | null;
  recurrenceOriginalStart: string | null;
  classTitle: string | null;
  freedByLessonId: string | null;
  activityKind: ActivityKind;
  notes: string | null;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function toCalendarLessonRecord(row: CalendarLessonRow, participantIds: string[]): CalendarLessonRecord {
  return {
    id: row.id,
    primaryStudentId: row.primary_student_id,
    studentName: row.student_name,
    level: row.level,
    lessonType: row.lesson_type,
    startAt: row.start_at,
    endAt: row.end_at,
    modality: row.modality,
    status: row.status,
    isRecurring: row.is_recurring,
    recurrenceId: row.recurrence_id,
    recurrenceOccurrenceKey: row.recurrence_occurrence_key,
    recurrenceIndex: row.recurrence_index,
    recurrenceOriginalStart: row.recurrence_original_start,
    classTitle: row.class_title,
    freedByLessonId: row.freed_by_lesson_id,
    activityKind: row.activity_kind,
    notes: row.notes,
    participantIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LessonParticipantInput {
  studentId: string;
  studentName: string;
  level: string;
}

export interface NewSingleLessonInput {
  /** UUID estable del borrador, generado una sola vez en el cliente — idempotencia real de la creación (20261001150000). Nunca se genera acá ni en la Server Action. */
  operationId: string;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: CalendarLessonType;
  startAt: string;
  endAt: string;
  modality: CalendarModality;
  classTitle: string | null;
  activityKind: ActivityKind;
  notes: string | null;
  color: string;
  participants: LessonParticipantInput[];
  /** Sólo cuando esta clase nace de "Reemplazar con otro alumno" sobre una cancelada. */
  freedByLessonId?: string | null;
}

export interface LessonValidationError {
  field: string;
  message: string;
}

export function validateNewSingleLessonInput(input: NewSingleLessonInput): LessonValidationError[] {
  const errors: LessonValidationError[] = [];
  if (!parseOperationId(input.operationId)) errors.push({ field: "operationId", message: "Falta la clave de idempotencia de la operación." });
  if (input.participants.length === 0) errors.push({ field: "participants", message: "Elegí al menos un alumno." });
  if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
    errors.push({ field: "endAt", message: "El horario de fin debe ser posterior al de inicio." });
  }
  return errors;
}

export function singleLessonInputToPayload(input: NewSingleLessonInput): Record<string, unknown> {
  return {
    operation_id: input.operationId,
    primary_student_id: input.primaryStudentId,
    student_name: input.studentName,
    level: input.level,
    lesson_type: input.lessonType,
    start_at: input.startAt,
    end_at: input.endAt,
    modality: input.modality,
    class_title: input.classTitle,
    activity_kind: input.activityKind,
    notes: input.notes,
    color: input.color,
    freed_by_lesson_id: input.freedByLessonId ?? null,
    participants: input.participants.map((p) => ({ student_id: p.studentId, student_name: p.studentName, level: p.level })),
  };
}
