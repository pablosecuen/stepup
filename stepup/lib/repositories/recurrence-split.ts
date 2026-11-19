import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceRuleRow } from "@/lib/db/database.types";
import { planRecurrenceSplit, buildExcludedOccurrenceKeys } from "@/lib/calendar/split";
import { buildSplitRpcPayload, type SplitRpcPayload } from "@/lib/calendar/split-rpc-payload";
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
  /** Fin de la sucesora cuando NO es el de la serie que se corta: al editar desde una fecha anterior a la serie vigente, la sucesora toma el fin de la vigente a la que reemplaza. */
  successorEndDate?: string | null;
}

/**
 * Arma el payload del RPC de corte «esta y las siguientes» (plan puro `planRecurrenceSplit`/`buildExcludedOccurrenceKeys`, ver
 * `lib/calendar/split.ts`). El id de la sucesora se genera acá (nunca el default de la base) porque las claves excluidas ya lo
 * necesitan embebido — ver el comentario en la propia migración. Lanza (RangeError, con mensaje en español) ante una fecha inválida.
 */
export function buildSplitPayload(original: RecurrenceRuleRecord, input: SplitThisAndFutureInput): SplitRpcPayload {
  const plan = planRecurrenceSplit({
    originalRecurrenceId: input.originalRecurrenceId,
    originalStartDate: original.startDate,
    // El corte guarda el fin PROPIO de la fila (nunca el efectivo): la fecha de finalización de la serie la hereda la sucesora por trigger y sigue siendo reversible.
    originalEndDate: original.rawEndDate,
    effectiveDate: input.effectiveDate,
    todayDate: input.todayDate,
  });

  if (input.successorEndDate !== undefined) plan.successorEndDate = input.successorEndDate;

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
  return buildSplitRpcPayload({
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
}

/**
 * "Esta clase y las siguientes" — persiste el corte con el RPC atómico `split_recurrence_this_and_future`. Si el cambio reemplaza tramos
 * posteriores de la serie (`endRuleIds`), el corte y su finalización van en UNA transacción (`split_recurrence_ending_segments`).
 */
export async function splitRecurrenceThisAndFuture(ctx: AuthenticatedDbContext, input: SplitThisAndFutureInput & { endRuleIds?: string[] }): Promise<RecurrenceRuleRecord> {
  const original = await getRecurrenceRule(ctx, input.originalRecurrenceId);
  if (!original) throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
  const payload = buildSplitPayload(original, input);

  const endRuleIds = input.endRuleIds ?? [];
  const { data, error } =
    endRuleIds.length > 0
      ? await ctx.supabase.rpc("split_recurrence_ending_segments", { p_payload: { split: payload, end_rule_ids: endRuleIds } })
      : await ctx.supabase.rpc("split_recurrence_this_and_future", { p_payload: payload });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
    throw error;
  }
  const row = data as RecurrenceRuleRow;
  return toRecurrenceRuleRecord(row, input.participantIds);
}

export interface SeriesEndWithSplit {
  /** Fecha de finalización inclusive o `null` = sin fecha. */
  endDate: string | null;
  /** Inicio del tramo que se edita (fecha efectiva del cambio): la fecha de finalización no puede ser anterior. */
  minDate: string;
  timezone: string;
  /** Serie vigente y fin efectivo que vio la pantalla (detección de cambios desde otro dispositivo, ANTES de cortar). */
  checkHeadId: string;
  expectedEnd: string | null;
}

/**
 * «Editar futuras» + fecha de finalización en UNA transacción (RPC `edit_recurrence_future_with_end`): el corte (con la finalización de los tramos posteriores que reemplaza) y el límite del linaje
 * resultante, o nada. La sucesora hereda el límite por trigger; devuelve el id de la serie vigente que queda y cuántas clases ya creadas se cancelaron o volvieron.
 */
export async function splitRecurrenceWithSeriesEnd(
  ctx: AuthenticatedDbContext,
  input: SplitThisAndFutureInput & { endRuleIds?: string[]; seriesEnd: SeriesEndWithSplit }
): Promise<{ headId: string; cancelled: number; restored: number }> {
  const original = await getRecurrenceRule(ctx, input.originalRecurrenceId);
  if (!original) throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
  const payload = buildSplitPayload(original, input);
  const { data, error } = await ctx.supabase.rpc("edit_recurrence_future_with_end", {
    p_payload: {
      split: payload,
      end_rule_ids: input.endRuleIds ?? [],
      end: { end_date: input.seriesEnd.endDate, min_date: input.seriesEnd.minDate, timezone: input.seriesEnd.timezone },
      check: { head_id: input.seriesEnd.checkHeadId, expected_end: input.seriesEnd.expectedEnd },
    },
  });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
    throw error;
  }
  const result = data as { head_id: string; cancelled: number; restored: number };
  return { headId: result.head_id, cancelled: result.cancelled, restored: result.restored };
}

export interface SwapSideInput {
  input: SplitThisAndFutureInput;
  /** Tramos posteriores al que se corta: el patrón que entra los reemplaza, así que se finalizan en la misma transacción. */
  endRuleIds: string[];
}

/**
 * Intercambio de horarios entre dos series: los dos cortes y la finalización de los tramos que reemplazan van en UNA transacción
 * (`swap_recurrence_patterns`): ambos cambios o ninguno. Devuelve los ids de las dos sucesoras.
 */
export async function swapRecurrencePatterns(ctx: AuthenticatedDbContext, sides: [SwapSideInput, SwapSideInput]): Promise<string[]> {
  const operations: { split: SplitRpcPayload; end_rule_ids: string[] }[] = [];
  for (const side of sides) {
    const original = await getRecurrenceRule(ctx, side.input.originalRecurrenceId);
    if (!original) throw new RecurrenceRuleNotFoundError("Serie original no encontrada.");
    operations.push({ split: buildSplitPayload(original, side.input), end_rule_ids: side.endRuleIds });
  }
  const { data, error } = await ctx.supabase.rpc("swap_recurrence_patterns", { p_payload: { operations } });
  if (error) {
    if (error.code === "P0002") throw new RecurrenceRuleNotFoundError("Una de las series ya no existe.");
    throw error;
  }
  return data as string[];
}
