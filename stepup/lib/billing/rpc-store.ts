import type { BillingSnapshot, ExecutionFact } from "./ledger.ts";
import { isPlanCode, type PlanCode } from "./plans.ts";
import type { WebhookEventType } from "./provider.ts";
import type { SubscriberRecord } from "./reconcile.ts";
import { BILLING_STATUSES, type BillingStatus } from "./state-machine.ts";
import type { BillingHistory, BillingStore, HistoryCharge, CheckoutAttempt, CommitBatch, CommitResult, DuePage, IngestRow, OpenCheckoutResult, PollResult, QueueStats, StoredEvent } from "./store.ts";
import type { NoticeHint } from "./provider.ts";

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
  | "billing_purge_retention"
  | "billing_claim_polls"
  | "billing_mark_polled"
  | "billing_prioritize_polls"
  | "billing_queue_stats"
  | "billing_purge_fiscal_records"
  | "billing_owner_history";

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
  billing_claim_polls: "rows",
  billing_mark_polled: "scalar",
  billing_prioritize_polls: "scalar",
  billing_queue_stats: "scalar",
  billing_purge_fiscal_records: "scalar",
  billing_owner_history: "scalar",
};

/** Argumentos que viajan como JSON (los demás son escalares o arreglos nativos). */
export const RPC_JSON_ARGS: ReadonlySet<string> = new Set(["p", "p_rows", "p_items"]);

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
    providerPlanCode: asPlan(row.provider_plan_code),
    grandfathered: row.grandfathered === true,
    currentPeriodStart: toIso(row.current_period_start),
    currentPeriodEnd: toIso(row.current_period_end),
    renewalRejectedDueAt: toIso(row.renewal_rejected_due_at),
    graceEndsAt: toIso(row.grace_ends_at),
    cancelRequestedAt: toIso(row.cancel_requested_at),
    providerEndedAt: toIso(row.provider_ended_at),
    restartedAt: toIso(row.restarted_at),
    chargebackAt: toIso(row.chargeback_at),
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
      chargeback_at: s.chargebackAt,
      provider_plan_code: s.providerPlanCode,
      next_check_at: nextCheckAt,
    })),
    reconciliations: batch.reconciliations.map((x) => ({ kind: x.kind, owner_id: x.ownerId, dedupe_key: x.dedupeKey, detail: x.detail })),
    events: batch.events.map((x) => ({ id: x.id, owner_id: x.ownerId, status: x.status, result: x.result, retry_delay_seconds: x.retryDelaySeconds })),
    voided_periods: (batch.voidedPeriods ?? []).map((x) => ({ owner_id: x.ownerId, provider: x.provider, execution_uid: x.executionUid })),
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
        p_rows: part.map((row) => ({ dedup_key: row.dedupKey, provider: row.provider, event_type: row.eventType, payload_hash: row.payloadHash, normalized: row.hint, received_at: row.receivedAt })),
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
      const hint = isRow(row.normalized) ? row.normalized : {};
      const field = (name: string): string | null => (typeof hint[name] === "string" ? (hint[name] as string) : null);
      const clean: NoticeHint = { providerPaymentId: field("providerPaymentId"), executionUid: field("executionUid"), subscriberUid: field("subscriberUid"), subscriberReference: field("subscriberReference") };
      return { id: Number(row.id), eventType: eventType as WebhookEventType, attempts: Number(row.attempts), hint: clean };
    });
  }

  async resolveSubscribers(keys: { references: readonly string[]; uids: readonly string[] }): Promise<SubscriberRecord[]> {
    const out = new Map<string, SubscriberRecord>();
    const references = chunk(keys.references, 500);
    const uids = chunk(keys.uids, 500);
    for (let index = 0; index < Math.max(references.length, uids.length); index += 1) {
      for (const row of rows(await this.rpc("billing_resolve_subscribers", { p_refs: references[index] ?? [], p_uids: uids[index] ?? [] }))) {
        const plans = Array.isArray(row.acceptable_plans) ? row.acceptable_plans.filter(isPlanCode) : [];
        out.set(str(row.owner_id), { ownerId: str(row.owner_id), subscriberReference: str(row.provider_reference), subscriberUid: typeof row.provider_subscriber_uid === "string" ? row.provider_subscriber_uid : null, acceptablePlans: plans });
      }
    }
    return [...out.values()];
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
        const outcome = row.outcome === "approved" || row.outcome === "rejected" || row.outcome === "refunded" || row.outcome === "chargeback" ? row.outcome : null;
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

  async claimPolls(input: { nowIso: string; limit: number; leaseSeconds: number }): Promise<string[]> {
    return rows(await this.rpc("billing_claim_polls", { p_now: input.nowIso, p_limit: input.limit, p_lease_seconds: input.leaseSeconds })).map((row) => str(row.owner_id));
  }

  async markPolled(results: readonly PollResult[]): Promise<void> {
    for (const part of chunk(results, 500)) {
      await this.rpc("billing_mark_polled", { p_items: part.map((item) => ({ owner_id: item.ownerId, next_at: item.nextAt, failed: item.failed })) });
    }
  }

  async prioritizePolls(ownerIds: readonly string[]): Promise<number> {
    let total = 0;
    for (const part of chunk(ownerIds, 500)) total += Number(await this.rpc("billing_prioritize_polls", { p_owner_ids: part }));
    return total;
  }

  async getHistory(ownerId: string, limit: number): Promise<BillingHistory> {
    const row = (await this.rpc("billing_owner_history", { p_owner: ownerId, p_limit: limit })) as Row;
    const periods = (Array.isArray(row.periods) ? row.periods : []).filter(isRow).flatMap((item) => {
      const planCode = asPlan(item.plan_code);
      return planCode ? [{ planCode, amountMinor: Number(item.amount_minor), periodStart: requireIso(item.period_start), periodEnd: requireIso(item.period_end), voidedAt: toIso(item.voided_at) }] : [];
    });
    const charges = (Array.isArray(row.charges) ? row.charges : []).filter(isRow).flatMap((item): HistoryCharge[] => {
      const planCode = asPlan(item.plan_code);
      const outcome = item.outcome === "approved" || item.outcome === "rejected" || item.outcome === "refunded" || item.outcome === "chargeback" ? item.outcome : null;
      return planCode && outcome ? [{ outcome, planCode, amountMinor: Number(item.amount_minor), dueAt: requireIso(item.due_at), occurredAt: requireIso(item.occurred_at) }] : [];
    });
    return { periods, charges };
  }

  async queueStats(): Promise<QueueStats> {
    const row = (await this.rpc("billing_queue_stats", {})) as Row;
    return {
      pendingEvents: Number(row.pending_events),
      processingEvents: Number(row.processing_events),
      oldestPendingAt: toIso(row.oldest_pending_at),
      duePolls: Number(row.due_polls),
      dueClock: Number(row.due_clock),
      openReviews: Number(row.open_reviews),
    };
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
      redirectUrl: typeof a.redirect_url === "string" ? a.redirect_url : null,
    };
    const stale = (Array.isArray(result.stale) ? result.stale : []).filter(isRow).flatMap((item) => {
      const planCode = asPlan(item.plan_code);
      return planCode && typeof item.uid === "string" ? [{ uid: item.uid, planCode }] : [];
    });
    return { ok: true, attempt, created: result.created === true, superseded: result.superseded === true, stale };
  }

  async completeCheckoutAttempt(input: { attemptId: string; providerCheckoutUid: string; providerSubscriberUid: string | null; redirectUrl: string }): Promise<boolean> {
    return (await this.rpc("billing_complete_checkout_attempt", { p_attempt: input.attemptId, p_checkout_uid: input.providerCheckoutUid, p_subscriber_uid: input.providerSubscriberUid, p_redirect_url: input.redirectUrl })) === true;
  }

  async failCheckoutAttempt(attemptId: string): Promise<void> {
    await this.rpc("billing_fail_checkout_attempt", { p_attempt: attemptId });
  }

  async purgeRetention(input: { limit: number }): Promise<{ events: number; reconciliations: number }> {
    const result = (await this.rpc("billing_purge_retention", { p_limit: input.limit })) as Row;
    return { events: Number(result.events), reconciliations: Number(result.reconciliations) };
  }
}
