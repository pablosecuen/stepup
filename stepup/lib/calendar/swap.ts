import { findManageableForRule, lineageRootId, resolveEditableSegment, type RuleForLineage } from "./lineage.ts";
import type { RecurrenceWeek } from "./types.ts";

/**
 * Intercambio de horarios entre dos series: cada una toma el patrón semanal de la otra DESDE una fecha efectiva; alumnos, título y
 * modalidad no se mueven. Esta parte es pura: elige qué tramo de cada serie se corta, qué patrón recibe y qué tramos posteriores
 * (cambios ya programados) quedan reemplazados — para mostrarlos antes de confirmar. La validación contra terceras clases y la
 * transacción la hace el servidor (`lib/actions/calendar.ts` y el RPC `swap_recurrence_patterns`).
 */
export type SwapRule = RuleForLineage & {
  startDate: string;
  weeks: RecurrenceWeek[];
  participantIds: string[];
  primaryStudentId: string | null;
};

export interface SwapSide<T extends SwapRule> {
  /** Serie vigente (la que se ve y se administra). */
  head: T;
  /** Tramo que contiene la fecha efectiva: es el que se corta. */
  target: T;
  /** Tramos posteriores que el patrón nuevo reemplaza (cambios ya programados) — se finalizan en la misma transacción. */
  superseded: T[];
  /** Patrón que recibe: el de la OTRA serie en esa fecha. */
  newWeeks: RecurrenceWeek[];
  /** Fin de la sucesora: el de la serie vigente a la que reemplaza (o el del tramo cortado si no hay posteriores). */
  successorEndDate: string | null;
}

export type SwapPlan<T extends SwapRule> = { ok: true; a: SwapSide<T>; b: SwapSide<T> } | { ok: false; error: string };

function sameWeeks(first: RecurrenceWeek[], second: RecurrenceWeek[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function planSeriesSwap<T extends SwapRule>(rules: T[], idA: string, idB: string, effectiveDate: string, todayDate: string, nowIso: string): SwapPlan<T> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return { ok: false, error: "Elegí la fecha desde la que rige el intercambio." };
  if (effectiveDate < todayDate) return { ok: false, error: "El intercambio no puede regir desde una fecha pasada: las clases pasadas no se modifican." };
  if (idA === idB) return { ok: false, error: "Elegí dos series distintas." };

  const headA = findManageableForRule(rules, idA, nowIso);
  const headB = findManageableForRule(rules, idB, nowIso);
  if (!headA || !headB) return { ok: false, error: "Una de las series ya terminó: no hay horario que intercambiar." };
  if (headA.recurrenceId === headB.recurrenceId || lineageRootId(rules, headA.recurrenceId) === lineageRootId(rules, headB.recurrenceId)) {
    return { ok: false, error: "Elegí dos series distintas." };
  }
  if (headA.status !== "active" || headB.status !== "active") return { ok: false, error: "Las dos series tienen que estar activas (una está pausada)." };

  const segmentA = resolveEditableSegment(rules, headA.recurrenceId, effectiveDate);
  const segmentB = resolveEditableSegment(rules, headB.recurrenceId, effectiveDate);
  if (!segmentA || !segmentB) return { ok: false, error: "Alguna de las series no tiene un tramo vigente en esa fecha. Elegí una fecha dentro de las dos series." };

  if (sameWeeks(segmentA.target.weeks, segmentB.target.weeks)) {
    return { ok: false, error: "Las dos series ya tienen el mismo horario en esa fecha: no hay nada que intercambiar." };
  }

  const side = (head: T, segment: { target: T; superseded: T[] }, other: T): SwapSide<T> => ({
    head,
    target: segment.target,
    superseded: segment.superseded,
    newWeeks: other.weeks,
    successorEndDate: segment.superseded.length > 0 ? head.endDate : segment.target.endDate,
  });
  return { ok: true, a: side(headA, segmentA, segmentB.target), b: side(headB, segmentB, segmentA.target) };
}

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** «vie 19:00 · sáb 10:00» — el patrón semanal en pocas palabras. */
export function describeWeeks(weeks: RecurrenceWeek[]): string {
  return (
    weeks
      .map((week) =>
        week.sessions
          .map((session) => `${WEEKDAY_LABELS[session.weekday]} ${String(session.hour).padStart(2, "0")}:${String(session.minute).padStart(2, "0")}`)
          .join(" · ")
      )
      .filter(Boolean)
      .join(" / ") || "Sin horario"
  );
}
