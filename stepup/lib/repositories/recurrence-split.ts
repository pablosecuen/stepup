import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceRuleRow } from "@/lib/db/database.types";
import { planRecurrenceSplit, buildExcludedOccurrenceKeys } from "@/lib/calendar/split";
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

  const { data, error } = await ctx.supabase.rpc("split_recurrence_this_and_future", {
    p_payload: {
      original_recurrence_id: input.originalRecurrenceId,
      effective_date: input.effectiveDate,
      original_patch: plan.originalPatch,
      successor_id: successorId,
      successor_start_date: plan.successorStartDate,
      successor_end_date: plan.successorEndDate,
      rule_type: input.ruleType,
      cycle_length_weeks: input.cycleLengthWeeks,
      weeks: input.weeks,
      modality: input.modality ?? null,
      class_title: input.classTitle ?? null,
      activity_kind: input.activityKind ?? null,
      participant_ids: input.participantIds,
      excluded_occurrence_keys: excludedOccurrenceKeys,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
    throw error;
  }
  const row = data as RecurrenceRuleRow;
  return toRecurrenceRuleRecord(row, input.participantIds);
}
