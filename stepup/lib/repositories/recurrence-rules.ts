import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceRuleParticipantRow, RecurrenceRuleRow, RecurrenceRuleStatus } from "@/lib/db/database.types";
import {
  toRecurrenceRuleRecord,
  validateNewRecurrenceSeriesInput,
  recurrenceSeriesInputToPayload,
  type RecurrenceRuleRecord,
  type NewRecurrenceSeriesInput,
} from "./recurrence-rules-mapping";
import { planParticipantFreeze } from "@/lib/calendar/participants-split";
import type { RecurrenceRuleForEngine } from "@/lib/calendar/types";
import { listCalendarLessonsForRecurrence } from "./calendar-lessons";
import { listStudents } from "./students";

/**
 * Repositorio de series de recurrencia — única puerta de entrada real a
 * `recurrence_rules`/`recurrence_rule_participants`. Mismo patrón que
 * `students.ts`. Ninguna ocurrencia futura se materializa acá — sólo la
 * regla; las ocurrencias se generan en memoria al leer
 * (`lib/calendar/recurrence-engine.ts`).
 */
export type { RecurrenceRuleRecord, NewRecurrenceSeriesInput } from "./recurrence-rules-mapping";

export class RecurrenceRuleNotFoundError extends Error {}

async function attachParticipants(ctx: AuthenticatedDbContext, rows: RecurrenceRuleRow[]): Promise<RecurrenceRuleRecord[]> {
  if (rows.length === 0) return [];
  const { data, error } = await ctx.supabase
    .from("recurrence_rule_participants")
    .select("recurrence_rule_id, student_id")
    .eq("owner_id", ctx.ownerId)
    .in(
      "recurrence_rule_id",
      rows.map((row) => row.id)
    );
  if (error) throw error;
  const byRule = new Map<string, string[]>();
  (data as Pick<RecurrenceRuleParticipantRow, "recurrence_rule_id" | "student_id">[]).forEach((participant) => {
    const list = byRule.get(participant.recurrence_rule_id) ?? [];
    list.push(participant.student_id);
    byRule.set(participant.recurrence_rule_id, list);
  });
  return rows.map((row) => toRecurrenceRuleRecord(row, byRule.get(row.id) ?? []));
}

/** Todas las reglas del profesor autenticado — sin filtrar por estado (la vista decide qué mostrar). */
export async function listRecurrenceRules(ctx: AuthenticatedDbContext): Promise<RecurrenceRuleRecord[]> {
  const { data, error } = await ctx.supabase.from("recurrence_rules").select("*").eq("owner_id", ctx.ownerId);
  if (error) throw error;
  return attachParticipants(ctx, data as RecurrenceRuleRow[]);
}

export async function getRecurrenceRule(ctx: AuthenticatedDbContext, id: string): Promise<RecurrenceRuleRecord | null> {
  const { data, error } = await ctx.supabase.from("recurrence_rules").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [record] = await attachParticipants(ctx, [data as RecurrenceRuleRow]);
  return record;
}

/**
 * Series activas/pausadas (nunca `ended`) donde el alumno es primario o
 * participante — usado por la poda de agenda al archivar (Fase 10).
 */
export async function listActiveRecurrenceRulesForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<RecurrenceRuleRecord[]> {
  const { data: participantRows, error: participantError } = await ctx.supabase
    .from("recurrence_rule_participants")
    .select("recurrence_rule_id")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId);
  if (participantError) throw participantError;
  const ruleIds = new Set((participantRows as { recurrence_rule_id: string }[]).map((r) => r.recurrence_rule_id));

  const { data, error } = await ctx.supabase
    .from("recurrence_rules")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .in("status", ["active", "paused"]);
  if (error) throw error;
  const rows = (data as RecurrenceRuleRow[]).filter((row) => row.primary_student_id === studentId || ruleIds.has(row.id));
  return attachParticipants(ctx, rows);
}

/** Roster real (`recurrence_rule_participants`, con `created_at`) de un conjunto de series — usado para elegir a quién promover de forma determinística. */
export async function listRuleParticipantsWithCreatedAt(
  ctx: AuthenticatedDbContext,
  ruleIds: string[]
): Promise<RecurrenceRuleParticipantRow[]> {
  if (ruleIds.length === 0) return [];
  const { data, error } = await ctx.supabase
    .from("recurrence_rule_participants")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .in("recurrence_rule_id", ruleIds);
  if (error) throw error;
  return data as RecurrenceRuleParticipantRow[];
}

/** Crea una serie + sus participantes de forma atómica (RPC `create_recurrence_series`). */
export async function createRecurrenceSeries(ctx: AuthenticatedDbContext, input: NewRecurrenceSeriesInput): Promise<RecurrenceRuleRecord> {
  const errors = validateNewRecurrenceSeriesInput(input);
  if (errors.length > 0) throw new Error(`Serie inválida: ${errors.map((e) => e.message).join(" ")}`);

  const { data, error } = await ctx.supabase.rpc("create_recurrence_series", { p_payload: recurrenceSeriesInputToPayload(input) });
  if (error) throw error;
  const row = data as RecurrenceRuleRow;
  return toRecurrenceRuleRecord(row, input.participantIds);
}

