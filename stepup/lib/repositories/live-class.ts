import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import type { LiveClassSession } from "@/lib/live-class/live-class";
import type { ClassStartSource, ScheduleAdjustment, StudentArrival } from "@/lib/payments/engine/features/new-class/types";

interface LiveClassSessionRow {
  owner_id: string;
  calendar_lesson_id: string;
  scheduled_duration_minutes: number;
  started_at: string;
  scheduled_start_at: string;
  effective_start_at: string;
  schedule_adjustment: ScheduleAdjustment | null;
  student_arrival: StudentArrival;
  start_source: ClassStartSource;
}

/** Nombres y estado de la clase en curso, tal como están en el calendario. */
interface LessonRow {
  id: string;
  student_name: string;
  status: string;
  primary_student_id: string | null;
}
interface ParticipantRow {
  id: string;
  calendar_lesson_id: string;
  student_name: string;
  created_at: string;
}

export function toLiveClassSession(row: LiveClassSessionRow, lesson: LessonRow | null, participantNames: string[]): LiveClassSession {
  return {
    calendarLessonId: row.calendar_lesson_id,
    primaryStudentId: lesson?.primary_student_id ?? null,
    studentNames: participantNames.length > 0 ? participantNames : lesson?.student_name ? [lesson.student_name] : ["Alumno"],
    scheduledDurationMinutes: row.scheduled_duration_minutes,
    startedAt: row.started_at,
    scheduledStartAt: row.scheduled_start_at,
    effectiveStartAt: row.effective_start_at,
    scheduleAdjustment: row.schedule_adjustment,
    studentArrival: row.student_arrival,
    startSource: row.start_source,
    lessonStillScheduled: lesson?.status === "scheduled",
  };
}

/** La clase en curso de la profesora, o `null`. Sólo lectura. */
export async function getLiveClassSession(ctx: AuthenticatedDbContext): Promise<LiveClassSession | null> {
  const rows = await readTable<LiveClassSessionRow>(ctx.supabase, "live_class_sessions", {
    columns: "owner_id, calendar_lesson_id, scheduled_duration_minutes, started_at, scheduled_start_at, effective_start_at, schedule_adjustment, student_arrival, start_source",
    idColumn: "owner_id",
    order: [{ column: "owner_id", ascending: true }],
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  const row = rows[0];
  if (!row) return null;
  const [lessons, participants] = await Promise.all([
    readTableByIds<LessonRow>(ctx.supabase, "calendar_lessons", { columns: "id, student_name, status, primary_student_id", matchColumn: "id", ids: [row.calendar_lesson_id], filter: (query) => query.eq("owner_id", ctx.ownerId) }),
    readTableByIds<ParticipantRow>(ctx.supabase, "calendar_lesson_participants", {
      columns: "id, calendar_lesson_id, student_name, created_at",
      matchColumn: "calendar_lesson_id",
      ids: [row.calendar_lesson_id],
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    }),
  ]);
  const names = [...participants].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map((participant) => participant.student_name);
  return toLiveClassSession(row, lessons[0] ?? null, names);
}

/** Comienza la clase (idempotente: repetir con la misma clase devuelve la misma sesión). Los errores de dominio salen con su mensaje (P0001/22023/P0002). */
export async function startLiveClass(ctx: AuthenticatedDbContext, calendarLessonId: string, arrival: StudentArrival): Promise<void> {
  const { error } = await ctx.supabase.rpc("start_live_class", { p_calendar_lesson_id: calendarLessonId, p_arrival: arrival });
  if (error) throw error;
}

/** «Corregir hora de inicio». */
export async function correctLiveClassStart(ctx: AuthenticatedDbContext, startedAtIso: string): Promise<void> {
  const { error } = await ctx.supabase.rpc("correct_live_class_start", { p_started_at: startedAtIso });
  if (error) throw error;
}

/** Descarta la clase en curso sin registrar nada. Devuelve `false` si ya no había ninguna. */
export async function discardLiveClass(ctx: AuthenticatedDbContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("discard_live_class");
  if (error) throw error;
  return data === true;
}

export interface FinishedLiveClass {
  calendarLessonId: string;
  elapsedMinutes: number;
  applied: boolean;
}

/** Finaliza la clase: vuelca inicio/fin reales y puntualidad al registro en borrador y cierra la sesión, en una sola operación. */
export async function finishLiveClass(ctx: AuthenticatedDbContext): Promise<FinishedLiveClass> {
  const { data, error } = await ctx.supabase.rpc("finish_live_class");
  if (error) throw error;
  const value = data as { calendar_lesson_id: string; elapsed_minutes: number; applied: boolean };
  return { calendarLessonId: value.calendar_lesson_id, elapsedMinutes: value.elapsed_minutes, applied: value.applied };
}
