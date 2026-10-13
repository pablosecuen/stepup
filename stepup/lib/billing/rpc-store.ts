import type { BillingSnapshot, ExecutionFact } from "./ledger.ts";
import { isPlanCode, type PlanCode } from "./plans.ts";
import type { WebhookEventType } from "./provider.ts";
import type { SubscriberRecord } from "./reconcile.ts";
import { BILLING_STATUSES, type BillingStatus } from "./state-machine.ts";
import type { BillingStore, CheckoutAttempt, CommitBatch, CommitResult, DuePage, IngestRow, OpenCheckoutResult, StoredEvent } from "./store.ts";

/**
 * Implementación del puerto `BillingStore` sobre las funciones SQL de la migración `20261014110000_m1_billing_functions.sql`.
 * No sabe cómo se llama a la base: recibe un `RpcCaller`. En producción es la clave de servicio de Supabase (`supabase-store.ts`);
 * en las pruebas es una conexión directa a un Postgres real que ejecuta LAS MISMAS funciones. Todas las operaciones son por lotes.
 */
export type RpcName =
  | "billing_ensure_account"
  | "billing_get_subscriptions"
  | "billing_resolve_subscribers"
  | "billing_owner_executions"
  | "billing_due_subscriptions"
  | "billing_ingest_webhook_events"
  | "billing_claim_events"
  | "billing_commit_batch"
  | "billing_open_checkout_attempt"
  | "billing_complete_checkout_attempt"
  | "billing_fail_checkout_attempt"
  | "billing_sweep_cursor_get"
  | "billing_sweep_cursor_set"
  | "billing_purge_retention";

/** Forma del resultado de cada función: lo usan los adaptadores de llamada (Supabase y pg) para devolver siempre lo mismo. */
export const RPC_SHAPES: Readonly<Record<RpcName, "scalar" | "row" | "rows">> = {
  billing_ensure_account: "row",
  billing_get_subscriptions: "rows",
  billing_resolve_subscribers: "rows",
  billing_owner_executions: "rows",
  billing_due_subscriptions: "rows",
  billing_ingest_webhook_events: "scalar",
  billing_claim_events: "rows",
  billing_commit_batch: "scalar",
  billing_open_checkout_attempt: "scalar",
  billing_complete_checkout_attempt: "scalar",
  billing_fail_checkout_attempt: "scalar",
  billing_sweep_cursor_get: "scalar",
  billing_sweep_cursor_set: "scalar",
  billing_purge_retention: "scalar",
};

/** Argumentos que viajan como JSON (los demás son escalares o arreglos nativos). */
export const RPC_JSON_ARGS: ReadonlySet<string> = new Set(["p", "p_rows"]);

export type RpcCaller = (name: RpcName, args: Record<string, unknown>) => Promise<unknown>;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new TypeError("Fecha inválida en una fila de facturación.");
  return date.toISOString();
}

function requireIso(value: unknown): string {
  const iso = toIso(value);
  if (!iso) throw new TypeError("Fecha ausente en una fila de facturación.");
  return iso;
}

function asPlan(value: unknown): PlanCode | null {
  return value === null || value === undefined ? null : isPlanCode(value) ? value : null;
}

function asStatus(value: unknown): BillingStatus {
  if (typeof value === "string" && (BILLING_STATUSES as readonly string[]).includes(value)) return value as BillingStatus;
  throw new TypeError("Estado de facturación desconocido.");
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Texto ausente en una fila de facturación.");
  return value;
}

export function snapshotFromRow(row: Row): BillingSnapshot {
  return {
    ownerId: str(row.owner_id),
    providerReference: str(row.provider_reference),
    providerSubscriberUid: typeof row.provider_subscriber_uid === "string" ? row.provider_subscriber_uid : null,
    status: asStatus(row.status),
    planCode: asPlan(row.plan_code),
    grandfathered: row.grandfathered === true,
    currentPeriodStart: toIso(row.current_period_start),
    currentPeriodEnd: toIso(row.current_period_end),
    renewalRejectedDueAt: toIso(row.renewal_rejected_due_at),
    graceEndsAt: toIso(row.grace_ends_at),
    cancelRequestedAt: toIso(row.cancel_requested_at),
    providerEndedAt: toIso(row.provider_ended_at),
    restartedAt: toIso(row.restarted_at),
    nextCheckAt: toIso(row.next_check_at),
    pendingPlanCode: asPlan(row.pending_plan_code),
    version: Number(row.version),
  };
}