/** Pausar/reanudar/finalizar — una sola tabla, no necesita RPC (RLS ya exige owner_id = auth.uid()). */
export async function setRecurrenceRuleStatus(
  ctx: AuthenticatedDbContext,
  id: string,
  status: RecurrenceRuleStatus,
  endDate?: string | null
): Promise<RecurrenceRuleRecord> {
  const patch: Record<string, unknown> = { status };
  if (endDate !== undefined) patch.end_date = endDate;
  const { data, error } = await ctx.supabase.from("recurrence_rules").update(patch).eq("owner_id", ctx.ownerId).eq("id", id).select("*").single();
  if (error) {
    if (error.code === "PGRST116") throw new RecurrenceRuleNotFoundError("Serie no encontrada.");
    throw error;
  }
  const [record] = await attachParticipants(ctx, [data as RecurrenceRuleRow]);
  return record;
}

/**
 * Cambia el roster de una serie DESDE una fecha efectiva, sin tocar el
 * patrón ni crear una serie nueva — puerto de `planParticipantsFromDate`
 * del móvil (`lib/calendar/participants-split.ts`). Antes de reemplazar el
 * roster de la regla, congela/materializa con el roster VIEJO cualquier
 * ocurrencia virtual entre "ahora" y la fecha efectiva que todavía no esté
 * materializada — así ninguna clase ya pasada (o a punto de pasar) cambia
 * de participantes retroactivamente. Todo en una sola transacción (RPC).
 */
export async function changeRecurrenceParticipantsFromDate(
  ctx: AuthenticatedDbContext,
  input: {
    ruleId: string;
    effectiveDateIso: string;
    now: Date;
    newParticipantIds: string[];
    /** Elegido explícitamente por la profesora para el roster NUEVO — nunca inferido del orden de `newParticipantIds` (Fase 10, 20261001140000). Debe estar dentro de `newParticipantIds`, el RPC lo valida igual. */
    newPrimaryStudentId: string;
  }
): Promise<RecurrenceRuleRecord> {
  const rule = await getRecurrenceRule(ctx, input.ruleId);
  if (!rule) throw new RecurrenceRuleNotFoundError("Serie no encontrada.");

  const [lessons, students] = await Promise.all([listCalendarLessonsForRecurrence(ctx, input.ruleId), listStudents(ctx)]);
  const studentsById = new Map(students.map((s) => [s.id, s]));

  const engineRule: RecurrenceRuleForEngine = {
    recurrenceId: rule.id,
    studentId: rule.primaryStudentId,
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
  };

  const toFreeze = planParticipantFreeze({
    rule: engineRule,
    now: input.now,
    effectiveDateIso: input.effectiveDateIso,
    existingLessons: lessons.map((lesson) => ({
      id: lesson.id,
      recurrenceId: lesson.recurrenceId,
      recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
      status: lesson.status,
    })),
  });

  const oldParticipants = rule.participantIds.map((id) => studentsById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  // El principal de las ocurrencias que se CONGELAN (roster viejo, antes de
  // la fecha efectiva) es el que la regla ya tiene guardado de verdad en
  // `primary_student_id` — nunca el primer elemento de `participantIds`
  // (ese array no tiene ningún orden garantizado; usarlo como si lo tuviera
  // era el mismo bug de selección implícita que esta ronda corrige en el
  // resto de Calendario, ver 20261001140000).
  const primary = studentsById.get(rule.primaryStudentId ?? "") ?? oldParticipants[0] ?? null;
  const color = rule.modality === "online" ? "#DDEBFF" : rule.modality === "mixta" ? "#F2E8FF" : "#FFE4D2";

  const freezeOccurrences = toFreeze.map((occurrence) => ({
    occurrence_key: occurrence.occurrenceKey,
    recurrence_index: occurrence.recurrenceIndex,
    start_at: occurrence.start,
    end_at: occurrence.end,
    primary_student_id: primary?.id ?? null,
    student_name: primary?.name ?? "",
    level: primary?.levels[0] ?? "",
    lesson_type: oldParticipants.length > 1 ? "group" : "individual",
    modality: rule.modality,
    class_title: rule.classTitle,
    activity_kind: rule.activityKind,
    color,
    participants: oldParticipants.map((s) => ({ student_id: s.id, student_name: s.name, level: s.levels[0] ?? "" })),
  }));

  const { data, error } = await ctx.supabase.rpc("apply_recurrence_participants_from_date", {
    p_payload: {
      rule_id: input.ruleId,
      new_participant_ids: input.newParticipantIds,
      primary_student_id: input.newPrimaryStudentId,
      freeze_occurrences: freezeOccurrences,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie no encontrada.");
    throw error;
  }
  const row = data as RecurrenceRuleRow;
  return toRecurrenceRuleRecord(row, input.newParticipantIds);
}
