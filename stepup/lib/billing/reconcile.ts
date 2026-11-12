import type { ExecutionFact } from "./ledger.ts";
import { getPlan, validateAgainstCatalog, type PlanCode } from "./plans.ts";
import type { ProviderOperation } from "./provider.ts";

/**
 * Conciliación de UNA operación (M1) — función pura. Decide si una operación informada por el proveedor puede convertirse en un
 * hecho del libro de cobros. Fuente de verdad del dinero: la consulta AUTENTICADA al proveedor (`getOperation`), nunca el cuerpo
 * de un aviso. La identidad de la propietaria sale de NUESTRA referencia (`subscriberReference`), resuelta contra NUESTRA base:
 * ningún `owner_id`, plan, período, importe ni estado enviado por el navegador o por el aviso se toma como cierto.
 *
 * Todo lo que no cierra termina en anomalía de conciliación (se conserva para revisión) y NUNCA toca el estado de la cuenta.
 */
export type AnomalyKind =
  | "unknown_reference"
  | "owner_mismatch"
  | "subscriber_mismatch"
  | "missing_execution"
  | "missing_due_date"
  | "amount_mismatch"
  | "currency_mismatch"
  | "unknown_plan"
  | "inactive_plan"
  | "plan_not_expected"
  | "refund_review" // devolución PARCIAL o ambigua: revisión manual, no cambia el estado
  | "refund_applied" // devolución TOTAL confirmada: se aplicó sola y queda auditada
  | "chargeback_review" // contracargo conciliado: modo limitado inmediato y revisión
  | "provider_state_mismatch" // el proveedor y la base no coinciden en el estado del suscriptor
  | "paid_after_cancel"
  | "impossible_transition"
  | "provider_unreachable";

export type IgnoreReason = "non_final_status" | "test_operation" | "unsupported_status" | "unsupported_event_type";

/** Lo que la base sabe de la propietaria a la que corresponde una referencia de suscriptor. */
export interface SubscriberRecord {
  readonly ownerId: string;
  readonly subscriberReference: string;
  readonly subscriberUid: string | null;
  /** Pagos ya conciliados de esta cuenta que coinciden con los consultados (sólo cuando se resolvió por id de pago). */
  readonly paymentIds?: readonly string[];
  /** Planes que ESTA cuenta puede cobrar hoy: el vigente, el programado y el del intento de pago abierto. */
  readonly acceptablePlans: readonly PlanCode[];
}

export type Reconciliation =
  | { kind: "fact"; ownerId: string; fact: ExecutionFact; providerPaymentId: string; audit: "refund_applied" | "chargeback_review" | null }
  | { kind: "ignore"; reason: IgnoreReason }
  | { kind: "anomaly"; anomaly: AnomalyKind; ownerId: string | null; dedupeKey: string };

export interface ReconcileContext {
  /** Referencia del suscriptor que trae el aviso VERIFICADO (puede faltar en un barrido). */
  readonly hintedReference: string | null;
  readonly hintedExecutionUid: string | null;
  readonly records: ReadonlyMap<string, SubscriberRecord>;
  /** En Production sólo cuentan operaciones reales (moneda ARS, no de prueba). */
  readonly expectLive: boolean;
  /**
   * El proveedor crea el suscriptor con el primer cobro (Rebill): un uid distinto del guardado NO es una anomalía cuando la operación trae NUESTRA referencia (la cuenta volvió
   * a suscribirse o es su primer cobro); el vínculo se actualiza al conciliar. Sin nuestra referencia explícita, un uid distinto sigue siendo `subscriber_mismatch`.
   */
  readonly allowRebind?: boolean;
}

function inferPlanByAmount(acceptable: readonly PlanCode[], amountMinor: number | null): PlanCode | null {
  if (amountMinor === null) return null;
  const matches = [...new Set(acceptable)].filter((code) => getPlan(code)?.amountMinor === amountMinor);
  return matches.length === 1 ? matches[0] : null;
}

export function reconcileOperation(operation: ProviderOperation, context: ReconcileContext): Reconciliation {
  const anomaly = (kind: AnomalyKind, ownerId: string | null): Reconciliation => ({ kind: "anomaly", anomaly: kind, ownerId, dedupeKey: `${kind}:${operation.providerPaymentId}` });

  if (operation.outcome === "pending") return { kind: "ignore", reason: "non_final_status" };
  if (context.expectLive && !operation.livemode) return { kind: "ignore", reason: "test_operation" };

  const reference = context.hintedReference ?? operation.subscriberReference;
  if (!reference) return anomaly("unknown_reference", null);
  if (context.hintedReference && operation.subscriberReference && context.hintedReference !== operation.subscriberReference) return anomaly("owner_mismatch", null);
  const record = context.records.get(reference);
  if (!record) return anomaly("unknown_reference", null);
  const ownerId = record.ownerId;

  const rebinding = context.allowRebind === true && operation.subscriberReference !== null && operation.subscriberReference === record.subscriberReference;
  if (record.subscriberUid && operation.subscriberUid && record.subscriberUid !== operation.subscriberUid && !rebinding) return anomaly("subscriber_mismatch", ownerId);
  const executionUid = operation.executionUid ?? context.hintedExecutionUid;
  if (context.hintedExecutionUid && operation.executionUid && context.hintedExecutionUid !== operation.executionUid) return anomaly("missing_execution", ownerId);
  if (!executionUid) return anomaly("missing_execution", ownerId);

  // Devolución: sólo la TOTAL se aplica sola; una parcial o ambigua queda para revisión manual y no toca el estado.
  if (operation.outcome === "refunded" && operation.refundScope !== "full") return anomaly("refund_review", ownerId);
  if (operation.outcome === "other") return { kind: "ignore", reason: "unsupported_status" };

  // Un cobro SIN suscripción todavía (el primer intento de pago con Rebill, aprobado antes de que exista la suscripción, o rechazado) no dice a qué plan corresponde: se infiere SÓLO
  // cuando trae NUESTRA referencia y el importe coincide con exactamente uno de los planes que esa cuenta puede cobrar hoy. Luego la validación contra el catálogo es la de siempre.
  const inferred = operation.planReference === null && rebinding ? inferPlanByAmount(record.acceptablePlans, operation.amountMinor) : null;
  const validation = validateAgainstCatalog({ planCode: operation.planReference ?? inferred, amountMinor: operation.amountMinor, currency: operation.currency });
  if (!validation.ok) {
    const map = { unknown_plan: "unknown_plan", inactive_plan: "inactive_plan", currency_mismatch: "currency_mismatch", amount_mismatch: "amount_mismatch" } as const;
    return anomaly(map[validation.reason], ownerId);
  }
  // Una devolución o un contracargo se refiere a un cobro YA hecho: el plan puede haber cambiado desde entonces.
  const settled = operation.outcome === "refunded" || operation.outcome === "chargeback";
  if (!settled && !record.acceptablePlans.includes(validation.plan.code)) return anomaly("plan_not_expected", ownerId);
  if (!operation.dueAt) return anomaly("missing_due_date", ownerId);

  return {
    kind: "fact",
    ownerId,
    providerPaymentId: operation.providerPaymentId,
    audit: operation.outcome === "refunded" ? "refund_applied" : operation.outcome === "chargeback" ? "chargeback_review" : null,
    fact: { executionId: executionUid, outcome: operation.outcome, planCode: validation.plan.code, amountMinor: validation.plan.amountMinor, dueAt: operation.dueAt, occurredAt: operation.occurredAt },
  };
}