function rows(value: unknown): Row[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Respuesta inesperada de la base.");
  return value.filter(isRow);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export function commitBatchToJson(batch: CommitBatch): Record<string, unknown> {
  return {
    executions: batch.executions.map((x) => ({ owner_id: x.ownerId, provider: x.provider, execution_uid: x.executionUid, provider_payment_id: x.providerPaymentId, outcome: x.outcome, plan_code: x.planCode, amount_minor: x.amountMinor, currency: x.currency, due_at: x.dueAt, occurred_at: x.occurredAt })),
    periods: batch.periods.map((x) => ({ owner_id: x.ownerId, provider: x.provider, execution_uid: x.executionUid, plan_code: x.planCode, price_version: x.priceVersion, amount_minor: x.amountMinor, currency: x.currency, period_start: x.periodStart, period_end: x.periodEnd })),
    subscriptions: batch.subscriptions.map(({ snapshot: s, expectedVersion, nextCheckAt }) => ({
      owner_id: s.ownerId,
      expected_version: expectedVersion,
      status: s.status,
      grandfathered: s.grandfathered,
      plan_code: s.planCode,
      pending_plan_code: s.pendingPlanCode,
      current_period_start: s.currentPeriodStart,
      current_period_end: s.currentPeriodEnd,
      renewal_rejected_due_at: s.renewalRejectedDueAt,
      grace_ends_at: s.graceEndsAt,
      cancel_requested_at: s.cancelRequestedAt,
      provider_ended_at: s.providerEndedAt,
      restarted_at: s.restartedAt,
      next_check_at: nextCheckAt,
    })),
    reconciliations: batch.reconciliations.map((x) => ({ kind: x.kind, owner_id: x.ownerId, dedupe_key: x.dedupeKey, detail: x.detail })),
    events: batch.events.map((x) => ({ id: x.id, owner_id: x.ownerId, status: x.status, result: x.result, retry_delay_seconds: x.retryDelaySeconds })),
    changes: (batch.changes ?? []).map((x) => ({ owner_id: x.ownerId, kind: x.kind, from_plan_code: x.fromPlanCode, to_plan_code: x.toPlanCode, effective_at: x.effectiveAt, idempotency_key: x.idempotencyKey })),
  };
}

const EVENT_TYPES: ReadonlySet<string> = new Set(["subscription:execution", "subscription:registration", "subscription:change_source", "subscription:subscriber:suspended", "subscription:subscriber:active", "checkout", "other"]);

export class RpcBillingStore implements BillingStore {
  private readonly rpc: RpcCaller;

  constructor(rpc: RpcCaller) {
    this.rpc = rpc;
  }

  async ensureAccount(ownerId: string): Promise<BillingSnapshot> {
    const row = await this.rpc("billing_ensure_account", { p_owner: ownerId });
    if (!isRow(row)) throw new TypeError("Respuesta inesperada de la base.");
    return snapshotFromRow(row);
  }

  async ingestEvents(input: readonly IngestRow[]): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;
    for (const part of chunk(input, 200)) {
      const result = (await this.rpc("billing_ingest_webhook_events", {
        p_rows: part.map((row) => ({ dedup_key: row.dedupKey, provider: row.provider, event_type: row.eventType, payload_hash: row.payloadHash, normalized: row.normalized, received_at: row.receivedAt })),
      })) as Row;
      inserted += Number(result.inserted);
      duplicates += Number(result.duplicates);
    }
    return { inserted, duplicates };
  }

  async claimEvents(input: { limit: number; leaseSeconds: number; worker: string; maxAttempts: number }): Promise<StoredEvent[]> {
    const result = rows(await this.rpc("billing_claim_events", { p_limit: input.limit, p_lease_seconds: input.leaseSeconds, p_worker: input.worker, p_max_attempts: input.maxAttempts }));
    return result.map((row) => {
      const eventType = str(row.event_type);
      if (!EVENT_TYPES.has(eventType)) throw new TypeError("Tipo de aviso desconocido.");
      const normalized = isRow(row.normalized) ? row.normalized : {};
      return { id: Number(row.id), eventType: eventType as WebhookEventType, attempts: Number(row.attempts), normalized: normalized as unknown as StoredEvent["normalized"] };
    });
  }

  async resolveSubscribers(references: readonly string[]): Promise<Map<string, SubscriberRecord>> {
    const map = new Map<string, SubscriberRecord>();
    for (const part of chunk(references, 500)) {
      for (const row of rows(await this.rpc("billing_resolve_subscribers", { p_refs: part }))) {
        const plans = Array.isArray(row.acceptable_plans) ? row.acceptable_plans.filter(isPlanCode) : [];
        map.set(str(row.provider_reference), { ownerId: str(row.owner_id), subscriberReference: str(row.provider_reference), subscriberUid: typeof row.provider_subscriber_uid === "string" ? row.provider_subscriber_uid : null, acceptablePlans: plans });
      }
    }
    return map;
  }

  async loadSubscriptions(ownerIds: readonly string[]): Promise<Map<string, BillingSnapshot>> {
    const map = new Map<string, BillingSnapshot>();
    for (const part of chunk(ownerIds, 500)) {
      for (const row of rows(await this.rpc("billing_get_subscriptions", { p_owner_ids: part }))) {
        const snapshot = snapshotFromRow(row);
        map.set(snapshot.ownerId, snapshot);
      }
    }
    return map;
  }

  async loadExecutions(ownerIds: readonly string[], perOwner: number): Promise<Map<string, ExecutionFact[]>> {
    const map = new Map<string, ExecutionFact[]>();
    for (const part of chunk(ownerIds, 500)) {
      for (const row of rows(await this.rpc("billing_owner_executions", { p_owner_ids: part, p_per_owner: perOwner }))) {
        const planCode = asPlan(row.plan_code);
        const outcome = row.outcome === "approved" || row.outcome === "rejected" ? row.outcome : null;
        if (!planCode || !outcome) continue;
        const list = map.get(str(row.owner_id)) ?? [];
        list.push({ executionId: str(row.execution_uid), outcome, planCode, amountMinor: Number(row.amount_minor), dueAt: requireIso(row.due_at), occurredAt: requireIso(row.occurred_at) });
        map.set(str(row.owner_id), list);
      }
    }
    return map;
  }

  async commitBatch(batch: CommitBatch): Promise<CommitResult> {
    const result = (await this.rpc("billing_commit_batch", { p: commitBatchToJson(batch) })) as Row;
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts.filter((value): value is string => typeof value === "string") : [];
    return { conflicts, subscriptionsWritten: Number(result.subscriptions_written) };
  }

  async dueSubscriptions(input: { nowIso: string; after: { at: string; ownerId: string } | null; limit: number }): Promise<DuePage> {
    const result = rows(await this.rpc("billing_due_subscriptions", { p_now: input.nowIso, p_after_at: input.after?.at ?? null, p_after_owner: input.after?.ownerId ?? null, p_limit: input.limit }));
    const snapshots = result.map(snapshotFromRow);
    const last = result[result.length - 1];
    const nextCursor = last && result.length >= input.limit ? { at: requireIso(last.next_check_at), ownerId: str(last.owner_id) } : null;
    return { snapshots, nextCursor };
  }

  async getSweepCursor(name: string): Promise<string | null> {
    return toIso(await this.rpc("billing_sweep_cursor_get", { p_name: name }));
  }

  async setSweepCursor(name: string, atIso: string): Promise<void> {
    await this.rpc("billing_sweep_cursor_set", { p_name: name, p_at: atIso });
  }

  async openCheckoutAttempt(input: Parameters<BillingStore["openCheckoutAttempt"]>[0]): Promise<OpenCheckoutResult> {
    const result = (await this.rpc("billing_open_checkout_attempt", { p_owner: input.ownerId, p_plan_code: input.plan.code, p_provider: input.provider, p_idempotency_key: input.idempotencyKey, p_expires_at: input.expiresAt })) as Row;
    if (result.ok !== true) {
      const reason = result.reason === "not_allowed" || result.reason === "plan_invalid" || result.reason === "no_account" ? result.reason : "no_account";
      return { ok: false, reason };
    }
    const a = result.attempt as Row;
    const planCode = asPlan(a.plan_code);
    if (!planCode) throw new TypeError("Plan desconocido en un intento de pago.");
    const status = str(a.status);
    const attempt: CheckoutAttempt = {
      id: str(a.id),
      ownerId: str(a.owner_id),
      planCode,
      priceVersion: Number(a.price_version),
      amountMinor: Number(a.amount_minor),
      currency: "ARS",
      subscriberReference: str(a.subscriber_reference),
      idempotencyKey: str(a.idempotency_key),
      status: status as CheckoutAttempt["status"],
    };
    return { ok: true, attempt, created: result.created === true, superseded: result.superseded === true };
  }

  async completeCheckoutAttempt(input: { attemptId: string; providerCheckoutUid: string; providerSubscriberUid: string | null }): Promise<boolean> {
    return (await this.rpc("billing_complete_checkout_attempt", { p_attempt: input.attemptId, p_checkout_uid: input.providerCheckoutUid, p_subscriber_uid: input.providerSubscriberUid })) === true;
  }

  async failCheckoutAttempt(attemptId: string): Promise<void> {
    await this.rpc("billing_fail_checkout_attempt", { p_attempt: attemptId });
  }

  async purgeRetention(input: { limit: number }): Promise<{ events: number; reconciliations: number }> {
    const result = (await this.rpc("billing_purge_retention", { p_limit: input.limit })) as Row;
    return { events: Number(result.events), reconciliations: Number(result.reconciliations) };
  }
}
