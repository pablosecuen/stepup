import { buildCoverage, finalOutcomes, nextCheckAt, reduceSnapshot, type ExecutionFact } from "./ledger.ts";
import { getPlan } from "./plans.ts";
import type { ProviderAdapter, ProviderOperation, ProviderResult } from "./provider.ts";
import { reconcileOperation, type AnomalyKind, type Reconciliation, type SubscriberRecord } from "./reconcile.ts";
import type { BillingStore, CommitBatch, EventOutcome, ExecutionRow, PeriodRow, ReconciliationRow, StoredEvent, SubscriptionWrite } from "./store.ts";

/**
 * Procesamiento diferido de la facturación (M1). Todo el trabajo pesado ocurre FUERA del pedido del proveedor: el aviso sólo se
 * verifica y se guarda (`webhook-ingest.ts`), y acá se concilia por lotes:
 *
 *   reclamar un lote (con arrendamiento) → consultar al proveedor cada pago distinto UNA vez → resolver propietarias en una
 *   consulta → leer sus cuentas y cobros en dos consultas → recalcular en memoria → escribir todo en UNA transacción.
 *
 * Garantías: ninguna consulta por suscripción dentro de un bucle; cada cobro es idempotente (clave única por ejecución);
 * un aviso cuya cuenta cambió en el medio vuelve a la cola; si el proceso se interrumpe, el arrendamiento vence y el lote se
 * reclama de nuevo (nada se pierde y nada se activa dos veces).
 */
export interface ProcessorDeps {
  readonly store: BillingStore;
  readonly provider: ProviderAdapter;
  readonly now: () => Date;
  /** En Production sólo cuentan operaciones reales. */
  readonly expectLive: boolean;
  readonly worker: string;
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
  readonly maxAttempts?: number;
  readonly providerConcurrency?: number;
  readonly executionsPerOwner?: number;
}

export interface BatchStats {
  claimed: number;
  facts: number;
  ignored: number;
  anomalies: number;
  retried: number;
  dead: number;
  providerCalls: number;
  subscriptionsWritten: number;
  conflicts: number;
}

const DEFAULTS = { batchSize: 500, leaseSeconds: 120, maxAttempts: 8, providerConcurrency: 8, executionsPerOwner: 24 } as const;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3_600;

export function emptyStats(): BatchStats {
  return { claimed: 0, facts: 0, ignored: 0, anomalies: 0, retried: 0, dead: 0, providerCalls: 0, subscriptionsWritten: 0, conflicts: 0 };
}

export function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** Math.min(attempts, 10));
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

interface Accumulator {
  readonly facts: Map<string, { ownerId: string; fact: ExecutionFact; providerPaymentId: string | null }[]>;
  readonly reconciliations: ReconciliationRow[];
  readonly dedupe: Set<string>;
}

function newAccumulator(): Accumulator {
  return { facts: new Map(), reconciliations: [], dedupe: new Set() };
}

function addAnomaly(acc: Accumulator, kind: AnomalyKind, ownerId: string | null, dedupeKey: string, detail: ReconciliationRow["detail"]): void {
  if (acc.dedupe.has(dedupeKey)) return;
  acc.dedupe.add(dedupeKey);
  acc.reconciliations.push({ kind, ownerId, dedupeKey, detail });
}

function applyReconciliation(acc: Accumulator, result: Reconciliation, provider: ProviderAdapter["name"], paymentId: string | null): string {
  switch (result.kind) {
    case "fact": {
      const list = acc.facts.get(result.ownerId) ?? [];
      list.push({ ownerId: result.ownerId, fact: result.fact, providerPaymentId: result.providerPaymentId });
      acc.facts.set(result.ownerId, list);
      return "fact";
    }
    case "ignore":
      return `ignored:${result.reason}`;
    case "anomaly":
      addAnomaly(acc, result.anomaly, result.ownerId, result.dedupeKey, { providerPaymentId: paymentId, provider });
      return `anomaly:${result.anomaly}`;
  }
}

interface OwnerPlan {
  readonly subscription: SubscriptionWrite | null;
  readonly executions: ExecutionRow[];
  readonly periods: PeriodRow[];
}

