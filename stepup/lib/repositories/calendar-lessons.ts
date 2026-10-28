import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { ClosedOutcome } from "@/lib/calendar/types";
import type { CalendarLessonParticipantRow, CalendarLessonRow } from "@/lib/db/database.types";
import { readTable, readTableByIds } from "@/lib/db/read";
import {
  toCalendarLessonRecord,
  validateNewSingleLessonInput,
  singleLessonInputToPayload,
  type CalendarLessonRecord,
  type NewSingleLessonInput,
} from "./calendar-lessons-mapping";

/**
 * Repositorio de clases materializadas — única puerta de entrada real a
 * `calendar_lessons`/`calendar_lesson_participants`.
 */
export type { CalendarLessonRecord, NewSingleLessonInput } from "./calendar-lessons-mapping";

export class CalendarLessonNotFoundError extends Error {}



async function attachParticipants(ctx: AuthenticatedDbContext, rows: CalendarLessonRow[]): Promise<CalendarLessonRecord[]> {
  if (rows.length === 0) return [];
  // R2: ids en lotes de 100 (nunca una lista ilimitada en la URL) y cada lote paginado; un fallo en cualquier lote falla todo.
  const data = await readTableByIds<Pick<CalendarLessonParticipantRow, "calendar_lesson_id" | "student_id"> & { id: string; created_at: string }>(
    ctx.supabase,
    "calendar_lesson_participants",
    {
      columns: "id, calendar_lesson_id, student_id, created_at",
      matchColumn: "calendar_lesson_id",
      ids: rows.map((row) => row.id),
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    }
  );
  const byLesson = new Map<string, string[]>();
  data.forEach((participant) => {
    const list = byLesson.get(participant.calendar_lesson_id) ?? [];
    list.push(participant.student_id);
    byLesson.set(participant.calendar_lesson_id, list);
  });
  const closed = await loadClosedOutcomes(ctx, rows.filter((row) => row.status === "completed").map((row) => row.id));
  return rows.map((row) => ({ ...toCalendarLessonRecord(row, byLesson.get(row.id) ?? []), ...(closed.has(row.id) ? { closedOutcome: closed.get(row.id) } : {}) }));
}

const CLOSED_OUTCOMES: readonly ClosedOutcome[] = ["cancelada_tarde", "profesora_ausente", "alumno_ausente", "feriado"];

/** Resultado de las clases completadas cuyo registro NO se dictó: sólo para rotularlas bien en el Calendario (nunca toca cobros ni asistencia). */
async function loadClosedOutcomes(ctx: AuthenticatedDbContext, lessonIds: string[]): Promise<Map<string, ClosedOutcome>> {
  const result = new Map<string, ClosedOutcome>();
  if (lessonIds.length === 0) return result;
  const data = await readTableByIds<{ id: string; calendar_lesson_id: string; outcome: string }>(ctx.supabase, "lesson_registrations", {
    columns: "id, calendar_lesson_id, outcome",
    matchColumn: "calendar_lesson_id",
    ids: lessonIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("counts_as_class", false),
  });
  for (const row of data) if ((CLOSED_OUTCOMES as readonly string[]).includes(row.outcome)) result.set(row.calendar_lesson_id, row.outcome as ClosedOutcome);
  return result;
}

/** ¿Existe al menos una clase materializada (de cualquier fecha y estado)? Lectura mínima: una fila, sin traer datos. */
export async function hasAnyCalendarLesson(ctx: AuthenticatedDbContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.from("calendar_lessons").select("id").eq("owner_id", ctx.ownerId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Clases materializadas cuyo `start_at` cae dentro de `[rangeStartIso, rangeEndIso]` — suficiente para pintar semana/día. */
export async function listCalendarLessonsInRange(ctx: AuthenticatedDbContext, rangeStartIso: string, rangeEndIso: string): Promise<CalendarLessonRecord[]> {
  const data = await readTable<CalendarLessonRow>(ctx.supabase, "calendar_lessons", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).gte("start_at", rangeStartIso).lte("start_at", rangeEndIso),
  });
  return attachParticipants(ctx, data);
}

