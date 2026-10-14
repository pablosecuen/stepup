import { buildCoverage, finalOutcomes, nextCheckAt, reduceSnapshot, type BillingSnapshot, type ExecutionFact } from "./ledger.ts";
import { logBilling } from "./log.ts";
import { getPlan, type PlanCode } from "./plans.ts";
import { pollDelayMs, withJitter } from "./poll-policy.ts";
import type { NoticeHint, ProviderAdapter, ProviderOperation, ProviderResult, ProviderSubscriberState } from "./provider.ts";
import { reconcileOperation, type AnomalyKind, type Reconciliation, type SubscriberRecord } from "./reconcile.ts";
import type { BillingStore, ChangeRow, CommitBatch, EventOutcome, ExecutionRow, PeriodRow, PollResult, ReconciliationRow, StoredEvent, SubscriptionWrite, VoidedPeriod } from "./store.ts";

/**
 * Procesamiento diferido de la facturación. Todo el trabajo pesado ocurre FUERA del pedido del proveedor: el aviso sólo se reduce
 * a una pista y se guarda (`webhook-ingest.ts`), y acá se concilia por lotes:
 *
 *   reclamar un lote (con arrendamiento) → resolver las propietarias en UNA consulta → descartar sin consultar al proveedor todo lo
 *   que no pertenece a un suscriptor nuestro → consultar cada pago distinto UNA vez (consulta autenticada) → leer cuentas y cobros
 *   en dos consultas → recalcular en memoria → escribir todo en UNA transacción.
 *
 * Garantías: ninguna consulta a la base por suscripción dentro de un bucle; cada cobro es idempotente (clave única por ejecución);
 * un aviso cuya cuenta cambió en el medio vuelve a la cola; si el proceso se interrumpe, el arrendamiento vence y el lote se
 * reclama de nuevo (nada se pierde y nada se activa dos veces); ningún estado se decide con el cuerpo de un aviso.
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
  /** Avisos de un suscriptor que no es nuestro: se descartan SIN consultar al proveedor. */
  unknownSubscriber: number;
  /** Avisos que sólo pidieron un sondeo prioritario del suscriptor. */
  pollsRequested: number;
}

const DEFAULTS = { batchSize: 500, leaseSeconds: 120, maxAttempts: 8, providerConcurrency: 8, executionsPerOwner: 24 } as const;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3_600;

export function emptyStats(): BatchStats {
  return { claimed: 0, facts: 0, ignored: 0, anomalies: 0, retried: 0, dead: 0, providerCalls: 0, subscriptionsWritten: 0, conflicts: 0, unknownSubscriber: 0, pollsRequested: 0 };
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
  readonly changes: ChangeRow[];
  /** Correcciones al estado guardado que salieron de una consulta autenticada al proveedor (p. ej. cancelación hecha allá). */
  readonly patches: Map<string, Partial<BillingSnapshot>>;
}

function newAccumulator(): Accumulator {
  return { facts: new Map(), reconciliations: [], dedupe: new Set(), changes: [], patches: new Map() };
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
      // Devolución total aplicada y contracargo conciliado: quedan auditados (sin datos sensibles) y el contracargo queda en revisión.
      if (result.audit) addAnomaly(acc, result.audit, result.ownerId, `${result.audit}:${result.providerPaymentId}`, { providerPaymentId: result.providerPaymentId, provider });
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
  /** Estado resultante del recálculo (haya cambiado o no): lo usa el sondeo para decidir la próxima consulta. */
  readonly final: BillingSnapshot;
  readonly executions: ExecutionRow[];
  readonly periods: PeriodRow[];
  readonly voided: VoidedPeriod[];
}

