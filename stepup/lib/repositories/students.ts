import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { StudentRow, StudentStatus } from "@/lib/db/database.types";
import {
  toStudentRecord,
  validateNewStudentInput,
  validateUpdateStudentInput,
  studentInputToRpcPayload,
  updateInputToRowPatch,
  type StudentRecord,
  type NewStudentInput,
  type UpdateStudentInput,
  type StudentDuplicateCandidate,
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
export type { StudentRecord, NewStudentInput, UpdateStudentInput, StudentDuplicateCandidate } from "./students-mapping";

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

export interface CreateStudentOptions {
  /**
   * Id del borrador ("claim") reclamado server-side por
   * `claimStudentCreation()` (ver `lib/repositories/student-drafts.ts`) —
   * NUNCA un id generado en el navegador. La identidad real de la
   * operación de alta vive enteramente en el servidor; este repositorio
   * sólo la reenvía tal cual la recibió de la página.
   */
  claimId: string;
  /** true sólo en el reenvío explícito "Es otra persona, crear igualmente". */
  confirmDuplicate?: boolean;
}

export type CreateStudentResult =
  | { status: "created"; student: StudentRecord; replayed: boolean }
  | { status: "possible_duplicate"; candidates: StudentDuplicateCandidate[] };

interface CreateStudentViaWebRow {
  status: "created" | "possible_duplicate";
  student_id: string | null;
  replayed: boolean;
  candidates: Array<{ id: string; name: string; phone: string | null; email: string | null; match_signals: string[] }> | null;
}

/**
 * Crea un alumno nuevo sobre un borrador ya reclamado — coordinada (Fase
 * 2, corrección de carrera real): pasa siempre por la RPC
 * `create_student_via_web`, NUNCA un `.insert()` directo (esa RPC
 * comparte el mismo advisory lock por owner que `apply_backup_import`,
 * así una alta manual nunca puede entrelazarse con una importación de
 * respaldo en curso). Nunca genera el `id`/`owner_id` fuera del servidor;
 * los candidatos de posible duplicado tampoco se generan acá — el
 * servidor los calcula, almacena y revalida enteramente dentro de la RPC.
 */
export async function createStudent(
  ctx: AuthenticatedDbContext,
  input: NewStudentInput,
  options: CreateStudentOptions
): Promise<CreateStudentResult> {
  const errors = validateNewStudentInput(input);
  if (errors.length > 0) {
    throw new Error(`Alumno inválido: ${errors.map((e) => e.message).join(" ")}`);
  }
  const { data, error } = await ctx.supabase.rpc("create_student_via_web", {
    p_claim_id: options.claimId,
    p_payload: studentInputToRpcPayload(input),
    p_confirm_duplicate: options.confirmDuplicate ?? false,
  });
  if (error) throw error;
  const row = (data as CreateStudentViaWebRow[])[0];
  if (!row) throw new Error("La creación del alumno no devolvió resultado.");

  if (row.status === "possible_duplicate") {
    return {
      status: "possible_duplicate",
      candidates: (row.candidates ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        matchSignals: c.match_signals ?? [],
      })),
    };
  }

  if (!row.student_id) throw new Error("El alumno se creó pero no se devolvió su id.");
  const created = await getStudent(ctx, row.student_id);
  if (!created) throw new Error("El alumno se creó pero no se pudo leer.");
  return { status: "created", student: created, replayed: row.replayed };
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