/** Recalcula las cuentas afectadas con TODOS sus cobros conocidos (los guardados + los nuevos) y arma lo que hay que escribir. */
async function planOwners(deps: ProcessorDeps, acc: Accumulator, ownerIds: readonly string[], now: Date): Promise<Map<string, OwnerPlan>> {
  const plans = new Map<string, OwnerPlan>();
  if (ownerIds.length === 0) return plans;
  const perOwner = deps.executionsPerOwner ?? DEFAULTS.executionsPerOwner;
  const [snapshots, stored] = await Promise.all([deps.store.loadSubscriptions(ownerIds), deps.store.loadExecutions(ownerIds, perOwner)]);
  for (const ownerId of ownerIds) {
    const snapshot = snapshots.get(ownerId);
    if (!snapshot) continue;
    const incoming = acc.facts.get(ownerId) ?? [];
    const known: ExecutionFact[] = [...(stored.get(ownerId) ?? []), ...incoming.map((item) => item.fact)];
    const reduced = reduceSnapshot(snapshot, known, now);
    for (const anomaly of reduced.anomalies) {
      const key = anomaly.code === "paid_after_cancel" ? `paid_after_cancel:${anomaly.executionId}` : `impossible_transition:${ownerId}:${anomaly.from}>${anomaly.to}`;
      addAnomaly(acc, anomaly.code, ownerId, key, anomaly.code === "paid_after_cancel" ? { executionId: anomaly.executionId } : { from: anomaly.from, to: anomaly.to });
    }
    // Varios avisos del mismo cobro en un lote (aprobado, liquidado, rechazo viejo…) se reducen a UN resultado por ejecución.
    const paymentOf = new Map(incoming.map((item) => [item.fact.executionId, item.providerPaymentId] as const));
    const executions: ExecutionRow[] = finalOutcomes(incoming.map((item) => item.fact)).map((fact) => ({
      ownerId,
      provider: deps.provider.name,
      executionUid: fact.executionId,
      providerPaymentId: paymentOf.get(fact.executionId) ?? null,
      outcome: fact.outcome,
      planCode: fact.planCode,
      amountMinor: fact.amountMinor,
      currency: "ARS",
      dueAt: fact.dueAt,
      occurredAt: fact.occurredAt,
    }));
    // Sólo se escriben los períodos que cambian respecto de lo ya guardado (una renovación escribe una fila, no el historial entero).
    const periods: PeriodRow[] = [];
    const before = new Map(buildCoverage(finalOutcomes(stored.get(ownerId) ?? []).filter((fact) => fact.outcome === "approved")).map((period) => [period.executionId, period]));
    for (const period of buildCoverage(finalOutcomes(known).filter((fact) => fact.outcome === "approved"))) {
      const plan = getPlan(period.planCode);
      const previous = before.get(period.executionId);
      if (!plan || (previous && previous.startIso === period.startIso && previous.endIso === period.endIso && previous.planCode === period.planCode)) continue;
      periods.push({ ownerId, provider: deps.provider.name, executionUid: period.executionId, planCode: plan.code, priceVersion: plan.priceVersion, amountMinor: plan.amountMinor, currency: "ARS", periodStart: period.startIso, periodEnd: period.endIso });
    }
    // Se escribe si cambió el estado o si la próxima revisión guardada ya no coincide con la que corresponde (así una cuenta no queda
    // «vencida» para siempre en el índice de vencimientos).
    const nextCheck = nextCheckAt(reduced.next);
    const subscription = reduced.changed || nextCheck !== snapshot.nextCheckAt ? { snapshot: reduced.next, expectedVersion: snapshot.version, nextCheckAt: nextCheck } : null;
    plans.set(ownerId, { subscription, executions, periods });
  }
  return plans;
}

function toCommit(plans: ReadonlyMap<string, OwnerPlan>, acc: Accumulator, events: readonly EventOutcome[]): CommitBatch {
  const executions: ExecutionRow[] = [];
  const periods: PeriodRow[] = [];
  const subscriptions: SubscriptionWrite[] = [];
  for (const plan of plans.values()) {
    executions.push(...plan.executions);
    periods.push(...plan.periods);
    if (plan.subscription) subscriptions.push(plan.subscription);
  }
  return { executions, periods, subscriptions, reconciliations: acc.reconciliations, events };
}