/** Recalcula las cuentas afectadas con TODOS sus cobros conocidos (los guardados + los nuevos) y arma lo que hay que escribir. */
async function planOwners(deps: Pick<ProcessorDeps, "store" | "provider" | "executionsPerOwner">, acc: Accumulator, ownerIds: readonly string[], now: Date): Promise<Map<string, OwnerPlan>> {
  const plans = new Map<string, OwnerPlan>();
  if (ownerIds.length === 0) return plans;
  const perOwner = deps.executionsPerOwner ?? DEFAULTS.executionsPerOwner;
  const [snapshots, stored] = await Promise.all([deps.store.loadSubscriptions(ownerIds), deps.store.loadExecutions(ownerIds, perOwner)]);
  for (const ownerId of ownerIds) {
    const loaded = snapshots.get(ownerId);
    if (!loaded) continue;
    const patch = acc.patches.get(ownerId);
    const snapshot: BillingSnapshot = patch ? { ...loaded, ...patch } : loaded;
    const incoming = acc.facts.get(ownerId) ?? [];
    const known: ExecutionFact[] = [...(stored.get(ownerId) ?? []), ...incoming.map((item) => item.fact)];
    const reduced = reduceSnapshot(snapshot, known, now);
    for (const anomaly of reduced.anomalies) {
      const key = anomaly.code === "paid_after_cancel" ? `paid_after_cancel:${anomaly.executionId}` : `impossible_transition:${ownerId}:${anomaly.from}>${anomaly.to}`;
      addAnomaly(acc, anomaly.code, ownerId, key, anomaly.code === "paid_after_cancel" ? { executionId: anomaly.executionId } : { from: anomaly.from, to: anomaly.to });
    }
    // Varios avisos del mismo cobro en un lote (aprobado, liquidado, devuelto…) se reducen a UN resultado por ejecución.
    const paymentOf = new Map(incoming.map((item) => [item.fact.executionId, item.providerPaymentId] as const));
    const incomingFinals = finalOutcomes(incoming.map((item) => item.fact));
    const executions: ExecutionRow[] = incomingFinals.map((fact) => ({
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
    // Un cobro devuelto (total) o contracargado conserva su período en el historial, pero deja de valer.
    const voided: VoidedPeriod[] = incomingFinals.filter((fact) => fact.outcome === "refunded" || fact.outcome === "chargeback").map((fact) => ({ ownerId, provider: deps.provider.name, executionUid: fact.executionId }));
    // Sólo se escriben los períodos que cambian respecto de lo ya guardado (una renovación escribe una fila, no el historial entero).
    const periods: PeriodRow[] = [];
    const before = new Map(buildCoverage(finalOutcomes(stored.get(ownerId) ?? []).filter((fact) => fact.outcome === "approved")).map((period) => [period.executionId, period]));
    for (const period of buildCoverage(finalOutcomes(known).filter((fact) => fact.outcome === "approved"))) {
      const plan = getPlan(period.planCode);
      const previous = before.get(period.executionId);
      if (!plan || (previous && previous.startIso === period.startIso && previous.endIso === period.endIso && previous.planCode === period.planCode)) continue;
      periods.push({ ownerId, provider: deps.provider.name, executionUid: period.executionId, planCode: plan.code, priceVersion: plan.priceVersion, amountMinor: plan.amountMinor, currency: "ARS", periodStart: period.startIso, periodEnd: period.endIso });
    }
    // Se escribe si cambió el estado, si hay una corrección del proveedor o si la próxima revisión guardada ya no coincide con la que
    // corresponde (así una cuenta no queda «vencida» para siempre en el índice de vencimientos).
    const nextCheck = nextCheckAt(reduced.next);
    const subscription = reduced.changed || patch !== undefined || nextCheck !== loaded.nextCheckAt ? { snapshot: reduced.next, expectedVersion: loaded.version, nextCheckAt: nextCheck } : null;
    plans.set(ownerId, { subscription, final: reduced.next, executions, periods, voided });
  }
  return plans;
}

function toCommit(plans: ReadonlyMap<string, OwnerPlan>, acc: Accumulator, events: readonly EventOutcome[]): CommitBatch {
  const executions: ExecutionRow[] = [];
  const periods: PeriodRow[] = [];
  const subscriptions: SubscriptionWrite[] = [];
  const voidedPeriods: VoidedPeriod[] = [];
  for (const plan of plans.values()) {
    executions.push(...plan.executions);
    periods.push(...plan.periods);
    voidedPeriods.push(...plan.voided);
    if (plan.subscription) subscriptions.push(plan.subscription);
  }
  return { executions, periods, subscriptions, reconciliations: acc.reconciliations, events, changes: acc.changes, voidedPeriods };
}

/** Hora (número entero desde 1970): agrupa las anotaciones de avisos ajenos en una por hora, sin cortar el texto de una fecha. */
function hourBucket(now: Date): string {
  return String(Math.floor(now.getTime() / 3_600_000));
}

/** Procesa UN lote de avisos guardados. Devuelve estadísticas; un lote vacío no hace ninguna consulta de cuentas ni al proveedor. */
export async function processEventBatch(deps: ProcessorDeps): Promise<BatchStats> {
  const stats = emptyStats();
  const maxAttempts = deps.maxAttempts ?? DEFAULTS.maxAttempts;
  const events = await deps.store.claimEvents({ limit: deps.batchSize ?? DEFAULTS.batchSize, leaseSeconds: deps.leaseSeconds ?? DEFAULTS.leaseSeconds, worker: deps.worker, maxAttempts });
  stats.claimed = events.length;
  if (events.length === 0) return stats;
  const now = deps.now();

  // 1) Propietarias en UNA consulta: por referencia propia o por uid del proveedor. Un aviso que no pertenece a un suscriptor nuestro
  //    se descarta acá, SIN consultar al proveedor (un atacante no puede forzar consultas con identificadores inventados).
  const references = unique(events.map((event) => event.hint.subscriberReference).filter((value): value is string => !!value));
  const uids = unique(events.map((event) => event.hint.subscriberUid).filter((value): value is string => !!value));
  const records = references.length > 0 || uids.length > 0 ? await deps.store.resolveSubscribers({ references, uids }) : [];
  const byRef = new Map(records.map((record) => [record.subscriberReference, record] as const));
  const byUid = new Map(records.filter((record) => record.subscriberUid).map((record) => [record.subscriberUid as string, record] as const));
  const ownerOf = (hint: NoticeHint): { record: SubscriberRecord | null; conflict: boolean } => {
    const byReference = hint.subscriberReference ? byRef.get(hint.subscriberReference) : undefined;
    const byUidMatch = hint.subscriberUid ? byUid.get(hint.subscriberUid) : undefined;
    if (byReference && byUidMatch && byReference.ownerId !== byUidMatch.ownerId) return { record: null, conflict: true };
    return { record: byReference ?? byUidMatch ?? null, conflict: false };
  };

  const acc = newAccumulator();
  const outcomes: Array<{ event: StoredEvent; status: EventOutcome["status"]; result: string; ownerId: string | null; delay: number }> = [];
  const toPrioritize = new Set<string>();
  const lookups: Array<{ event: StoredEvent; record: SubscriberRecord; paymentId: string }> = [];

  for (const event of events) {
    const { record, conflict } = ownerOf(event.hint);
    if (conflict) {
      addAnomaly(acc, "owner_mismatch", null, `owner_mismatch:notice:${hourBucket(now)}`, {});
      outcomes.push({ event, status: "ignored", result: "anomaly:owner_mismatch", ownerId: null, delay: 0 });
      continue;
    }
    if (!record) {
      stats.unknownSubscriber += 1;
      addAnomaly(acc, "unknown_reference", null, `unknown_reference:notice:${hourBucket(now)}`, {}); // una sola anotación por hora, no una por aviso
      outcomes.push({ event, status: "ignored", result: "ignored:unknown_subscriber", ownerId: null, delay: 0 });
      continue;
    }
    if (event.eventType !== "subscription:execution") {
      // Registro, cambio de medio de pago, suspensión o reactivación: el aviso sólo pide mirar de nuevo a ese suscriptor.
      toPrioritize.add(record.ownerId);
      stats.pollsRequested += 1;
      outcomes.push({ event, status: "processed", result: "poll_requested", ownerId: record.ownerId, delay: 0 });
      continue;
    }
    if (!event.hint.providerPaymentId) {
      outcomes.push({ event, status: "ignored", result: "ignored:no_payment", ownerId: record.ownerId, delay: 0 });
      continue;
    }
    lookups.push({ event, record, paymentId: event.hint.providerPaymentId });
  }

  // 2) Un pago distinto se consulta UNA vez por lote, con concurrencia acotada. La consulta autenticada es la ÚNICA fuente del dinero.
  const paymentIds = unique(lookups.map((item) => item.paymentId));
  const pulled = new Map<string, ProviderResult<ProviderOperation>>();
  await mapWithConcurrency(paymentIds, deps.providerConcurrency ?? DEFAULTS.providerConcurrency, async (id) => {
    stats.providerCalls += 1;
    pulled.set(id, await deps.provider.getOperation(id));
  });

  // 3) Conciliar cada aviso con lo que dijo el proveedor.
  for (const { event, record, paymentId } of lookups) {
    const result = pulled.get(paymentId);
    if (!result || !result.ok) {
      const kind = result && !result.ok ? result.error.kind : "unavailable";
      if (kind === "rejected") {
        // El proveedor no conoce ese pago: un suscriptor nuestro con un pago que no existe. Se conserva como anomalía.
        addAnomaly(acc, "unknown_reference", record.ownerId, `unknown_reference:${paymentId}`, { providerPaymentId: paymentId });
        outcomes.push({ event, status: "ignored", result: "anomaly:unknown_reference", ownerId: record.ownerId, delay: 0 });
      } else if (event.attempts + 1 >= maxAttempts) {
        addAnomaly(acc, "provider_unreachable", record.ownerId, `provider_unreachable:${paymentId}`, { providerPaymentId: paymentId, kind });
        toPrioritize.add(record.ownerId); // el sondeo por suscriptor es la segunda red
        outcomes.push({ event, status: "dead", result: `dead:${kind}`, ownerId: record.ownerId, delay: 0 });
      } else {
        outcomes.push({ event, status: "failed", result: `retry:${kind}`, ownerId: null, delay: backoffSeconds(event.attempts) });
      }
      continue;
    }
    const reconciled = reconcileOperation(result.data, { hintedReference: record.subscriberReference, hintedExecutionUid: event.hint.executionUid, records: byRef, expectLive: deps.expectLive });
    const text = applyReconciliation(acc, reconciled, deps.provider.name, paymentId);
    outcomes.push({ event, status: reconciled.kind === "fact" ? "processed" : "ignored", result: text, ownerId: reconciled.kind === "fact" ? reconciled.ownerId : "ownerId" in reconciled ? reconciled.ownerId : record.ownerId, delay: 0 });
  }

  // 4) Recalcular las cuentas con cobros nuevos y escribir todo junto.
  const plans = await planOwners(deps, acc, [...acc.facts.keys()], now);
  const eventOutcomes: EventOutcome[] = outcomes.map((item) => ({ id: item.event.id, ownerId: item.ownerId, status: item.status, result: item.result, retryDelaySeconds: item.delay }));
  const commit = await deps.store.commitBatch(toCommit(plans, acc, eventOutcomes));
  if (toPrioritize.size > 0) await deps.store.prioritizePolls([...toPrioritize]);

  for (const item of outcomes) {
    if (item.status === "failed") stats.retried += 1;
    else if (item.status === "dead") stats.dead += 1;
    else if (item.result === "fact") stats.facts += 1;
    else if (item.result.startsWith("anomaly:")) stats.anomalies += 1;
    else if (item.result !== "poll_requested") stats.ignored += 1;
  }
  stats.subscriptionsWritten = commit.subscriptionsWritten;
  stats.conflicts = commit.conflicts.length;
  return stats;
}

/** Procesa lotes hasta vaciar la cola o agotar `maxBatches` / el tiempo disponible (`deadlineAt`, ms epoch). */
export async function drainEvents(deps: ProcessorDeps, maxBatches = 50, deadlineAt?: number): Promise<BatchStats> {
  const total = emptyStats();
  for (let index = 0; index < maxBatches; index += 1) {
    if (deadlineAt !== undefined && deps.now().getTime() >= deadlineAt) break;
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
    const plans = await planOwners(deps, acc, due.snapshots.map((snapshot) => snapshot.ownerId), now);
    const commit = await deps.store.commitBatch(toCommit(plans, acc, []));
    stats.subscriptionsWritten += commit.subscriptionsWritten;
    stats.conflicts += commit.conflicts.length;
    after = due.nextCursor;
    if (!after) break;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Sondeo por suscriptor
// ---------------------------------------------------------------------------------------------------------------------------

export interface PollStats {
  batches: number;
  claimed: number;
  polled: number;
  failed: number;
  /** El proveedor no admite esta consulta todavía (sin credenciales o sin validar): se reintenta mucho más tarde y no cuenta como falla. */
  skipped: number;
  operations: number;
  facts: number;
  anomalies: number;
  repaired: number;
  resuspended: number;
  subscriptionsWritten: number;
  conflicts: number;
}

export function emptyPollStats(): PollStats {
  return { batches: 0, claimed: 0, polled: 0, failed: 0, skipped: 0, operations: 0, facts: 0, anomalies: 0, repaired: 0, resuspended: 0, subscriptionsWritten: 0, conflicts: 0 };
}

const SKIP_DELAY_MS = 24 * 3_600_000;
const CONFLICT_RETRY_MS = 60_000;

/**
 * Sondeo por suscriptor: recupera los avisos que nunca llegaron y mantiene a la base alineada con el proveedor. Toma un lote de
 * suscriptores vencidos (con arrendamiento: dos trabajadores jamás reciben al mismo), consulta al proveedor UNA vez por suscriptor
 * (concurrencia acotada), concilia lo que informe y escribe todo en UNA transacción. La base se toca por LOTES: cargar cuentas,
 * cobros, escribir y reprogramar — nunca una consulta por suscripción. Ante una caída del proveedor reprograma con espera exponencial
 * y, tras 8 fallas seguidas, deja una revisión abierta.
 *
 * Reparación (decisión «proveedor primero»): si el proveedor ya NO cobra (suspendido o terminado) y la base no lo sabe porque falló
 * después de confirmarse allá, se adopta la cancelación. Al revés (la base dice cancelada y el proveedor sigue cobrando) se vuelve a
 * suspender — nunca se arriesga un cobro a quien canceló.
 */
export async function runSubscriberPoll(deps: ProcessorDeps, options: { limit?: number; leaseSeconds?: number; maxBatches?: number; deadlineAt?: number } = {}): Promise<PollStats> {
  const stats = emptyPollStats();
  const limit = options.limit ?? 200;
  for (let batch = 0; batch < (options.maxBatches ?? 10); batch += 1) {
    if (options.deadlineAt !== undefined && deps.now().getTime() >= options.deadlineAt) break;
    const now = deps.now();
    const claimed = await deps.store.claimPolls({ nowIso: now.toISOString(), limit, leaseSeconds: options.leaseSeconds ?? 300 });
    if (claimed.length === 0) break;
    stats.batches += 1;
    stats.claimed += claimed.length;

    const snapshots = await deps.store.loadSubscriptions(claimed);
    const acc = newAccumulator();
    const outcome = new Map<string, { state: ProviderSubscriberState | null; skipped: boolean; failed: boolean; planCode: PlanCode | null }>();
    const targets = claimed.filter((ownerId) => snapshots.has(ownerId));
    const resuspend: Array<{ ownerId: string; uid: string; planCode: PlanCode }> = [];

    await mapWithConcurrency(targets, deps.providerConcurrency ?? DEFAULTS.providerConcurrency, async (ownerId) => {
      const snapshot = snapshots.get(ownerId) as BillingSnapshot;
      const planCode = snapshot.providerPlanCode ?? snapshot.planCode;
      if (!snapshot.providerSubscriberUid || !planCode) {
        outcome.set(ownerId, { state: null, skipped: true, failed: false, planCode });
        return;
      }
      const result = await deps.provider.getSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode });
      if (result.ok) outcome.set(ownerId, { state: result.data, skipped: false, failed: false, planCode });
      else outcome.set(ownerId, { state: null, skipped: result.error.kind === "unsupported" || result.error.kind === "not_configured", failed: !(result.error.kind === "unsupported" || result.error.kind === "not_configured"), planCode });
    });

    for (const ownerId of targets) {
      const snapshot = snapshots.get(ownerId) as BillingSnapshot;
      const polled = outcome.get(ownerId);
      if (!polled?.state) continue;
      const state = polled.state;
      stats.polled += 1;
      const record: SubscriberRecord = { ownerId, subscriberReference: snapshot.providerReference, subscriberUid: snapshot.providerSubscriberUid, acceptablePlans: unique([snapshot.planCode, snapshot.pendingPlanCode, polled.planCode].filter((code): code is PlanCode => !!code)) };
      const records = new Map([[record.subscriberReference, record]]);
      if (state.executionsReadable) {
        for (const operation of state.operations) {
          stats.operations += 1;
          const text = applyReconciliation(acc, reconcileOperation(operation, { hintedReference: record.subscriberReference, hintedExecutionUid: null, records, expectLive: deps.expectLive }), deps.provider.name, operation.providerPaymentId);
          if (text === "fact") stats.facts += 1;
          else if (text.startsWith("anomaly:")) stats.anomalies += 1;
        }
      }
      const open = !["canceled", "expired", "pending", "grandfathered"].includes(snapshot.status);
      if (state.status === "suspended" && open && !snapshot.cancelRequestedAt) {
        acc.patches.set(ownerId, { ...acc.patches.get(ownerId), cancelRequestedAt: now.toISOString() });
        acc.changes.push({ ownerId, kind: "cancel", fromPlanCode: snapshot.planCode, toPlanCode: null, effectiveAt: snapshot.currentPeriodEnd, idempotencyKey: `repair_cancel:${snapshot.providerSubscriberUid}` });
        stats.repaired += 1;
      } else if (state.status === "finished" && open && !snapshot.providerEndedAt) {
        acc.patches.set(ownerId, { ...acc.patches.get(ownerId), providerEndedAt: now.toISOString() });
        stats.repaired += 1;
      } else if (state.status === "active" && snapshot.cancelRequestedAt && snapshot.providerSubscriberUid && polled.planCode) {
        resuspend.push({ ownerId, uid: snapshot.providerSubscriberUid, planCode: polled.planCode });
        addAnomaly(acc, "provider_state_mismatch", ownerId, `provider_state_mismatch:${ownerId}`, { providerStatus: "active", localStatus: snapshot.status });
      }
    }
    await mapWithConcurrency(resuspend, deps.providerConcurrency ?? DEFAULTS.providerConcurrency, async (item) => {
      const result = await deps.provider.cancelSubscriber({ subscriberUid: item.uid, planCode: item.planCode });
      if (result.ok) stats.resuspended += 1;
    });

    const plans = await planOwners(deps, acc, [...new Set([...acc.facts.keys(), ...acc.patches.keys(), ...targets])], now);
    const commit = await deps.store.commitBatch(toCommit(plans, acc, []));
    stats.subscriptionsWritten += commit.subscriptionsWritten;
    stats.conflicts += commit.conflicts.length;
    const conflicted = new Set(commit.conflicts);

    const results: PollResult[] = [];
    for (const ownerId of claimed) {
      const polled = outcome.get(ownerId);
      const snapshot = snapshots.get(ownerId);
      if (!snapshot || !polled) {
        results.push({ ownerId, nextAt: null, failed: false }); // la cuenta ya no existe
        continue;
      }
      if (polled.failed) {
        stats.failed += 1;
        results.push({ ownerId, nextAt: null, failed: true });
        continue;
      }
      if (polled.skipped || !polled.state) {
        stats.skipped += 1;
        results.push({ ownerId, nextAt: new Date(now.getTime() + SKIP_DELAY_MS).toISOString(), failed: false });
        continue;
      }
      if (conflicted.has(ownerId)) {
        results.push({ ownerId, nextAt: new Date(now.getTime() + CONFLICT_RETRY_MS).toISOString(), failed: false });
        continue;
      }
      const final = plans.get(ownerId)?.final ?? snapshot;
      const delay = pollDelayMs({ status: final.status, currentPeriodEnd: final.currentPeriodEnd, providerStatus: polled.state.status, now });
      results.push({ ownerId, nextAt: delay === null ? null : new Date(now.getTime() + withJitter(delay, ownerId)).toISOString(), failed: false });
    }
    await deps.store.markPolled(results);
    logBilling("poll", "batch", { count: claimed.length, provider: deps.provider.name });
    if (claimed.length < limit) break;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Barrido global del proveedor
// ---------------------------------------------------------------------------------------------------------------------------

export interface ProviderSweepStats {
  pages: number;
  operations: number;
  facts: number;
  anomalies: number;
  /** El proveedor no admite el listado global (Mobbex hoy): el sondeo por suscriptor es la red de seguridad. */
  skipped: boolean;
}

const PROVIDER_SWEEP_CURSOR = "provider_operations";
const PROVIDER_SWEEP_OVERLAP_MS = 10 * 60 * 1000;

/**
 * Conciliación periódica contra el proveedor, paginada (50 por página) y por lotes. El cursor sólo avanza cuando el barrido completo
 * terminó bien; ante una caída del proveedor no se pierde nada (se reintenta desde el mismo punto, con superposición de 10 minutos;
 * los cobros repetidos son idempotentes). Con un proveedor que no admite el listado (`unsupported`) no hace nada.
 */
export async function runProviderSweep(deps: ProcessorDeps, options: { maxPages?: number } = {}): Promise<ProviderSweepStats> {
  const stats: ProviderSweepStats = { pages: 0, operations: 0, facts: 0, anomalies: 0, skipped: false };
  const startedAt = deps.now();
  const cursor = await deps.store.getSweepCursor(PROVIDER_SWEEP_CURSOR);
  const since = new Date((cursor ? Date.parse(cursor) : startedAt.getTime() - 24 * 3_600_000) - PROVIDER_SWEEP_OVERLAP_MS).toISOString();
  const acc = newAccumulator();
  const operations: ProviderOperation[] = [];
  let page = 0;
  for (let guard = 0; guard < (options.maxPages ?? 200); guard += 1) {
    const result = await deps.provider.listOperations({ updatedFromIso: since, page, limit: 50 });
    if (!result.ok) {
      stats.skipped = result.error.kind === "unsupported" || result.error.kind === "not_configured";
      return stats; // el cursor NO avanza: se reintenta desde el mismo punto
    }
    stats.pages += 1;
    operations.push(...result.data.operations);
    if (result.data.nextPage === null) break;
    page = result.data.nextPage;
  }
  stats.operations = operations.length;
  const references = unique(operations.map((operation) => operation.subscriberReference).filter((ref): ref is string => !!ref));
  const uids = unique(operations.map((operation) => operation.subscriberUid).filter((uid): uid is string => !!uid));
  const records = references.length > 0 || uids.length > 0 ? await deps.store.resolveSubscribers({ references, uids }) : [];
  const byRef = new Map(records.map((record) => [record.subscriberReference, record] as const));
  const byUid = new Map(records.filter((record) => record.subscriberUid).map((record) => [record.subscriberUid as string, record] as const));
  for (const operation of operations) {
    const record = (operation.subscriberReference ? byRef.get(operation.subscriberReference) : undefined) ?? (operation.subscriberUid ? byUid.get(operation.subscriberUid) : undefined);
    const text = applyReconciliation(acc, reconcileOperation(operation, { hintedReference: record?.subscriberReference ?? null, hintedExecutionUid: null, records: byRef, expectLive: deps.expectLive }), deps.provider.name, operation.providerPaymentId);
    if (text === "fact") stats.facts += 1;
    else if (text.startsWith("anomaly:")) stats.anomalies += 1;
  }
  const plans = await planOwners(deps, acc, [...acc.facts.keys()], deps.now());
  await deps.store.commitBatch(toCommit(plans, acc, []));
  await deps.store.setSweepCursor(PROVIDER_SWEEP_CURSOR, startedAt.toISOString());
  return stats;
}
