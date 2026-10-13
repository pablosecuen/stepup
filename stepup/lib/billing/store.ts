import type { BillingSnapshot, ExecutionFact } from "./ledger.ts";
import type { BillingPlan, PlanCode } from "./plans.ts";
import type { NormalizedWebhookEvent, WebhookEventType } from "./provider.ts";
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
  readonly normalized: Pick<NormalizedWebhookEvent, "operation" | "subscriberUid" | "subscriberReference">;
  readonly receivedAt: string;
}

export interface StoredEvent {
  readonly id: number;
  readonly eventType: WebhookEventType;
  readonly attempts: number;
  readonly normalized: IngestRow["normalized"];
}

export interface ExecutionRow {
  readonly ownerId: string;
  readonly provider: "mobbex" | "fake";
  readonly executionUid: string;
  readonly providerPaymentId: string | null;
  readonly outcome: "approved" | "rejected";
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
}

export type OpenCheckoutResult =
  | { readonly ok: true; readonly attempt: CheckoutAttempt; readonly created: boolean; readonly superseded: boolean }
  | { readonly ok: false; readonly reason: "not_allowed" | "plan_invalid" | "no_account" };

export interface CommitBatch {
  readonly executions: readonly ExecutionRow[];
  readonly periods: readonly PeriodRow[];
  readonly subscriptions: readonly SubscriptionWrite[];
  readonly reconciliations: readonly ReconciliationRow[];
  readonly events: readonly EventOutcome[];
  readonly changes?: readonly ChangeRow[];
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
  resolveSubscribers(references: readonly string[]): Promise<Map<string, SubscriberRecord>>;
  loadSubscriptions(ownerIds: readonly string[]): Promise<Map<string, BillingSnapshot>>;
  loadExecutions(ownerIds: readonly string[], perOwner: number): Promise<Map<string, ExecutionFact[]>>;
  commitBatch(batch: CommitBatch): Promise<CommitResult>;
  dueSubscriptions(input: { nowIso: string; after: { at: string; ownerId: string } | null; limit: number }): Promise<DuePage>;
  getSweepCursor(name: string): Promise<string | null>;
  setSweepCursor(name: string, atIso: string): Promise<void>;
  /**
   * Abre (o reutiliza) el intento de pago de la cuenta de forma atómica: sólo desde un estado que permite empezar una
   * suscripción, uno solo abierto por cuenta (dos pestañas = el mismo intento) y con el precio releído del catálogo de la base.
   */
  openCheckoutAttempt(input: CheckoutAttemptInput): Promise<OpenCheckoutResult>;
  completeCheckoutAttempt(input: { readonly attemptId: string; readonly providerCheckoutUid: string; readonly providerSubscriberUid: string | null }): Promise<boolean>;
  failCheckoutAttempt(attemptId: string): Promise<void>;
  purgeRetention(input: { limit: number }): Promise<{ events: number; reconciliations: number }>;
}