/** Procesa UN lote de avisos guardados. Devuelve estadísticas; un lote vacío no hace ninguna consulta de cuentas ni al proveedor. */
export async function processEventBatch(deps: ProcessorDeps): Promise<BatchStats> {
  const stats = emptyStats();
  const maxAttempts = deps.maxAttempts ?? DEFAULTS.maxAttempts;
  const events = await deps.store.claimEvents({ limit: deps.batchSize ?? DEFAULTS.batchSize, leaseSeconds: deps.leaseSeconds ?? DEFAULTS.leaseSeconds, worker: deps.worker, maxAttempts });
  stats.claimed = events.length;
  if (events.length === 0) return stats;
  const now = deps.now();

  // 1) Un pago distinto se consulta UNA vez por lote, con concurrencia acotada.
  const paymentIds = unique(events.map((event) => event.normalized.operation?.providerPaymentId).filter((id): id is string => !!id));
  const pulled = new Map<string, ProviderResult<ProviderOperation>>();
  await mapWithConcurrency(paymentIds, deps.providerConcurrency ?? DEFAULTS.providerConcurrency, async (id) => {
    stats.providerCalls += 1;
    pulled.set(id, await deps.provider.getOperation(id));
  });

  // 2) Propietarias en UNA consulta.
  const references = unique(events.map((event) => event.normalized.subscriberReference).filter((ref): ref is string => !!ref));
  const records: Map<string, SubscriberRecord> = references.length > 0 ? await deps.store.resolveSubscribers(references) : new Map();

  // 3) Conciliar cada aviso.
  const acc = newAccumulator();
  const outcomes: Array<{ event: StoredEvent; status: EventOutcome["status"]; result: string; ownerId: string | null; delay: number }> = [];
  for (const event of events) {
    const operation = event.normalized.operation;
    if (event.eventType !== "subscription:execution" || !operation) {
      outcomes.push({ event, status: "ignored", result: "ignored:unsupported_event_type", ownerId: null, delay: 0 });
      continue;
    }
    const result = pulled.get(operation.providerPaymentId);
    if (!result || !result.ok) {
      const kind = result && !result.ok ? result.error.kind : "unavailable";
      if (kind === "rejected") {
        // El proveedor no conoce ese pago: un aviso verificado que no se corresponde con nada real. Se conserva como anomalía.
        addAnomaly(acc, "unknown_reference", null, `unknown_reference:${operation.providerPaymentId}`, { providerPaymentId: operation.providerPaymentId });
        outcomes.push({ event, status: "ignored", result: "anomaly:unknown_reference", ownerId: null, delay: 0 });
      } else if (event.attempts + 1 >= maxAttempts) {
        addAnomaly(acc, "provider_unreachable", null, `provider_unreachable:${operation.providerPaymentId}`, { providerPaymentId: operation.providerPaymentId, kind });
        outcomes.push({ event, status: "dead", result: `dead:${kind}`, ownerId: null, delay: 0 });
      } else {
        outcomes.push({ event, status: "failed", result: `retry:${kind}`, ownerId: null, delay: backoffSeconds(event.attempts) });
      }
      continue;
    }
    const reconciled = reconcileOperation(result.data, { hintedReference: event.normalized.subscriberReference, hintedExecutionUid: operation.executionUid, records, expectLive: deps.expectLive });
    const text = applyReconciliation(acc, reconciled, deps.provider.name, operation.providerPaymentId);
    outcomes.push({ event, status: reconciled.kind === "fact" ? "processed" : "ignored", result: text, ownerId: reconciled.kind === "fact" ? reconciled.ownerId : "ownerId" in reconciled ? reconciled.ownerId : null, delay: 0 });
  }

  // 4) Recalcular las cuentas con cobros nuevos y escribir todo junto.
  const plans = await planOwners(deps, acc, [...acc.facts.keys()], now);
  const eventOutcomes: EventOutcome[] = outcomes.map((item) => ({ id: item.event.id, ownerId: item.ownerId, status: item.status, result: item.result, retryDelaySeconds: item.delay }));
  const commit = await deps.store.commitBatch(toCommit(plans, acc, eventOutcomes));

  for (const item of outcomes) {
    if (item.status === "failed") stats.retried += 1;
    else if (item.status === "dead") stats.dead += 1;
    else if (item.result === "fact") stats.facts += 1;
    else if (item.result.startsWith("anomaly:")) stats.anomalies += 1;
    else stats.ignored += 1;
  }
  stats.subscriptionsWritten = commit.subscriptionsWritten;
  stats.conflicts = commit.conflicts.length;
  return stats;
}

/** Procesa lotes hasta vaciar la cola o agotar `maxBatches` (para acotar el tiempo de una invocación). */
export async function drainEvents(deps: ProcessorDeps, maxBatches = 50): Promise<BatchStats> {
  const total = emptyStats();
  for (let index = 0; index < maxBatches; index += 1) {
    const stats = await processEventBatch(deps);
    for (const key of Object.keys(total) as Array<keyof BatchStats>) total[key] += stats[key];
    if (stats.claimed === 0) break;
  }
  return total;
}

