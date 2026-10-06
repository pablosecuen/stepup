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
import { listActiveRecurrenceRulesForStudent, listRuleParticipantsWithCreatedAt } from "./recurrence-rules";
import { listCalendarLessonsForRecurrence, listLooseFutureScheduledLessonsForStudent, listLessonParticipantRows } from "./calendar-lessons";
import {
  planArchiveStudentPrune,
  type RuleForPrune,
  type RuleParticipantForPrune,
  type LooseLessonForPrune,
} from "@/lib/students/archive-prune-plan";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { readTable } from "@/lib/db/read";

const ARGENTINA_TIMEZONE = "America/Argentina/Buenos_Aires";

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
  // R2: lectura COMPLETA por páginas (nunca truncada en `max_rows`), mismo orden de antes (nombre) + `id` como desempate estable.
  const rows = await readTable<StudentRow>(ctx.supabase, "students", {
    filter: (query) => query.eq("owner_id", ctx.ownerId),
    order: [
      { column: "name", ascending: true },
      { column: "id", ascending: true },
    ],
  });
  return rows.map(toStudentRecord);
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
   * Clave de la operación de alta (UUID) que genera el navegador UNA vez por borrador (`useDraftOperationId`,
   * sessionStorage) y que la RPC `create_student_with_operation` usa como idempotencia por profesora: el claim nace ahí,
   * al enviar — cargar la página nunca escribe. La clave sólo identifica la operación dentro de la profesora; la
   * autorización y el `owner_id` siguen siendo del servidor.
   */
  operationId: string;
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
 * Crea un alumno nuevo — idempotente por clave de operación y coordinada (Fase
 * 2, corrección de carrera real): pasa siempre por la RPC
 * `create_student_with_operation`, NUNCA un `.insert()` directo (esa RPC
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
  const { data, error } = await ctx.supabase.rpc("create_student_with_operation", {
    p_operation_id: options.operationId,
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

/**
 * Archivar (o cualquier cambio de estado) con poda atómica opcional de
 * agenda futura — decisión de producto confirmada (Fase 10): nunca hard
 * delete, restaurar nunca reconstruye la agenda retirada, pagos/cargos/
 * reportes/historial nunca se tocan. Reúne los datos reales (series,
 * roster, clases sueltas futuras), calcula el plan puro
 * (`planArchiveStudentPrune`) y lo ejecuta en una única transacción real
 * (RPC `archive_student_and_prune_future`). `operationId` es obligatorio y
 * viene del cliente (estable durante el ciclo de vida del formulario) —
 * un doble clic/reintento con el mismo id nunca duplica historial ni
 * reaplica la poda.
 */
export async function archiveStudentAndPruneFuture(
  ctx: AuthenticatedDbContext,
  id: string,
  input: {
    status: StudentStatus;
    occurredOn: string;
    reason?: string;
    internalNote?: string;
    removeFromFuture: boolean;
    now: Date;
    operationId: string;
  }
): Promise<StudentRecord> {
  let payload: Record<string, unknown> = {
    student_id: id,
    status: input.status,
    occurred_on: input.occurredOn,
    reason: input.reason ?? null,
    internal_note: input.internalNote ?? null,
    remove_from_future: input.removeFromFuture,
    operation_id: input.operationId,
  };

  if (input.removeFromFuture) {
    // Medianoche real en civil Argentina — nunca UTC implícito. Debe ser el
    // MISMO instante que calcula la RPC (v_effective_instant), para que la
    // ventana de congelamiento en TypeScript y el corte real en SQL coincidan.
    const effectiveInstantIso = localDateTimeToInstantIso({ date: input.occurredOn, hour: 0, minute: 0, timeZone: ARGENTINA_TIMEZONE });

    const rules = await listActiveRecurrenceRulesForStudent(ctx, id);
    const ruleIds = rules.map((r) => r.id);
    const [ruleParticipantRows, lessonsPerRule, looseLessons, studentsList] = await Promise.all([
      listRuleParticipantsWithCreatedAt(ctx, ruleIds),
      Promise.all(ruleIds.map((ruleId) => listCalendarLessonsForRecurrence(ctx, ruleId))),
      listLooseFutureScheduledLessonsForStudent(ctx, id, effectiveInstantIso),
      listStudents(ctx),
    ]);

    const studentsById = new Map(studentsList.map((s) => [s.id, s]));
    const lessonsByRule: Record<string, typeof lessonsPerRule[number]> = {};
    ruleIds.forEach((ruleId, idx) => {
      lessonsByRule[ruleId] = lessonsPerRule[idx];
    });

    const rulesForPrune: RuleForPrune[] = rules.map((rule) => ({
      recurrenceId: rule.id,
      studentId: rule.primaryStudentId,
      primaryStudentId: rule.primaryStudentId,
      participantIds: rule.participantIds,
      cycleLengthWeeks: rule.cycleLengthWeeks,
      weeks: rule.weeks,
      modality: rule.modality,
      timezone: rule.timezone,
      startDate: rule.startDate,
      endDate: rule.endDate,
      status: rule.status,
      classTitle: rule.classTitle,
      activityKind: rule.activityKind,
    }));

    const ruleParticipantsForPrune: RuleParticipantForPrune[] = ruleParticipantRows.map((row) => {
      const student = studentsById.get(row.student_id);
      return {
        ruleId: row.recurrence_rule_id,
        studentId: row.student_id,
        createdAt: row.created_at,
        studentName: student?.name ?? "",
        studentLevel: student?.levels[0] ?? "",
      };
    });

    const looseLessonIds = looseLessons.map((l) => l.id);
    const lessonParticipantRows = await listLessonParticipantRows(ctx, looseLessonIds);
    const looseLessonsForPrune: LooseLessonForPrune[] = looseLessons.map((lesson) => ({
      id: lesson.id,
      primaryStudentId: lesson.primaryStudentId,
      otherParticipants: lessonParticipantRows
        .filter((p) => p.calendar_lesson_id === lesson.id && p.student_id !== id)
        .map((p) => ({ studentId: p.student_id, studentName: p.student_name, level: p.level, createdAt: p.created_at })),
    }));

    const plan = planArchiveStudentPrune({
      studentId: id,
      now: input.now,
      effectiveDateIso: effectiveInstantIso,
      rules: rulesForPrune,
      ruleParticipants: ruleParticipantsForPrune,
      lessonsByRule,
      looseLessons: looseLessonsForPrune,
    });

    payload = {
      ...payload,
      series_end: plan.seriesEnd.map((e) => ({ recurrence_id: e.ruleId })),
      series_promote: plan.seriesPromote.map((e) => ({
        rule_id: e.ruleId,
        new_primary_student_id: e.newPrimaryStudentId,
        new_primary_student_name: e.newPrimaryStudentName,
        new_primary_level: e.newPrimaryLevel,
        freeze_occurrences: buildFreezePayload(e.freezeOccurrences, rulesForPrune, ruleParticipantsForPrune, e.ruleId, studentsById),
      })),
      series_participant_removal: plan.seriesParticipantRemoval.map((e) => ({
        rule_id: e.ruleId,
        freeze_occurrences: buildFreezePayload(e.freezeOccurrences, rulesForPrune, ruleParticipantsForPrune, e.ruleId, studentsById),
      })),
      loose_cancel: plan.looseCancel,
      loose_reassign: plan.looseReassign.map((e) => ({
        lesson_id: e.lessonId,
        new_primary_student_id: e.newPrimaryStudentId,
        new_primary_student_name: e.newPrimaryStudentName,
        new_primary_level: e.newPrimaryLevel,
      })),
      loose_remove_participant: plan.looseRemoveParticipant,
    };
  }

  const { data, error } = await ctx.supabase.rpc("archive_student_and_prune_future", { p_payload: payload });
  if (error) {
    if (error.code === "P0002") throw new StudentNotFoundError("Alumno no encontrado.");
    throw error;
  }
  return toStudentRecord(data as StudentRow);
}

/**
 * Construye el payload real de `freeze_occurrences` para la RPC — mismo
 * criterio que `changeRecurrenceParticipantsFromDate`: el roster VIEJO
 * completo de la serie (todos sus participantes reales, primario incluido)
 * es el que se congela en cada ocurrencia virtual, nunca sólo el alumno que
 * se está archivando.
 */
function buildFreezePayload(
  occurrences: { occurrenceKey: string; recurrenceIndex: number; start: string; end: string }[],
  rules: RuleForPrune[],
  ruleParticipants: RuleParticipantForPrune[],
  ruleId: string,
  studentsById: Map<string, StudentRecord>
): Record<string, unknown>[] {
  const rule = rules.find((r) => r.recurrenceId === ruleId);
  if (!rule) return [];
  const roster = ruleParticipants.filter((p) => p.ruleId === ruleId);
  const primary = roster.find((p) => p.studentId === rule.primaryStudentId) ?? roster[0] ?? null;
  const color = rule.modality === "online" ? "#DDEBFF" : rule.modality === "mixta" ? "#F2E8FF" : "#FFE4D2";

  return occurrences.map((occurrence) => ({
    occurrence_key: occurrence.occurrenceKey,
    recurrence_index: occurrence.recurrenceIndex,
    start_at: occurrence.start,
    end_at: occurrence.end,
    primary_student_id: primary?.studentId ?? null,
    student_name: primary?.studentName ?? "",
    level: primary?.studentLevel ?? "",
    lesson_type: roster.length > 1 ? "group" : "individual",
    modality: rule.modality,
    class_title: rule.classTitle,
    activity_kind: rule.activityKind,
    color,
    participants: roster.map((p) => {
      const student = studentsById.get(p.studentId);
      return { student_id: p.studentId, student_name: student?.name ?? p.studentName, level: student?.levels[0] ?? p.studentLevel };
    }),
  }));
}
