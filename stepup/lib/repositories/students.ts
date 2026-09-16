import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { StudentRow, StudentStatus } from "@/lib/db/database.types";
import {
  toStudentRecord,
  validateNewStudentInput,
  studentInputToRowPatch,
  updateInputToRowPatch,
  type StudentRecord,
  type NewStudentInput,
  type UpdateStudentInput,
} from "./students-mapping";

/**
 * Repositorio de Alumnos — única puerta de entrada real (I/O) a la tabla
 * `students` desde componentes/acciones web. Ningún componente debe llamar
 * a `supabase.from("students")` directamente — evita consultas dispersas
 * (Fase 1, requisito explícito). La lógica pura (mapeo/validación) vive en
 * `students-mapping.ts`, separada para poder probarla con `node --test`
 * sin depender de Supabase/Next — este archivo es sólo el pegamento de red.
 *
 * Espeja StudentListItem + StudentProfile del móvil (unificados — ver
 * comentario de supabase/migrations/20260916120100_students.sql). Los
 * campos calculados en el móvil en el momento de leer (próxima clase,
 * pagos, promedio, etc.) NO viven acá — se agregan en la Fase 2 como
 * consultas/vistas separadas que cruzan calendar_lessons/payment_charges,
 * nunca duplicados como columna.
 */
export type { StudentRecord, NewStudentInput, UpdateStudentInput } from "./students-mapping";

/**
 * Lista todos los alumnos del profesor autenticado. RLS ya garantiza el
 * aislamiento (`owner_id = auth.uid()`); el filtro explícito de abajo es
 * defensa en profundidad, nunca la única barrera.
 */
export async function listStudents(ctx: AuthenticatedDbContext): Promise<StudentRecord[]> {
  const { data, error } = await ctx.supabase
    .from("students")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as StudentRow[]).map(toStudentRecord);
}

export async function getStudent(ctx: AuthenticatedDbContext, id: string): Promise<StudentRecord | null> {
  const { data, error } = await ctx.supabase
    .from("students")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toStudentRecord(data as StudentRow) : null;
}

/**
 * Crea un alumno nuevo. Nunca genera el `id`/`owner_id` fuera de este
 * repositorio (el default `gen_random_uuid()` de la base decide el id
 * real; `owner_id` siempre viene de la sesión autenticada, nunca de un
 * argumento del llamador).
 */
export async function createStudent(
  ctx: AuthenticatedDbContext,
  input: NewStudentInput
): Promise<StudentRecord> {
  const errors = validateNewStudentInput(input);
  if (errors.length > 0) {
    throw new Error(`Alumno inválido: ${errors.map((e) => e.message).join(" ")}`);
  }
  const { data, error } = await ctx.supabase
    .from("students")
    .insert(studentInputToRowPatch(input, ctx.ownerId))
    .select("*")
    .single();
  if (error) throw error;
  return toStudentRecord(data as StudentRow);
}

export async function updateStudent(
  ctx: AuthenticatedDbContext,
  id: string,
  patch: UpdateStudentInput
): Promise<StudentRecord> {
  const { data, error } = await ctx.supabase
    .from("students")
    .update(updateInputToRowPatch(patch))
    .eq("owner_id", ctx.ownerId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toStudentRecord(data as StudentRow);
}

/**
 * Cambio de estado — espeja applyStatusChange del móvil: sólo actualiza
 * `status`/`status_change_date` y agrega una entrada a
 * `student_status_history`. Nunca borra nada. La versión completa con
 * poda de series futuras (equivalente a `archiveStudent` con
 * `removeFromFuture: true`) queda para la Fase 2, cuando
 * recurrence_rules/calendar_lessons ya tengan datos reales que podar.
 */
export async function changeStudentStatus(
  ctx: AuthenticatedDbContext,
  id: string,
  input: { status: StudentStatus; occurredOn: string; reason?: string; internalNote?: string }
): Promise<StudentRecord> {
  const { error: historyError } = await ctx.supabase.from("student_status_history").insert({
    owner_id: ctx.ownerId,
    student_id: id,
    status: input.status,
    occurred_on: input.occurredOn,
    reason: input.reason ?? null,
    internal_note: input.internalNote ?? null,
  });
  if (historyError) throw historyError;

  const { data, error } = await ctx.supabase
    .from("students")
    .update({ status: input.status, status_change_date: input.occurredOn })
    .eq("owner_id", ctx.ownerId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toStudentRecord(data as StudentRow);
}
