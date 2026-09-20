import { getLocalDateKey } from "./timezone.ts";

/** Forma mínima que necesita la agrupación por linaje. */
export interface RuleForLineage {
  recurrenceId: string;
  status: "active" | "paused" | "ended";
  endDate: string | null;
  timezone: string;
  supersedesRecurrenceId: string | null;
  effectiveFromDate: string | null;
}

/**
 * Puerto de `selectManageableRecurrenceSeries` (móvil,
 * `calendarRecurrenceSplit.ts`) — agrupa por LINAJE real de recurrencia
 * (`supersedesRecurrenceId`, escrito exclusivamente por el split "esta y
 * las siguientes"), nunca por `studentId` ni por ningún campo que pueda
 * coincidir en `undefined`/`null` entre dos series realmente distintas
 * (mismo criterio que `resolveTrainingBillingLineage` en el móvil de
 * cobros). Devuelve UNA regla "vigente" por cada linaje relevante — nunca
 * agrupa dos series distintas en una sola tarjeta, nunca separa dos tramos
 * de la misma serie en dos tarjetas.
 */
export function selectManageableRecurrenceSeries<T extends RuleForLineage>(rules: T[], nowIso: string): T[] {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));

  function lineageRootId(candidate: T, visited: Set<string>): string {
    if (visited.has(candidate.recurrenceId)) return candidate.recurrenceId;
    visited.add(candidate.recurrenceId);
    if (!candidate.supersedesRecurrenceId) return candidate.recurrenceId;
    const predecessor = byId.get(candidate.supersedesRecurrenceId);
    if (!predecessor) return candidate.recurrenceId;
    return lineageRootId(predecessor, visited);
  }

  const grouped = new Map<string, { rule: T; index: number }[]>();
  rules.forEach((rule, index) => {
    const today = getLocalDateKey(nowIso, rule.timezone);
    const isFutureRelevant = rule.status !== "ended" && (!rule.endDate || rule.endDate >= today);
    if (!isFutureRelevant) return;
    const root = lineageRootId(rule, new Set());
    const bucket = grouped.get(root) ?? [];
    bucket.push({ rule, index });
    grouped.set(root, bucket);
  });

  const result: T[] = [];
  grouped.forEach((candidates) => {
    const explicitSuccessors = candidates.filter((item) => item.rule.supersedesRecurrenceId && item.rule.effectiveFromDate);
    if (explicitSuccessors.length > 0) {
      explicitSuccessors.sort((a, b) => (b.rule.effectiveFromDate! < a.rule.effectiveFromDate! ? -1 : 1));
      result.push(explicitSuccessors[0].rule);
      return;
    }
    candidates.sort((a, b) => b.index - a.index);
    result.push(candidates[0].rule);
  });

  return result;
}
