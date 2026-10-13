import { getPlan } from "../plans.ts";
import type { BillingSnapshot, ExecutionFact } from "../ledger.ts";
import type { SubscriberRecord } from "../reconcile.ts";
import type { BillingStore, ChangeRow, CheckoutAttempt, CommitBatch, CommitResult, DuePage, IngestRow, OpenCheckoutResult, StoredEvent } from "../store.ts";
import { snap } from "./helpers.ts";

/**
 * Doble de prueba EN MEMORIA del puerto de persistencia, sólo para pruebas unitarias de recepción de avisos y de comandos. La
 * semántica real (índices únicos, triggers, control optimista, arrendamientos) se prueba contra Postgres REAL en
 * `supabase/tests/postgres/m1_billing.mjs`. Registra cada llamada para poder afirmar «una sola escritura» o «ninguna lectura».
 */
export class MemoryStore implements BillingStore {
  readonly calls: string[] = [];
  readonly subscriptions = new Map<string, BillingSnapshot>();
  readonly ingested = new Map<string, IngestRow>();
  readonly changes: ChangeRow[] = [];
  readonly attempts = new Map<string, CheckoutAttempt & { idempotencyKey: string }>();
  failWith: Error | null = null;
  /** Se ejecuta antes de cada `commitBatch` (permite simular a «otra pestaña» que cambia la cuenta en el medio). */
  beforeCommit: (() => void) | null = null;

  private record(name: string): void {
    this.calls.push(name);
    if (this.failWith) throw this.failWith;
  }

  seed(snapshot: BillingSnapshot): void {
    this.subscriptions.set(snapshot.ownerId, snapshot);
  }

  async ensureAccount(ownerId: string): Promise<BillingSnapshot> {
    this.record("ensureAccount");
    const existing = this.subscriptions.get(ownerId);
    if (existing) return existing;
    const created = snap({ ownerId, status: "pending", providerReference: "tfs_" + ownerId.replace(/-/g, "").padEnd(32, "0").slice(0, 32) });
    this.subscriptions.set(ownerId, created);
    return created;
  }

  async ingestEvents(rows: readonly IngestRow[]): Promise<{ inserted: number; duplicates: number }> {
    this.record("ingestEvents");
    let inserted = 0;
    for (const row of rows) {
      if (this.ingested.has(row.dedupKey)) continue;
      this.ingested.set(row.dedupKey, row);
      inserted += 1;
    }
    return { inserted, duplicates: rows.length - inserted };
  }

  async claimEvents(): Promise<StoredEvent[]> {
    this.record("claimEvents");
    return [];
  }
  async resolveSubscribers(): Promise<Map<string, SubscriberRecord>> {
    this.record("resolveSubscribers");
    return new Map();
  }
  async loadSubscriptions(ownerIds: readonly string[]): Promise<Map<string, BillingSnapshot>> {
    this.record("loadSubscriptions");
    const map = new Map<string, BillingSnapshot>();
    for (const id of ownerIds) {
      const found = this.subscriptions.get(id);
      if (found) map.set(id, found);
    }
    return map;
  }
  async loadExecutions(): Promise<Map<string, ExecutionFact[]>> {
    this.record("loadExecutions");
    return new Map();
  }

  async commitBatch(batch: CommitBatch): Promise<CommitResult> {
    this.record("commitBatch");
    this.beforeCommit?.();
    const conflicts: string[] = [];
    let written = 0;
    for (const write of batch.subscriptions) {
      const current = this.subscriptions.get(write.snapshot.ownerId);
      if (!current || current.version !== write.expectedVersion) {
        conflicts.push(write.snapshot.ownerId);
        continue;
      }
      this.subscriptions.set(write.snapshot.ownerId, { ...write.snapshot, version: current.version + 1 });
      written += 1;
    }
    for (const change of batch.changes ?? []) {
      if (conflicts.includes(change.ownerId)) continue;
      if (this.changes.some((existing) => existing.ownerId === change.ownerId && existing.idempotencyKey === change.idempotencyKey)) continue;
      this.changes.push(change);
    }
    return { conflicts, subscriptionsWritten: written };
  }

  async dueSubscriptions(): Promise<DuePage> {
    this.record("dueSubscriptions");
    return { snapshots: [], nextCursor: null };
  }
  async getSweepCursor(): Promise<string | null> {
    this.record("getSweepCursor");
    return null;
  }
  async setSweepCursor(): Promise<void> {
    this.record("setSweepCursor");
  }

  async openCheckoutAttempt(input: Parameters<BillingStore["openCheckoutAttempt"]>[0]): Promise<OpenCheckoutResult> {
    this.record("openCheckoutAttempt");
    const sub = this.subscriptions.get(input.ownerId) ?? (await this.ensureAccount(input.ownerId));
    const plan = getPlan(input.plan.code);
    if (!plan) return { ok: false, reason: "plan_invalid" };
    if (!["grandfathered", "pending", "canceled", "expired"].includes(sub.status)) return { ok: false, reason: "not_allowed" };
    const same = [...this.attempts.values()].find((a) => a.ownerId === input.ownerId && a.idempotencyKey === input.idempotencyKey);
    if (same) return { ok: true, attempt: same, created: false, superseded: false };
    const open = [...this.attempts.values()].find((a) => a.ownerId === input.ownerId && (a.status === "open" || a.status === "completed"));
    if (open && open.planCode === plan.code) return { ok: true, attempt: open, created: false, superseded: false };
    if (open) this.attempts.set(open.id, { ...open, status: "superseded" });
    const attempt = { id: `attempt-${this.attempts.size + 1}`, ownerId: input.ownerId, planCode: plan.code, priceVersion: plan.priceVersion, amountMinor: plan.amountMinor, currency: "ARS" as const, subscriberReference: sub.providerReference, status: "open" as const, idempotencyKey: input.idempotencyKey };
    this.attempts.set(attempt.id, attempt);
    return { ok: true, attempt, created: true, superseded: Boolean(open) };
  }

  async completeCheckoutAttempt(input: { attemptId: string }): Promise<boolean> {
    this.record("completeCheckoutAttempt");
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt || (attempt.status !== "open" && attempt.status !== "completed")) return false;
    this.attempts.set(attempt.id, { ...attempt, status: "completed" });
    return true;
  }

  async failCheckoutAttempt(attemptId: string): Promise<void> {
    this.record("failCheckoutAttempt");
    const attempt = this.attempts.get(attemptId);
    if (attempt && attempt.status === "open") this.attempts.set(attempt.id, { ...attempt, status: "failed" });
  }

  async purgeRetention(): Promise<{ events: number; reconciliations: number }> {
    this.record("purgeRetention");
    return { events: 0, reconciliations: 0 };
  }
}
