import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTableByIds } from "@/lib/db/read";
import { instantDateKey } from "@/lib/calendar/civil-calendar";
import { listPendingHomeworkTasksForStudent } from "./lesson-registrations";
import { buildStudentListAggregates, type ListRegistrationRow, type StudentListAggregates } from "@/lib/students/list-aggregates";

/**
 * Datos de la tarjeta de Alumnos que salen de las clases dictadas: «N este mes», promedio de notas y «Tarea pendiente».
 * Sólo se piden para los alumnos que se muestran (la página actual): nunca una consulta por alumno de toda la cuenta.
 * La regla de cada dato es la del perfil (clases dictadas = registros finalizados que cuentan como clase; sólo cuenta la asistencia).
 */
export async function loadStudentListAggregates(ctx: AuthenticatedDbContext, studentIds: string[], todayDateKey: string): Promise<Map<string, StudentListAggregates>> {
  if (studentIds.length === 0) return new Map();
  const rosterRows = await readTableByIds<{ id: string; lesson_registration_id: string; student_id: string }>(ctx.supabase, "lesson_registration_students", {
    columns: "id, lesson_registration_id, student_id",
    matchColumn: "student_id",
    ids: studentIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  const registrationIds = [...new Set(rosterRows.map((row) => row.lesson_registration_id))];
  const registrations = await readTableByIds<{ id: string; status: string; counts_as_class: boolean; scheduled_start_at: string | null; actual_started_at: string | null; created_at: string }>(ctx.supabase, "lesson_registrations", {
    columns: "id, status, counts_as_class, scheduled_start_at, actual_started_at, created_at",
    matchColumn: "id",
    ids: registrationIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "completed").eq("counts_as_class", true),
  });
  const held = new Map(registrations.map((row) => [row.id, row]));
  const heldIds = [...held.keys()];
  const [attendance, evaluations] = await Promise.all([
    readTableByIds<{ id: string; lesson_registration_id: string; student_id: string; status: string }>(ctx.supabase, "lesson_registration_attendance", {
      columns: "id, lesson_registration_id, student_id, status",
      matchColumn: "lesson_registration_id",
      ids: heldIds,
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    }),
    readTableByIds<{ id: string; lesson_registration_id: string; student_id: string; general_grade: number | null }>(ctx.supabase, "lesson_registration_evaluations", {
      columns: "id, lesson_registration_id, student_id, general_grade",
      matchColumn: "lesson_registration_id",
      ids: heldIds,
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    }),
  ]);
  const attendanceKey = new Map(attendance.map((row) => [`${row.lesson_registration_id}|${row.student_id}`, row.status]));
  const gradeKey = new Map(evaluations.map((row) => [`${row.lesson_registration_id}|${row.student_id}`, row.general_grade === null ? null : Number(row.general_grade)]));
  const rows: ListRegistrationRow[] = [];
  for (const roster of rosterRows) {
    const registration = held.get(roster.lesson_registration_id);
    if (!registration) continue;
    const key = `${roster.lesson_registration_id}|${roster.student_id}`;
    rows.push({
      studentId: roster.student_id,
      dateKey: instantDateKey(registration.scheduled_start_at ?? registration.actual_started_at ?? registration.created_at),
      attendanceStatus: attendanceKey.get(key) ?? null,
      generalGrade: gradeKey.get(key) ?? null,
    });
  }
  const aggregates = buildStudentListAggregates(rows, studentIds, todayDateKey);
  // «Tarea pendiente»: misma fuente que la pestaña Tareas del perfil (alias y revisiones incluidos), sólo para los alumnos visibles.
  await Promise.all(
    studentIds.map(async (studentId) => {
      const tasks = await listPendingHomeworkTasksForStudent(ctx, studentId);
      const current = aggregates.get(studentId);
      if (current) aggregates.set(studentId, { ...current, hasPendingHomework: tasks.length > 0 });
    }),
  );
  return aggregates;
}
