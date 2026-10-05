import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceRuleRow } from "@/lib/db/database.types";
import { planRecurrenceSplit, buildExcludedOccurrenceKeys } from "@/lib/calendar/split";
import { buildSplitRpcPayload } from "@/lib/calendar/split-rpc-payload";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import { toRecurrenceRuleRecord, type RecurrenceRuleRecord } from "./recurrence-rules-mapping";
import { RecurrenceRuleNotFoundError } from "./recurrence-rules";
import { getRecurrenceRule } from "./recurrence-rules";

export interface SplitThisAndFutureInput {
  originalRecurrenceId: string;
  effectiveDate: string; // YYYY-MM-DD
  todayDate: string; // YYYY-MM-DD — congelada por el llamador, nunca recalculada acá
  ruleType: "weekly" | "custom";
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality?: string;
  classTitle?: string | null;
  activityKind?: "class" | "training";
  participantIds: string[];
  /** Elegido explícitamente por la profesora — nunca inferido del orden de `participantIds` (Fase 10, 20261001140000). Debe estar dentro de `participantIds`, el RPC lo valida igual. */
  primaryStudentId: string;
}

/**
 * "Esta clase y las siguientes" — calcula el plan puro
 * (`planRecurrenceSplit`/`buildExcludedOccurrenceKeys`, ver
 * `lib/calendar/split.ts`) y lo persiste con el RPC atómico
 * `split_recurrence_this_and_future`. El id de la sucesora se genera acá
 * (nunca el default de la base) porque las claves excluidas ya lo
 * necesitan embebido — ver el comentario en la propia migración.
 */
export async function splitRecurrenceThisAndFuture(ctx: AuthenticatedDbContext, input: SplitThisAndFutureInput): Promise<RecurrenceRuleRecord> {
  const original = await getRecurrenceRule(ctx, input.originalRecurrenceId);
  if (!original) throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");

  const plan = planRecurrenceSplit({
    originalRecurrenceId: input.originalRecurrenceId,
    originalStartDate: original.startDate,
    originalEndDate: original.endDate,
    effectiveDate: input.effectiveDate,
    todayDate: input.todayDate,
  });

  const successorId = randomUUID();
  const excludedOccurrenceKeys = buildExcludedOccurrenceKeys({
    successorRecurrenceId: successorId,
    successorStartDate: plan.successorStartDate,
    effectiveDate: input.effectiveDate,
    cycleLengthWeeks: input.cycleLengthWeeks,
    weeks: input.weeks,
    modality: (input.modality ?? original.modality) as never,
    timezone: original.timezone,
    classTitle: input.classTitle ?? original.classTitle,
    activityKind: input.activityKind ?? original.activityKind,
  });

  // Frontera TypeScript → SQL: el payload se arma SIEMPRE con `buildSplitRpcPayload` (todo snake_case, incluido
  // `original_patch.end_date`) — nunca se pasa el plan de dominio (camelCase) tal cual. Ver lib/calendar/split-rpc-payload.ts.
  const payload = buildSplitRpcPayload({
    originalRecurrenceId: input.originalRecurrenceId,
    effectiveDate: input.effectiveDate,
    plan,
    successorId,
    excludedOccurrenceKeys,
    ruleType: input.ruleType,
    cycleLengthWeeks: input.cycleLengthWeeks,
    weeks: input.weeks,
    modality: input.modality ?? null,
    classTitle: input.classTitle ?? null,
    activityKind: input.activityKind ?? null,
    participantIds: input.participantIds,
    primaryStudentId: input.primaryStudentId,
  });
  const { data, error } = await ctx.supabase.rpc("split_recurrence_this_and_future", { p_payload: payload });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
    throw error;
  }
  const row = data as RecurrenceRuleRow;
  return toRecurrenceRuleRecord(row, input.participantIds);
}
