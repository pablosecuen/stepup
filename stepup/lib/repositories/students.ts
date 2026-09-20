import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { StudentRow, StudentStatus } from "@/lib/db/database.types";
import {
  toStudentRecord,
  validateNewStudentInput,
  validateUpdateStudentInput,
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

/**
 * Actualiza un alumno propio. `.single()` exige exactamente una fila
 * afectada — si el id no existe o pertenece a otro profesor (RLS lo
 * excluye igual que el filtro explícito de `owner_id`), Postgres/PostgREST
 * devuelven 0 filas y `.single()` falla con `PGRST116`, que se traduce acá
 * a `StudentNotFoundError` — nunca se distingue "no existe" de "no
 * autorizado" en el mensaje (mismo criterio anti-enumeración que el resto
 * de la app), pero la ruta que lo llama sí puede tratarlo como 404 real.
 */
export async function updateStudent(
  ctx: AuthenticatedDbContext,
  id: string,
  patch: UpdateStudentInput
): Promise<StudentRecord> {
  const errors = validateUpdateStudentInput(patch);
  if (errors.length > 0) {
    throw new Error(`Alumno inválido: ${errors.map((e) => e.message).join(" ")}`);
  }
  const { data, error } = await ctx.supabase
    .from("students")
    .update(updateInputToRowPatch(patch))
    .eq("owner_id", ctx.ownerId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new StudentNotFoundError("Alumno no encontrado.");
    throw error;
  }
  return toStudentRecord(data as StudentRow);
}

export class StudentNotFoundError extends Error {}

/**
 * Cambio de estado — espeja applyStatusChange del móvil: actualiza
 * `status`/`status_change_date` y agrega una entrada a
 * `student_status_history`. Nunca borra nada.
 *
 * Corrección Fase 2 (a pedido explícito — "cada cambio debe ser atómico"):
 * usa el RPC `change_student_status` (ver
 * `supabase/migrations/20260920120000_student_mutation_rpcs.sql`), una
 * única transacción real de Postgres — nunca dos escrituras secuenciales
 * que puedan quedar a medias si la segunda falla.
 *
 * La versión completa con poda de series futuras (equivalente a
 * `archiveStudent` con `removeFromFuture: true`) depende de
 * `recurrence_rules`/`calendar_lessons` con datos reales — Fase 3.
 */
export async function changeStudentStatus(
  ctx: AuthenticatedDbContext,
  id: string,
  input: { status: StudentStatus; occurredOn: string; reason?: string; internalNote?: string }
): Promise<StudentRecord> {
  const { data, error } = await ctx.supabase.rpc("change_student_status", {
    p_student_id: id,
    p_status: input.status,
    p_occurred_on: input.occurredOn,
    p_reason: input.reason ?? null,
    p_internal_note: input.internalNote ?? null,
  });
  if (error) {
    if (error.code === "P0002") throw new StudentNotFoundError("Alumno no encontrado.");
    throw error;
  }
  return toStudentRecord(data as StudentRow);
}