/**
 * Lo mínimo de TODAS las clases de serie de la cuenta (cualquier fecha y estado): sirve para reconocer qué ocurrencias de una serie ya tienen su clase aunque esa clase haya sido movida o ajustada fuera
 * del rango que se está mirando. Una lectura liviana (cuatro columnas), nunca la historia completa de cada clase.
 */
export async function listRecurringLessonMarkers(ctx: AuthenticatedDbContext): Promise<Array<{ id: string; recurrenceId: string; recurrenceOccurrenceKey: string; status: CalendarLessonRow["status"] }>> {
  const data = await readTable<Pick<CalendarLessonRow, "id" | "recurrence_id" | "recurrence_occurrence_key" | "status">>(ctx.supabase, "calendar_lessons", {
    columns: "id, recurrence_id, recurrence_occurrence_key, status",
    filter: (query) => query.eq("owner_id", ctx.ownerId).not("recurrence_id", "is", null).not("recurrence_occurrence_key", "is", null),
  });
  return data.flatMap((row) => (row.recurrence_id && row.recurrence_occurrence_key ? [{ id: row.id, recurrenceId: row.recurrence_id, recurrenceOccurrenceKey: row.recurrence_occurrence_key, status: row.status }] : []));
}

/** Todas las clases materializadas de una regla (cualquier fecha) — usado para saber qué ocurrencias ya NO son vírgenes antes de congelar participantes. */
export async function listCalendarLessonsForRecurrence(ctx: AuthenticatedDbContext, recurrenceId: string): Promise<CalendarLessonRecord[]> {
  const data = await readTable<CalendarLessonRow>(ctx.supabase, "calendar_lessons", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("recurrence_id", recurrenceId),
  });
  return attachParticipants(ctx, data);
}

/**
 * Clases sueltas futuras `scheduled` (sin recurrencia) donde el alumno es
 * primario o participante, desde `fromIso` en adelante — usado por la poda
 * de agenda al archivar (Fase 10). Nunca incluye pasado/completadas/
 * canceladas/reprogramadas ni ocurrencias de una serie (esas se podan por
 * `recurrence_id`, no acá).
 */
export async function listLooseFutureScheduledLessonsForStudent(
  ctx: AuthenticatedDbContext,
  studentId: string,
  fromIso: string
): Promise<CalendarLessonRecord[]> {
  const [asPrimary, participantRows] = await Promise.all([
    readTable<CalendarLessonRow>(ctx.supabase, "calendar_lessons", {
      filter: (query) =>
        query.eq("owner_id", ctx.ownerId).eq("status", "scheduled").is("recurrence_id", null).eq("primary_student_id", studentId).gte("start_at", fromIso),
    }),
    readTable<{ id: string; calendar_lesson_id: string }>(ctx.supabase, "calendar_lesson_participants", {
      columns: "id, calendar_lesson_id",
      filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    }),
  ]);

  const participantLessonIds = participantRows.map((r) => r.calendar_lesson_id);
  const asParticipant = await readTableByIds<CalendarLessonRow>(ctx.supabase, "calendar_lessons", {
    matchColumn: "id",
    ids: participantLessonIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "scheduled").is("recurrence_id", null).gte("start_at", fromIso),
  });

  const byId = new Map<string, CalendarLessonRow>();
  for (const row of [...asPrimary, ...asParticipant]) byId.set(row.id, row);
  return attachParticipants(ctx, [...byId.values()]);
}

