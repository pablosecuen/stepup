import { getPlan, type PlanCode } from "./plans.ts";
import { GRACE_DAYS, addMonthsToDateKey, civilDayOf, civilDayStartIso, graceEndsAtFor } from "./periods.ts";
import { addDaysToDateKey } from "../calendar/timezone.ts";
import { DERIVATION_TRIGGERS, isReachable, type BillingStatus } from "./state-machine.ts";

/**
 * Libro de cobros y cálculo del estado (M1).
 *
 * El estado de una suscripción se DERIVA de los hechos que el proveedor informó (los cobros, uno por ejecución) más las
 * decisiones de la propia persona (cancelar) y el reloj. Los avisos pueden llegar duplicados, desordenados o demorados, así que
 * el resultado NO puede depender del orden de llegada: se calcula sobre el CONJUNTO de cobros, ordenado por su fecha de
 * vencimiento. Por eso un aviso viejo nunca pisa un estado más nuevo: aunque llegue último, se ubica donde le corresponde.
 *
 * La máquina de estados (`state-machine.ts`) valida después que el estado calculado sea alcanzable desde el guardado; si no lo
 * es, no se aplica y se registra una anomalía para conciliación (nunca se «arregla» saltando una transición imposible).
 */

export interface ExecutionFact {
  /** Identificador de la ejecución en el proveedor. Un reintento del mismo cobro conserva el mismo identificador. */
  readonly executionId: string;
  readonly outcome: "approved" | "rejected";
  readonly planCode: PlanCode;
  readonly amountMinor: number;
  /** Fecha de vencimiento del cobro (la que agendó el proveedor). */
  readonly dueAt: string;
  /** Momento en que el proveedor fijó este resultado (el más reciente gana entre avisos del mismo cobro). */
  readonly occurredAt: string;
}

export interface BillingSnapshot {
  readonly ownerId: string;
  /** Referencia propia y opaca del suscriptor en el proveedor (única por propietaria, sin datos personales). */
  readonly providerReference: string;
  readonly providerSubscriberUid: string | null;
  readonly status: BillingStatus;
  readonly planCode: PlanCode | null;
  /** Cuenta existente al lanzar la facturación y sin decisión posterior que la saque de ese régimen. */
  readonly grandfathered: boolean;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  /** Vencimiento (fecha agendada) del último cobro de renovación RECHAZADO que sigue sin resolverse. */
  readonly renewalRejectedDueAt: string | null;
  readonly graceEndsAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly providerEndedAt: string | null;
  /** Instante en que la cuenta volvió a empezar tras cancelar o expirar: los períodos que terminaron antes ya no cuentan. */
  readonly restartedAt: string | null;
  /** Próxima revisión por reloj guardada (`next_check_at`): el barrido la corrige si ya no coincide con lo que corresponde. */
  readonly nextCheckAt: string | null;
  readonly pendingPlanCode: PlanCode | null;
  readonly version: number;
}

export type Anomaly = { code: "impossible_transition"; from: BillingStatus; to: BillingStatus } | { code: "paid_after_cancel"; executionId: string };

export interface DerivedFields {
  readonly planCode: PlanCode | null;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly renewalRejectedDueAt: string | null;
  readonly graceEndsAt: string | null;
}

function byDueThenId(a: ExecutionFact, b: ExecutionFact): number {
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0;
}

/** Un resultado por ejecución: el más reciente; a igual instante gana `approved` (un cobro confirmado no se anula por empate). */
export function finalOutcomes(facts: readonly ExecutionFact[]): ExecutionFact[] {
  const latest = new Map<string, ExecutionFact>();
  for (const fact of facts) {
    const current = latest.get(fact.executionId);
    if (!current || fact.occurredAt > current.occurredAt || (fact.occurredAt === current.occurredAt && fact.outcome === "approved" && current.outcome !== "approved")) {
      latest.set(fact.executionId, fact);
    }
  }
  return [...latest.values()];
}

