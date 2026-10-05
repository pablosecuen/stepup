import type { SplitRecurrencePlan } from "./split.ts";
import type { RecurrenceWeek } from "./types.ts";

/**
 * Payload EXACTO que recibe el RPC `split_recurrence_this_and_future` (frontera TypeScript → SQL).
 *
 * CONTRATO DE CLAVES: dentro del payload, TODA clave es snake_case (`end_date`, `original_patch`, `successor_id`…), incluidas
 * las de los objetos anidados. La única excepción es el contenido de `weeks`, que es el jsonb del motor de recurrencias y
 * se guarda tal cual (`weekIndex`, `sessions[].weekday/hour/minute/durationMinutes`: camelCase por diseño, nunca lo lee un
 * `->>` del RPC). El plan de `planRecurrenceSplit` es un objeto de DOMINIO TypeScript (camelCase: `endDate`) y nunca debe
 * cruzar la frontera sin pasar por acá: hasta 2026-10-04 se enviaba `original_patch: { status, endDate }` mientras el SQL lee
 * `original_patch->>'end_date'`, así que la fecha de fin de la serie original llegaba siempre como NULL y la original
 * seguía generando ocurrencias para siempre (ver docs/CALENDAR_RPC_PAYLOAD_CONTRACT.md).
 */
export interface SplitRpcPayloadInput {
  originalRecurrenceId: string;
  effectiveDate: string;
  plan: SplitRecurrencePlan;
  successorId: string;
  excludedOccurrenceKeys: string[];
  ruleType: "weekly" | "custom";
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality: string | null;
  classTitle: string | null;
  activityKind: "class" | "training" | null;
  participantIds: string[];
  primaryStudentId: string;
}

export interface SplitRpcPayload {
  original_recurrence_id: string;
  effective_date: string;
  original_patch: { status: "active" | "ended"; end_date: string | null };
  successor_id: string;
  successor_start_date: string;
  successor_end_date: string | null;
  rule_type: "weekly" | "custom";
  cycle_length_weeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality: string | null;
  class_title: string | null;
  activity_kind: "class" | "training" | null;
  participant_ids: string[];
  primary_student_id: string;
  excluded_occurrence_keys: string[];
}

export function buildSplitRpcPayload(input: SplitRpcPayloadInput): SplitRpcPayload {
  return {
    original_recurrence_id: input.originalRecurrenceId,
    effective_date: input.effectiveDate,
    original_patch: { status: input.plan.originalPatch.status, end_date: input.plan.originalPatch.endDate },
    successor_id: input.successorId,
    successor_start_date: input.plan.successorStartDate,
    successor_end_date: input.plan.successorEndDate,
    rule_type: input.ruleType,
    cycle_length_weeks: input.cycleLengthWeeks,
    weeks: input.weeks,
    modality: input.modality,
    class_title: input.classTitle,
    activity_kind: input.activityKind,
    participant_ids: input.participantIds,
    primary_student_id: input.primaryStudentId,
    excluded_occurrence_keys: input.excludedOccurrenceKeys,
  };
}