export interface SweepStats {
  pages: number;
  evaluated: number;
  subscriptionsWritten: number;
  conflicts: number;
}

/**
 * Barrido del reloj: evalúa sólo las cuentas cuyo `next_check_at` ya venció (índice parcial), por páginas con cursor y por lotes.
 * Sin avisos ni consultas al proveedor: el estado sólo cambia por el paso del tiempo (vencimiento, fin de gracia, fin de la
 * cancelación). Una cuenta con anomalía no cambia y queda para la próxima corrida; el cursor evita reprocesarla en ésta.
 */
export async function runClockSweep(deps: Pick<ProcessorDeps, "store" | "provider" | "now" | "executionsPerOwner">, options: { pageSize?: number; maxPages?: number } = {}): Promise<SweepStats> {
  const stats: SweepStats = { pages: 0, evaluated: 0, subscriptionsWritten: 0, conflicts: 0 };
  const pageSize = options.pageSize ?? 500;
  const now = deps.now();
  let after: { at: string; ownerId: string } | null = null;
  for (let page = 0; page < (options.maxPages ?? 100); page += 1) {
    const due = await deps.store.dueSubscriptions({ nowIso: now.toISOString(), after, limit: pageSize });
    if (due.snapshots.length === 0) break;
    stats.pages += 1;
    stats.evaluated += due.snapshots.length;
    const acc = newAccumulator();
    const plans = await planOwners(deps as ProcessorDeps, acc, due.snapshots.map((snapshot) => snapshot.ownerId), now);
    const commit = await deps.store.commitBatch(toCommit(plans, acc, []));
    stats.subscriptionsWritten += commit.subscriptionsWritten;
    stats.conflicts += commit.conflicts.length;
    after = due.nextCursor;
    if (!after) break;
  }
  return stats;
}

export interface ProviderSweepStats {
  pages: number;
  operations: number;
  facts: number;
  anomalies: number;
}

const PROVIDER_SWEEP_CURSOR = "provider_operations";
const PROVIDER_SWEEP_OVERLAP_MS = 10 * 60 * 1000;

/**
 * Conciliación periódica contra el proveedor, paginada (50 por página) y por lotes: recupera los avisos que nunca llegaron.
 * El cursor sólo avanza cuando el barrido completo terminó bien; ante una caída del proveedor no se pierde nada (se reintenta
 * desde el mismo punto, con superposición de 10 minutos; los cobros repetidos son idempotentes).
 */
export async function runProviderSweep(deps: ProcessorDeps, options: { maxPages?: number } = {}): Promise<ProviderSweepStats> {
  const stats: ProviderSweepStats = { pages: 0, operations: 0, facts: 0, anomalies: 0 };
  const startedAt = deps.now();
  const cursor = await deps.store.getSweepCursor(PROVIDER_SWEEP_CURSOR);
  const since = new Date((cursor ? Date.parse(cursor) : startedAt.getTime() - 24 * 3_600_000) - PROVIDER_SWEEP_OVERLAP_MS).toISOString();
  const acc = newAccumulator();
  const operations: ProviderOperation[] = [];
  let page = 0;
  for (let guard = 0; guard < (options.maxPages ?? 200); guard += 1) {
    const result = await deps.provider.listOperations({ updatedFromIso: since, page, limit: 50 });
    if (!result.ok) return stats; // el cursor NO avanza: se reintenta desde el mismo punto
    stats.pages += 1;
    operations.push(...result.data.operations);
    if (result.data.nextPage === null) break;
    page = result.data.nextPage;
  }
  stats.operations = operations.length;
  const references = unique(operations.map((operation) => operation.subscriberReference).filter((ref): ref is string => !!ref));
  const records: Map<string, SubscriberRecord> = references.length > 0 ? await deps.store.resolveSubscribers(references) : new Map();
  for (const operation of operations) {
    const text = applyReconciliation(acc, reconcileOperation(operation, { hintedReference: null, hintedExecutionUid: null, records, expectLive: deps.expectLive }), deps.provider.name, operation.providerPaymentId);
    if (text === "fact") stats.facts += 1;
    else if (text.startsWith("anomaly:")) stats.anomalies += 1;
  }
  const plans = await planOwners(deps, acc, [...acc.facts.keys()], deps.now());
  await deps.store.commitBatch(toCommit(plans, acc, []));
  await deps.store.setSweepCursor(PROVIDER_SWEEP_CURSOR, startedAt.toISOString());
  return stats;
}