/** Períodos pagados encadenados (sin huecos ni solapes dentro de la gracia); el orden de llegada no influye. */
export function buildCoverage(approved: readonly ExecutionFact[]): Array<{ executionId: string; planCode: PlanCode; startIso: string; endIso: string }> {
  const chain: Array<{ executionId: string; planCode: PlanCode; startIso: string; endIso: string }> = [];
  let cursorEnd: string | null = null;
  for (const fact of [...approved].sort(byDueThenId)) {
    const plan = getPlan(fact.planCode);
    if (!plan) continue; // un plan fuera del catálogo nunca llega acá (se rechaza antes); defensa en profundidad
    const dueDay = civilDayOf(fact.dueAt);
    let startDay = dueDay;
    if (cursorEnd) {
      const late = fact.occurredAt >= graceEndsAtFor(cursorEnd);
      const cursorDay = civilDayOf(cursorEnd);
      if (late) startDay = civilDayOf(fact.occurredAt);
      else if (dueDay <= addDaysToDateKey(cursorDay, GRACE_DAYS)) startDay = cursorDay;
    }
    const endIso = civilDayStartIso(addMonthsToDateKey(startDay, plan.monthsOfAccess));
    chain.push({ executionId: fact.executionId, planCode: fact.planCode, startIso: civilDayStartIso(startDay), endIso });
    cursorEnd = endIso;
  }
  return chain;
}

export function deriveFields(facts: readonly ExecutionFact[]): DerivedFields {
  const finals = finalOutcomes(facts);
  const chain = buildCoverage(finals.filter((fact) => fact.outcome === "approved"));
  const last = chain[chain.length - 1] ?? null;
  const currentPeriodEnd = last?.endIso ?? null;
  let renewalRejectedDueAt: string | null = null;
  if (currentPeriodEnd) {
    const endDay = civilDayOf(currentPeriodEnd);
    for (const fact of finals) {
      if (fact.outcome !== "rejected" || civilDayOf(fact.dueAt) < endDay) continue;
      if (!renewalRejectedDueAt || fact.dueAt > renewalRejectedDueAt) renewalRejectedDueAt = fact.dueAt;
    }
  }
  return {
    planCode: last?.planCode ?? null,
    currentPeriodStart: last?.startIso ?? null,
    currentPeriodEnd,
    renewalRejectedDueAt,
    graceEndsAt: currentPeriodEnd ? graceEndsAtFor(renewalRejectedDueAt ?? currentPeriodEnd) : null,
  };
}

/**
 * Hasta cuándo conserva el acceso una cuenta que canceló: hasta el fin del período YA PAGADO si canceló dentro de él (la
 * cancelación suspende el cobro en el proveedor: no hay renovación ni gracia); si canceló cuando ya estaba vencida (en demora o en
 * gracia), hasta el fin de esa gracia.
 */
export function cancelAccessEnd(fields: { readonly currentPeriodEnd: string | null; readonly graceEndsAt: string | null; readonly cancelRequestedAt: string | null }): string | null {
  const end = fields.currentPeriodEnd;
  if (!end || !fields.cancelRequestedAt) return null;
  return fields.cancelRequestedAt < end ? end : (fields.graceEndsAt ?? graceEndsAtFor(end));
}

interface Projectable {
  readonly grandfathered: boolean;
  readonly currentPeriodEnd: string | null;
  readonly renewalRejectedDueAt: string | null;
  readonly graceEndsAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly providerEndedAt: string | null;
  readonly restartedAt?: string | null;
}

