import type { BillingSnapshot, ExecutionFact, ExecutionOutcome } from "./ledger.ts";
import type { BillingPlan, PlanCode } from "./plans.ts";
import type { NoticeHint, WebhookEventType } from "./provider.ts";
import type { AnomalyKind, SubscriberRecord } from "./reconcile.ts";

/**
 * Puerto de persistencia de la facturación (M1). Toda lectura y escritura del módulo pasa por acá, y TODAS son por LOTES
 * (arreglos de identificadores o de filas): ninguna operación consulta una suscripción por vez dentro de un bucle. La
 * implementación de producción (`supabase-store.ts`) llama a las funciones SQL de la migración con la clave de servidor;
 * las pruebas de base usan las MISMAS funciones SQL sobre un Postgres real.
 */

export interface IngestRow {
  readonly dedupKey: string;
  readonly provider: "mobbex" | "fake";
  readonly eventType: WebhookEventType;
  readonly payloadHash: string;
  /** Sólo la pista mínima (identificadores): nunca estado, importe ni plan. */
  readonly hint: NoticeHint;
  readonly receivedAt: string;
}

export interface StoredEvent {
  readonly id: number;
  readonly eventType: WebhookEventType;
  readonly attempts: number;
  readonly hint: NoticeHint;
}

export interface ExecutionRow {
  readonly ownerId: string;
  readonly provider: "mobbex" | "fake";
  readonly executionUid: string;
  readonly providerPaymentId: string | null;
  readonly outcome: ExecutionOutcome;
  readonly planCode: PlanCode;
  readonly amountMinor: number;
  readonly currency: "ARS";
  readonly dueAt: string;
  readonly occurredAt: string;
}

