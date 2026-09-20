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

/** Reemplaza el roster completo de la serie (alcance "esta y las siguientes"/"toda la serie", ver `RegisterParticipants` en la UI). Atómico (RPC). */
export async function setRecurrenceRuleParticipants(ctx: AuthenticatedDbContext, ruleId: string, participantIds: string[]): Promise<void> {
  const { error } = await ctx.supabase.rpc("set_recurrence_participants", { p_rule_id: ruleId, p_participant_ids: participantIds });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie no encontrada.");
    throw error;
  }
}