/** Filas reales (`calendar_lesson_participants`, con nombre/nivel congelados y `created_at`) de un conjunto de clases — usado para elegir a quién promover de forma determinística en una clase suelta. */
export async function listLessonParticipantRows(ctx: AuthenticatedDbContext, lessonIds: string[]): Promise<CalendarLessonParticipantRow[]> {
  if (lessonIds.length === 0) return [];
  return readTableByIds<CalendarLessonParticipantRow>(ctx.supabase, "calendar_lesson_participants", {
    matchColumn: "calendar_lesson_id",
    ids: lessonIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
}

export async function getCalendarLesson(ctx: AuthenticatedDbContext, id: string): Promise<CalendarLessonRecord | null> {
  const { data, error } = await ctx.supabase.from("calendar_lessons").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [record] = await attachParticipants(ctx, [data as CalendarLessonRow]);
  return record;
}

/**
 * ¿Ya existe la clase creada con esta clave de idempotencia? Sólo un atajo de
 * UX para la Server Action (un reintento tras respuesta perdida no debe chocar
 * con el solapamiento de la clase que ella misma creó) — NUNCA la garantía de
 * unicidad: esa la decide el índice UNIQUE parcial dentro de la RPC.
 */
export async function findCalendarLessonIdByOperationId(ctx: AuthenticatedDbContext, operationId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase.from("calendar_lessons").select("id").eq("owner_id", ctx.ownerId).eq("operation_id", operationId).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Crea una clase única (sin recurrencia) + participantes, atómico e idempotente por `operationId` (RPC). */
export async function createSingleLesson(ctx: AuthenticatedDbContext, input: NewSingleLessonInput): Promise<CalendarLessonRecord> {
  const errors = validateNewSingleLessonInput(input);
  if (errors.length > 0) throw new Error(`Clase inválida: ${errors.map((e) => e.message).join(" ")}`);

  const { data, error } = await ctx.supabase.rpc("create_calendar_lesson", { p_payload: singleLessonInputToPayload(input) });
  if (error) throw error;
  const row = data as CalendarLessonRow;
  return toCalendarLessonRecord(
    row,
    input.participants.map((p) => p.studentId)
  );
}

export interface CancelOccurrenceInput {
  lessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: "individual" | "group";
  startAt: string;
  endAt: string;
  modality: string;
  classTitle: string | null;
  activityKind: string;
  color: string;
}

/** Cancela una ocurrencia (virtual o materializada) — atómico e idempotente (RPC). */
export async function cancelCalendarOccurrence(ctx: AuthenticatedDbContext, input: CancelOccurrenceInput): Promise<CalendarLessonRecord> {
  const { data, error } = await ctx.supabase.rpc("cancel_calendar_occurrence", {
    p_payload: {
      lesson_id: input.lessonId,
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
      color: input.color,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new CalendarLessonNotFoundError("Clase no encontrada.");
    throw error;
  }
  const row = data as CalendarLessonRow;
  return toCalendarLessonRecord(row, []);
}

export interface RescheduleOccurrenceInput {
  recurrenceId: string | null;
  occurrenceKey: string | null;
  originalLessonId: string | null;
  originalStartAt: string;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: "individual" | "group";
  newStartAt: string;
  newEndAt: string;
  modality: string;
  classTitle: string | null;
  activityKind: string;
  color: string;
  participants: { studentId: string; studentName: string; level: string }[];
}

/** Reprograma una ocurrencia — nueva clase en el horario nuevo + excepción/estado en el origen. Atómico (RPC). */
export async function rescheduleCalendarOccurrence(ctx: AuthenticatedDbContext, input: RescheduleOccurrenceInput): Promise<CalendarLessonRecord> {
  const { data, error } = await ctx.supabase.rpc("reschedule_calendar_occurrence", {
    p_payload: {
      recurrence_id: input.recurrenceId,
      occurrence_key: input.occurrenceKey,
      original_lesson_id: input.originalLessonId,
      original_start_at: input.originalStartAt,
      primary_student_id: input.primaryStudentId,
      student_name: input.studentName,
      level: input.level,
      lesson_type: input.lessonType,
      new_start_at: input.newStartAt,
      new_end_at: input.newEndAt,
      modality: input.modality,
      class_title: input.classTitle,
      activity_kind: input.activityKind,
      color: input.color,
      participants: input.participants.map((p) => ({ student_id: p.studentId, student_name: p.studentName, level: p.level })),
    },
  });
  if (error) throw error;
  const row = data as CalendarLessonRow;
  return toCalendarLessonRecord(
    row,
    input.participants.map((p) => p.studentId)
  );
}

export interface EditCalendarLessonInput {
  /** Clase ya creada, o `null` si es una ocurrencia virtual de una serie (se materializa en su horario). */
  lessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  /** Sólo hace falta si hay que materializar la ocurrencia: los datos de la clase tal como se ve, con los alumnos ya resueltos en el servidor. */
  base?: {
    primaryStudentId: string;
    studentName: string;
    level: string;
    lessonType: string;
    startAt: string;
    endAt: string;
    modality: string;
    color: string;
    recurrenceIndex: number | null;
    classTitle: string | null;
    activityKind: string;
    participants: { studentId: string; studentName: string; level: string }[];
  };
  /** Sólo se cambian las claves presentes; `classTitle: null` vuelve al nombre automático. */
  changes: { classTitle?: string | null; endAt?: string };
}

/** Nombre y/o duración de UNA clase («sólo esta clase») con `edit_calendar_lesson` (una transacción; materializa la ocurrencia si hace falta). */
export async function editCalendarLesson(ctx: AuthenticatedDbContext, input: EditCalendarLessonInput): Promise<CalendarLessonRecord> {
  const changes: Record<string, unknown> = {};
  if ("classTitle" in input.changes) changes.class_title = input.changes.classTitle ?? null;
  if (input.changes.endAt !== undefined) changes.end_at = input.changes.endAt;
  const base = input.base;
  const { data, error } = await ctx.supabase.rpc("edit_calendar_lesson", {
    p_payload: {
      lesson_id: input.lessonId,
      recurrence_id: input.recurrenceId,
      occurrence_key: input.occurrenceKey,
      base: base
        ? {
            primary_student_id: base.primaryStudentId,
            student_name: base.studentName,
            level: base.level,
            lesson_type: base.lessonType,
            start_at: base.startAt,
            end_at: base.endAt,
            modality: base.modality,
            color: base.color,
            recurrence_index: base.recurrenceIndex,
            class_title: base.classTitle,
            activity_kind: base.activityKind,
            participants: base.participants.map((p) => ({ student_id: p.studentId, student_name: p.studentName, level: p.level })),
          }
        : null,
      changes,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new CalendarLessonNotFoundError("Clase no encontrada.");
    throw error;
  }
  return toCalendarLessonRecord(data as CalendarLessonRow, []);
}

/** Vuelve a dejar activa la fecha original de una ocurrencia cancelada o reprogramada (`restore_calendar_occurrence`). */
export async function restoreCalendarOccurrence(ctx: AuthenticatedDbContext, lessonId: string): Promise<CalendarLessonRecord> {
  const { data, error } = await ctx.supabase.rpc("restore_calendar_occurrence", { p_payload: { lesson_id: lessonId } });
  if (error) {
    if (error.code === "P0002") throw new CalendarLessonNotFoundError("Clase no encontrada.");
    throw error;
  }
  return toCalendarLessonRecord(data as CalendarLessonRow, []);
}

/** Elimina la tarjeta de una clase cancelada y excluye su fecha de la serie (`delete_cancelled_calendar_lesson`). Repetirlo no es un error: `deleted: false`. */
export async function deleteCancelledCalendarLesson(ctx: AuthenticatedDbContext, lessonId: string): Promise<{ deleted: boolean }> {
  const { data, error } = await ctx.supabase.rpc("delete_cancelled_calendar_lesson", { p_payload: { lesson_id: lessonId } });
  if (error) throw error;
  return { deleted: Boolean((data as { deleted?: boolean } | null)?.deleted) };
}
