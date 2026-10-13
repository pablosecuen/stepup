import { createHmac, timingSafeEqual } from "node:crypto";
import { providerFail, providerOk, type ListOperationsRequest, type ProviderAdapter, type ProviderErrorKind, type ProviderOperation, type ProviderResult, type WebhookVerification } from "../provider.ts";
import type { PlanCode } from "../plans.ts";
import { normalizeWebhook, parseWebhookBody, sha256Hex } from "./mobbex-normalize.ts";

/**
 * Adaptador FALSO y determinista para pruebas (nunca se usa fuera de ellas). No hace ninguna llamada de red.
 *
 * El mecanismo de firma de acá (HMAC-SHA256 del cuerpo, encabezado `x-fake-signature`) es un DOBLE DE PRUEBA para poder ejercitar
 * la ruta «aviso verificado»; NO es el de Mobbex, que no documenta ninguno (ver `providers/mobbex.ts`).
 */
export const FAKE_SIGNATURE_HEADER = "x-fake-signature";
export const MAX_WEBHOOK_BYTES = 64 * 1024;

export function signFakeWebhook(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

type FakeMethod = "createCheckout" | "getOperation" | "listOperations" | "cancelSubscriber" | "reactivateSubscriber" | "changePlan";

export class FakeProviderAdapter implements ProviderAdapter {
  readonly name = "fake" as const;
  readonly calls: Record<FakeMethod, number> = { createCheckout: 0, getOperation: 0, listOperations: 0, cancelSubscriber: 0, reactivateSubscriber: 0, changePlan: 0 };
  readonly operations = new Map<string, ProviderOperation>();
  readonly checkouts = new Map<string, { checkoutUid: string; subscriberUid: string | null; redirectUrl: string }>();
  readonly canceled = new Set<string>();
  readonly planChanges: Array<{ subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }> = [];
  private failures: Array<{ method: FakeMethod; kind: ProviderErrorKind; remaining: number }> = [];

  private readonly webhookSecret: string | null;

  constructor(webhookSecret: string | null) {
    this.webhookSecret = webhookSecret;
  }

  /** Los próximos `times` llamados de `method` fallan con `kind` (caída, timeout, rechazo…). */
  injectFailure(method: FakeMethod, kind: ProviderErrorKind, times = 1): void {
    this.failures.push({ method, kind, remaining: times });
  }

  seedOperation(operation: ProviderOperation): void {
    this.operations.set(operation.providerPaymentId, operation);
  }

  private takeFailure(method: FakeMethod): ProviderErrorKind | null {
    this.calls[method] += 1;
    const failure = this.failures.find((item) => item.method === method && item.remaining > 0);
    if (!failure) return null;
    failure.remaining -= 1;
    return failure.kind;
  }

  async createCheckout(request: Parameters<ProviderAdapter["createCheckout"]>[0]): Promise<ProviderResult<{ checkoutUid: string; subscriberUid: string | null; redirectUrl: string }>> {
    const failure = this.takeFailure("createCheckout");
    if (failure) return providerFail(failure);
    const existing = this.checkouts.get(request.idempotencyKey);
    if (existing) return providerOk(existing); // misma clave = mismo checkout
    const id = sha256Hex(request.idempotencyKey).slice(0, 12);
    const created = { checkoutUid: `fake_chk_${id}`, subscriberUid: `fake_sub_${id}`, redirectUrl: `https://fake-provider.invalid/subscribe/${id}` };
    this.checkouts.set(request.idempotencyKey, created);
    return providerOk(created);
  }

  async getOperation(providerPaymentId: string): Promise<ProviderResult<ProviderOperation>> {
    const failure = this.takeFailure("getOperation");
    if (failure) return providerFail(failure);
    const operation = this.operations.get(providerPaymentId);
    return operation ? providerOk(operation) : providerFail("rejected");
  }

  async listOperations(request: ListOperationsRequest): Promise<ProviderResult<{ operations: readonly ProviderOperation[]; nextPage: number | null }>> {
    const failure = this.takeFailure("listOperations");
    if (failure) return providerFail(failure);
    const limit = Math.min(Math.max(1, Math.trunc(request.limit)), 50);
    const matching = [...this.operations.values()]
      .filter((operation) => operation.occurredAt >= request.updatedFromIso)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.providerPaymentId < b.providerPaymentId ? -1 : 1));
    const start = request.page * limit;
    const operations = matching.slice(start, start + limit);
    return providerOk({ operations, nextPage: start + limit < matching.length ? request.page + 1 : null });
  }

  async cancelSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ canceled: true }>> {
    const failure = this.takeFailure("cancelSubscriber");
    if (failure) return providerFail(failure);
    this.canceled.add(input.subscriberUid); // repetir no falla ni duplica
    return providerOk({ canceled: true });
  }

  async reactivateSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ reactivated: true }>> {
    const failure = this.takeFailure("reactivateSubscriber");
    if (failure) return providerFail(failure);
    this.canceled.delete(input.subscriberUid);
    return providerOk({ reactivated: true });
  }

  async changePlan(input: { subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }): Promise<ProviderResult<{ changed: true }>> {
    const failure = this.takeFailure("changePlan");
    if (failure) return providerFail(failure);
    this.planChanges.push(input);
    return providerOk({ changed: true });
  }

  verifyWebhook(input: { rawBody: string; headers: Readonly<Record<string, string | undefined>>; now: Date }): WebhookVerification {
    if (!this.webhookSecret) return { verified: false, reason: "not_configured" };
    if (Buffer.byteLength(input.rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { verified: false, reason: "too_large" };
    const provided = input.headers[FAKE_SIGNATURE_HEADER];
    if (!provided) return { verified: false, reason: "signature_missing" };
    const expected = Buffer.from(signFakeWebhook(this.webhookSecret, input.rawBody), "utf8");
    const given = Buffer.from(provided, "utf8");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { verified: false, reason: "signature_invalid" };
    const body = parseWebhookBody(input.rawBody, input.headers["content-type"]);
    const event = normalizeWebhook({ rawBody: input.rawBody, body, receivedAt: input.now });
    return event ? { verified: true, events: [event] } : { verified: false, reason: "malformed" };
  }
}