export interface PeriodRow {
  readonly ownerId: string;
  readonly provider: "mobbex" | "fake";
  readonly executionUid: string;
  readonly planCode: PlanCode;
  readonly priceVersion: number;
  readonly amountMinor: number;
  readonly currency: "ARS";
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** Un período pagado que dejó de valer (devolución total o contracargo): se conserva en el historial pero ya no respalda el estado. */
export interface VoidedPeriod {
  readonly ownerId: string;
  readonly provider: "mobbex" | "fake";
  readonly executionUid: string;
}

export interface SubscriptionWrite {
  readonly snapshot: BillingSnapshot;
  /** Versión que se leyó: la escritura sólo se aplica si sigue siendo la vigente (control optimista de concurrencia). */
  readonly expectedVersion: number;
  readonly nextCheckAt: string | null;
}

export interface ReconciliationRow {
  readonly kind: AnomalyKind;
  readonly ownerId: string | null;
  readonly dedupeKey: string;
  /** Sólo metadatos no sensibles (identificadores y códigos). */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EventOutcome {
  readonly id: number;
  readonly ownerId: string | null;
  readonly status: "processed" | "ignored" | "failed" | "dead";
  readonly result: string;
  readonly retryDelaySeconds: number;
}

export interface ChangeRow {
  readonly ownerId: string;
  readonly kind: "plan_change" | "cancel" | "reactivate";
  readonly fromPlanCode: PlanCode | null;
  readonly toPlanCode: PlanCode | null;
  readonly effectiveAt: string | null;
  /** Misma clave = mismo cambio: repetir la acción no duplica el registro. */
  readonly idempotencyKey: string;
}

export interface CheckoutAttemptInput {
  readonly ownerId: string;
  readonly plan: BillingPlan;
  readonly provider: "mobbex" | "fake";
  readonly idempotencyKey: string;
  readonly expiresAt: string;
}

export interface CheckoutAttempt {
  readonly id: string;
  readonly ownerId: string;
  readonly planCode: PlanCode;
  readonly priceVersion: number;
  readonly amountMinor: number;
  readonly currency: "ARS";
  /** Referencia propia y opaca del suscriptor (sin datos personales) que se envía al proveedor. */
  readonly subscriberReference: string;
  /** Clave con la que se creó el intento: al reutilizarlo, el proveedor recibe SIEMPRE esta clave (misma clave = mismo checkout). */
  readonly idempotencyKey: string;
  readonly status: "open" | "completed" | "expired" | "failed" | "superseded";
  /** Enlace del proveedor donde se carga el medio de pago (ya creado): permite reutilizar el intento sin crear otro suscriptor. */
  readonly redirectUrl: string | null;
}

/** Suscriptor ya creado en el proveedor por un intento que se reemplazó: hay que cancelarlo allá. */
export interface StaleSubscriber {
  readonly uid: string;
  readonly planCode: PlanCode;
}

export type OpenCheckoutResult =
  | { readonly ok: true; readonly attempt: CheckoutAttempt; readonly created: boolean; readonly superseded: boolean; readonly stale: readonly StaleSubscriber[] }
  | { readonly ok: false; readonly reason: "not_allowed" | "plan_invalid" | "no_account" };

export interface CommitBatch {
  readonly executions: readonly ExecutionRow[];
  readonly periods: readonly PeriodRow[];
  readonly subscriptions: readonly SubscriptionWrite[];
  readonly reconciliations: readonly ReconciliationRow[];
  readonly events: readonly EventOutcome[];
  readonly changes?: readonly ChangeRow[];
  readonly voidedPeriods?: readonly VoidedPeriod[];
}

/** Resultado del sondeo de UN suscriptor: `nextAt` null = ya no hace falta sondearlo; `failed` = el proveedor no respondió. */
export interface PollResult {
  readonly ownerId: string;
  readonly nextAt: string | null;
  readonly failed: boolean;
}

/** Historial visible para la persona: nunca lleva identificadores del proveedor. */
export interface HistoryPeriod {
  readonly planCode: PlanCode;
  readonly amountMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Instante en que el período dejó de valer (devolución total o contracargo), o `null`. */
  readonly voidedAt: string | null;
}

export interface HistoryCharge {
  readonly outcome: ExecutionOutcome;
  readonly planCode: PlanCode;
  readonly amountMinor: number;
  readonly dueAt: string;
  readonly occurredAt: string;
}

export interface BillingHistory {
  readonly periods: readonly HistoryPeriod[];
  readonly charges: readonly HistoryCharge[];
}

/** Métricas de las colas (conteos acotados, sin datos de ninguna persona). */
export interface QueueStats {
  readonly pendingEvents: number;
  readonly processingEvents: number;
  readonly oldestPendingAt: string | null;
  readonly duePolls: number;
  readonly dueClock: number;
  readonly openReviews: number;
}

export interface CommitResult {
  /** Cuentas cuya versión cambió entre la lectura y la escritura: sus avisos vuelven a la cola y se reprocesan. */
  readonly conflicts: readonly string[];
  readonly subscriptionsWritten: number;
}

export interface DuePage {
  readonly snapshots: readonly BillingSnapshot[];
  readonly nextCursor: { readonly at: string; readonly ownerId: string } | null;
}

export interface BillingStore {
  /** Crea bajo demanda la fila de la propietaria (grandfathered si ya existía al fijar el corte; pending si es nueva) y la devuelve. */
  ensureAccount(ownerId: string): Promise<BillingSnapshot>;
  ingestEvents(rows: readonly IngestRow[]): Promise<{ inserted: number; duplicates: number }>;
  claimEvents(input: { limit: number; leaseSeconds: number; worker: string; maxAttempts: number }): Promise<StoredEvent[]>;
  /** Propietarias de las referencias y/o uids del proveedor dados (una consulta por lote). */
  resolveSubscribers(keys: { readonly references: readonly string[]; readonly uids: readonly string[] }): Promise<SubscriberRecord[]>;
  loadSubscriptions(ownerIds: readonly string[]): Promise<Map<string, BillingSnapshot>>;
  loadExecutions(ownerIds: readonly string[], perOwner: number): Promise<Map<string, ExecutionFact[]>>;
  commitBatch(batch: CommitBatch): Promise<CommitResult>;
  dueSubscriptions(input: { nowIso: string; after: { at: string; ownerId: string } | null; limit: number }): Promise<DuePage>;
  /** Reclama suscriptores para sondear con arrendamiento (nunca el mismo a dos trabajadores). */
  claimPolls(input: { readonly nowIso: string; readonly limit: number; readonly leaseSeconds: number }): Promise<string[]>;
  markPolled(results: readonly PollResult[]): Promise<void>;
  /** Conciliación prioritaria: los sondea en la próxima corrida. */
  prioritizePolls(ownerIds: readonly string[]): Promise<number>;
  queueStats(): Promise<QueueStats>;
  /** Períodos y cobros recientes de la propietaria (para la pantalla de facturación). */
  getHistory(ownerId: string, limit: number): Promise<BillingHistory>;
  getSweepCursor(name: string): Promise<string | null>;
  setSweepCursor(name: string, atIso: string): Promise<void>;
  /**
   * Abre (o reutiliza) el intento de pago de la cuenta de forma atómica: sólo desde un estado que permite empezar una
   * suscripción, uno solo abierto por cuenta (dos pestañas = el mismo intento) y con el precio releído del catálogo de la base.
   */
  openCheckoutAttempt(input: CheckoutAttemptInput): Promise<OpenCheckoutResult>;
  completeCheckoutAttempt(input: { readonly attemptId: string; readonly providerCheckoutUid: string; readonly providerSubscriberUid: string | null; readonly redirectUrl: string }): Promise<boolean>;
  failCheckoutAttempt(attemptId: string): Promise<void>;
  purgeRetention(input: { limit: number }): Promise<{ events: number; reconciliations: number }>;
}