/** Estado que corresponde a unos datos de período en un instante (sólo reloj y datos guardados; sin consultar nada más). */
export function projectStatus(fields: Projectable, now: Date): BillingStatus {
  // Un período que terminó antes de que la cuenta volviera a empezar ya no cuenta (la cuenta vuelve a pending).
  const end = fields.currentPeriodEnd && (!fields.restartedAt || fields.currentPeriodEnd > fields.restartedAt) ? fields.currentPeriodEnd : null;
  if (!end) {
    if (fields.cancelRequestedAt) return "canceled";
    if (fields.providerEndedAt) return "expired";
    return fields.grandfathered ? "grandfathered" : "pending";
  }
  const nowIso = now.toISOString();
  if (fields.cancelRequestedAt) return nowIso < (cancelAccessEnd({ ...fields, currentPeriodEnd: end }) ?? end) ? "cancel_at_period_end" : "canceled";
  if (nowIso < end) return "active";
  const graceEnd = fields.graceEndsAt ?? graceEndsAtFor(end);
  const inGrace = nowIso < graceEnd;
  if (fields.providerEndedAt) return "expired";
  if (inGrace) return fields.renewalRejectedDueAt ? "grace_period" : "past_due";
  return "limited";
}

export interface ReduceResult {
  readonly next: BillingSnapshot;
  readonly changed: boolean;
  readonly anomalies: readonly Anomaly[];
}

/**
 * Recalcula el snapshot con TODOS los cobros conocidos de la cuenta. Si el estado resultante no es alcanzable desde el guardado
 * por transiciones permitidas, el snapshot NO cambia y se informa la anomalía.
 */
export function reduceSnapshot(snapshot: BillingSnapshot, facts: readonly ExecutionFact[], now: Date): ReduceResult {
  const fields = deriveFields(facts);
  const anomalies: Anomaly[] = [];
  if (snapshot.cancelRequestedAt) {
    for (const fact of finalOutcomes(facts)) {
      if (fact.outcome === "approved" && fact.dueAt > snapshot.cancelRequestedAt) anomalies.push({ code: "paid_after_cancel", executionId: fact.executionId });
    }
  }
  const status = projectStatus({ ...fields, grandfathered: snapshot.grandfathered, cancelRequestedAt: snapshot.cancelRequestedAt, providerEndedAt: snapshot.providerEndedAt, restartedAt: snapshot.restartedAt }, now);
  if (status !== snapshot.status && !isReachable(snapshot.status, status, DERIVATION_TRIGGERS)) {
    return { next: snapshot, changed: false, anomalies: [...anomalies, { code: "impossible_transition", from: snapshot.status, to: status }] };
  }
  const pendingResolved = snapshot.pendingPlanCode !== null && fields.planCode === snapshot.pendingPlanCode;
  const next: BillingSnapshot = {
    ...snapshot,
    status,
    planCode: fields.planCode ?? snapshot.planCode,
    currentPeriodStart: fields.currentPeriodStart,
    currentPeriodEnd: fields.currentPeriodEnd,
    renewalRejectedDueAt: fields.renewalRejectedDueAt,
    graceEndsAt: fields.graceEndsAt,
    pendingPlanCode: pendingResolved ? null : snapshot.pendingPlanCode,
  };
  const changed =
    next.status !== snapshot.status ||
    next.planCode !== snapshot.planCode ||
    next.currentPeriodStart !== snapshot.currentPeriodStart ||
    next.currentPeriodEnd !== snapshot.currentPeriodEnd ||
    next.renewalRejectedDueAt !== snapshot.renewalRejectedDueAt ||
    next.graceEndsAt !== snapshot.graceEndsAt ||
    next.pendingPlanCode !== snapshot.pendingPlanCode;
  return { next, changed, anomalies };
}

/**
 * Próximo instante en que el estado guardado puede cambiar SOLO por el paso del tiempo (vencimiento, fin de gracia, fin de la
 * cancelación). El procesamiento lo guarda en `next_check_at` (con índice parcial) para barrer únicamente las cuentas que
 * corresponde, sin recorrer la tabla completa. `null` si el estado ya no depende del reloj.
 */
export function nextCheckAt(snapshot: Pick<BillingSnapshot, "status" | "currentPeriodEnd" | "graceEndsAt" | "cancelRequestedAt">): string | null {
  switch (snapshot.status) {
    case "active":
      return snapshot.currentPeriodEnd;
    case "past_due":
    case "grace_period":
      return snapshot.graceEndsAt;
    case "cancel_at_period_end":
      return cancelAccessEnd(snapshot);
    default:
      return null;
  }
}
