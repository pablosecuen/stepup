import { providerFail, providerOk, type ListOperationsRequest, type NoticeParse, type ProviderAdapter, type ProviderErrorKind, type ProviderOperation, type ProviderResult, type ProviderSubscriberState, type ProviderSubscriberStatus } from "../provider.ts";
import type { PlanCode } from "../plans.ts";
import { parseNoticeBody, sha256Hex } from "./mobbex-normalize.ts";

/**
 * Adaptador FALSO y determinista (pruebas y demostración local; nunca habla con la red). Implementa TODO el puerto, incluidos
 * el sondeo por suscriptor, el cambio de medio de pago y las fallas inyectables (caída, timeout, rechazo, respuesta inválida).
 *
 * Reduce los avisos con el MISMO código que el adaptador de Mobbex (`parseNoticeBody`): un aviso nunca lleva autoridad.
 * El destino de «redirect» es un dominio `.invalid` (nunca resuelve), de modo que ningún flujo falso puede abrir un sitio real.
 */
type FakeMethod = "createCheckout" | "getOperation" | "listOperations" | "getSubscriber" | "getPaymentMethodUpdateUrl" | "cancelSubscriber" | "reactivateSubscriber" | "changePlan";

export class FakeProviderAdapter implements ProviderAdapter {
  readonly name = "fake" as const;
  readonly capabilities = { changePlan: true, paymentMethodUpdate: true } as const;
  readonly calls: Record<FakeMethod, number> = { createCheckout: 0, getOperation: 0, listOperations: 0, getSubscriber: 0, getPaymentMethodUpdateUrl: 0, cancelSubscriber: 0, reactivateSubscriber: 0, changePlan: 0 };
  readonly operations = new Map<string, ProviderOperation>();
  readonly checkouts = new Map<string, { checkoutUid: string; subscriberUid: string | null; redirectUrl: string }>();
  readonly subscribers = new Map<string, { status: ProviderSubscriberStatus; executionsReadable: boolean }>();
  readonly canceled = new Set<string>();
  /** Con qué plan se pidió cada cancelación / reactivación / consulta (las pruebas comprueban que siempre sea el de la suscripción del proveedor). */
  readonly planCalls: Array<{ method: "cancelSubscriber" | "reactivateSubscriber" | "getSubscriber" | "getPaymentMethodUpdateUrl"; subscriberUid: string; planCode: PlanCode }> = [];
  readonly planChanges: Array<{ subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }> = [];
  /** Datos del cliente recibidos en `createCheckout`, SÓLO para que las pruebas comprueben que nunca se guardan ni se registran. */
  readonly receivedCustomers: Array<{ email: string; name: string; identification: string }> = [];
  private failures: Array<{ method: FakeMethod; kind: ProviderErrorKind; remaining: number }> = [];

  /** Los próximos `times` llamados de `method` fallan con `kind` (caída, timeout, rechazo, respuesta inválida…). */
  injectFailure(method: FakeMethod, kind: ProviderErrorKind, times = 1): void {
    this.failures.push({ method, kind, remaining: times });
  }

  seedOperation(operation: ProviderOperation): void {
    this.operations.set(operation.providerPaymentId, operation);
  }

  seedSubscriber(subscriberUid: string, state: { status: ProviderSubscriberStatus; executionsReadable?: boolean } = { status: "active" }): void {
    this.subscribers.set(subscriberUid, { status: state.status, executionsReadable: state.executionsReadable ?? true });
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
    this.receivedCustomers.push({ ...request.customer });
    const existing = this.checkouts.get(request.idempotencyKey);
    if (existing) return providerOk(existing); // misma clave = mismo checkout
    const id = sha256Hex(request.idempotencyKey).slice(0, 12);
    const created = { checkoutUid: `fake_chk_${id}`, subscriberUid: `fake_sub_${id}`, redirectUrl: `https://fake-provider.invalid/subscribe/${id}` };
    this.checkouts.set(request.idempotencyKey, created);
    this.subscribers.set(created.subscriberUid, { status: "active", executionsReadable: true });
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

  async getSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<ProviderSubscriberState>> {
    const failure = this.takeFailure("getSubscriber");
    if (failure) return providerFail(failure);
    const subscriber = this.subscribers.get(input.subscriberUid);
    if (!subscriber) return providerFail("rejected");
    const operations = [...this.operations.values()].filter((operation) => operation.subscriberUid === input.subscriberUid);
    return providerOk({ status: this.canceled.has(input.subscriberUid) && subscriber.status === "active" ? "suspended" : subscriber.status, operations: subscriber.executionsReadable ? operations : [], executionsReadable: subscriber.executionsReadable });
  }

  async getPaymentMethodUpdateUrl(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ redirectUrl: string }>> {
    const failure = this.takeFailure("getPaymentMethodUpdateUrl");
    if (failure) return providerFail(failure);
    if (!this.subscribers.has(input.subscriberUid)) return providerFail("rejected");
    return providerOk({ redirectUrl: `https://fake-provider.invalid/payment-method/${sha256Hex(input.subscriberUid).slice(0, 12)}` });
  }

  async cancelSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ canceled: true }>> {
    const failure = this.takeFailure("cancelSubscriber");
    this.planCalls.push({ method: "cancelSubscriber", subscriberUid: input.subscriberUid, planCode: input.planCode });
    if (failure) return providerFail(failure);
    this.canceled.add(input.subscriberUid); // repetir no falla ni duplica
    const subscriber = this.subscribers.get(input.subscriberUid);
    if (subscriber && subscriber.status === "active") subscriber.status = "suspended";
    return providerOk({ canceled: true });
  }

  async reactivateSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ reactivated: true }>> {
    const failure = this.takeFailure("reactivateSubscriber");
    this.planCalls.push({ method: "reactivateSubscriber", subscriberUid: input.subscriberUid, planCode: input.planCode });
    if (failure) return providerFail(failure);
    this.canceled.delete(input.subscriberUid);
    const subscriber = this.subscribers.get(input.subscriberUid);
    if (subscriber && subscriber.status === "suspended") subscriber.status = "active";
    return providerOk({ reactivated: true });
  }

  async changePlan(input: { subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }): Promise<ProviderResult<{ changed: true }>> {
    const failure = this.takeFailure("changePlan");
    if (failure) return providerFail(failure);
    this.planChanges.push(input);
    return providerOk({ changed: true });
  }

  parseNotice(input: { rawBody: string; contentType: string | undefined; now: Date }): NoticeParse {
    return parseNoticeBody(input);
  }
}
