import { addDaysToDateKey } from "../../calendar/timezone.ts";
import { civilDayOf } from "../periods.ts";
import { PLAN_CODES, getPlan, isPlanCode, type PlanCode } from "../plans.ts";
import { providerFail, providerOk, type CheckoutRequest, type CheckoutResponse, type NoticeParse, type ProviderAdapter, type ProviderCapabilities, type ProviderOperation, type ProviderResult, type ProviderSubscriberState } from "../provider.ts";
import { REFERENCE_PARAM, SUBSCRIBER_REFERENCE_PATTERN, mapSubscriptionStatus, operationFromPayment, parseRebillNotice, unwrap, verifyNoticeSignature } from "./rebill-normalize.ts";

/**
 * Adaptador de Rebill (docs.rebill.com) — la suscripción de la profesora a TeacherFlow. NADA de esto interviene en los cobros que la profesora registra a sus alumnos.
 *
 * Cómo se contrata: el servidor resuelve el plan del catálogo y devuelve la dirección del «payment link» de ESE plan (creado una sola vez por plan: `scripts/rebill-
 * provision.mjs`) con nuestra referencia opaca (`tf_ref`, sin datos personales) y el correo de la sesión. Rebill carga la tarjeta en su sitio (`pay.rebill.com`), cobra el
 * total del período y crea la suscripción recurrente. Volver de ahí NO activa nada: el acceso lo da un cobro conciliado con la consulta autenticada (`GET /v3/payments/:id`).
 *
 * Cómo se vincula el cobro con la cuenta: el primer pago trae nuestra referencia en `metadata` (Rebill guarda en el pago los parámetros extra de la dirección); la
 * referencia es un token opaco de 128 bits que sólo conoce la propietaria. Al conciliar ese primer cobro se vincula el `sub_…` de Rebill a la cuenta, y las
 * renovaciones se resuelven por ese uid.
 *
 * Seguridad: secretos sólo del servidor (`REBILL_API_KEY` = clave secreta `sk_…`, `REBILL_WEBHOOK_SECRET`); sandbox y producción NUNCA se mezclan (organizaciones y
 * claves distintas; los identificadores de prueba llevan `test_`); sin credenciales o con una configuración inconsistente el adaptador queda CERRADO y no hace ninguna
 * llamada de red. Los avisos se verifican con la firma HMAC documentada y, aun firmados, son sólo señales.
 */
export type RebillEnvironment = "sandbox" | "production";

export interface RebillConfig {
  readonly apiKey: string;
  readonly environment: RebillEnvironment;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Plan (`pln_…`) de Rebill de cada plan del catálogo. Son identificadores, no secretos. */
  readonly planIds: Readonly<Partial<Record<PlanCode, string>>>;
  /** Dirección del payment link de cada plan en `pay.rebill.com`. */
  readonly checkoutUrls: Readonly<Partial<Record<PlanCode, string>>>;
  readonly webhookSecret: string | null;
  readonly validatedCapabilities: ReadonlySet<keyof ProviderCapabilities>;
  readonly fetchImpl: typeof fetch;
  readonly now: () => Date;
}

const DEFAULT_BASE_URL = "https://api.rebill.com";
const CHECKOUT_HOST = "pay.rebill.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const SUBSCRIPTION_CACHE_MS = 60_000;
const PLAN_ID_PATTERN = /^(?:test_)?pln_[A-Za-z0-9_-]{4,100}$/;

function planEnvName(prefix: string, code: PlanCode): string {
  return `${prefix}_${code.toUpperCase()}`;
}

export function isRebillCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === CHECKOUT_HOST && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

/**
 * Lee la configuración del entorno del SERVIDOR. `null` (adaptador cerrado) si faltan credenciales o si la configuración mezcla ambientes: una clave `pk_`, un ambiente no
 * declarado, o identificadores de plan que no corresponden al ambiente (en `sandbox` todos llevan `test_`; en `production` ninguno).
 */
export function readRebillConfig(env: Readonly<Record<string, string | undefined>> = process.env, overrides: Partial<Pick<RebillConfig, "fetchImpl" | "now">> = {}): RebillConfig | null {
  const apiKey = env.REBILL_API_KEY?.trim();
  const environment = env.REBILL_ENVIRONMENT?.trim().toLowerCase();
  if (!apiKey || !apiKey.startsWith("sk_") || (environment !== "sandbox" && environment !== "production")) return null;
  const planIds: Partial<Record<PlanCode, string>> = {};
  const checkoutUrls: Partial<Record<PlanCode, string>> = {};
  for (const code of PLAN_CODES) {
    const planId = env[planEnvName("REBILL_PLAN_ID", code)]?.trim();
    if (planId) {
      if (!PLAN_ID_PATTERN.test(planId) || planId.startsWith("test_") !== (environment === "sandbox")) return null; // ambientes mezclados: se cierra todo
      planIds[code] = planId;
    }
    const checkoutUrl = env[planEnvName("REBILL_CHECKOUT_URL", code)]?.trim();
    if (checkoutUrl) {
      if (!isRebillCheckoutUrl(checkoutUrl)) return null;
      checkoutUrls[code] = checkoutUrl;
    }
  }
  return {
    apiKey,
    environment,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    planIds,
    checkoutUrls,
    webhookSecret: env.REBILL_WEBHOOK_SECRET?.trim() || null,
    validatedCapabilities: new Set((env.REBILL_VALIDATED_CAPABILITIES ?? "").split(",").map((item) => item.trim()).filter((item): item is keyof ProviderCapabilities => item === "changePlan" || item === "paymentMethodUpdate")),
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Pedidos (puros): lo que se le envía a Rebill, tal como lo documenta la API.
// ---------------------------------------------------------------------------

export interface RebillRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly json?: unknown;
}

export const buildGetPaymentRequest = (paymentId: string): RebillRequest => ({ method: "GET", path: `/v3/payments/${encodeURIComponent(paymentId)}` });
export const buildGetSubscriptionRequest = (subscriptionId: string): RebillRequest => ({ method: "GET", path: `/v3/subscriptions/${encodeURIComponent(subscriptionId)}` });

/** Búsqueda paginada de pagos, los más recientemente actualizados primero (`sortBy: updated_at`): no depende de los nombres de los filtros de fecha. */
export function buildSearchPaymentsRequest(input: { limit: number; offset: number; subscriptionId?: string }): RebillRequest {
  return { method: "POST", path: "/v3/payments/search", json: { limit: Math.min(100, Math.max(1, input.limit)), offset: Math.max(0, input.offset), sortBy: "updated_at", sortOrder: "DESC", ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}) } };
}

/** Cancelar la renovación = PAUSAR (`PATCH status: paused`): conserva la suscripción y permite reanudarla. La baja `cancelled` de Rebill es terminal y no se usa. */
export const buildPauseRequest = (subscriptionId: string): RebillRequest => ({ method: "PATCH", path: `/v3/subscriptions/${encodeURIComponent(subscriptionId)}`, json: { status: "paused" } });
/** Reanudar exige la fecha del próximo cobro (hoy o posterior): el fin del período ya pagado. */
export const buildResumeRequest = (subscriptionId: string, nextChargeDateIso: string): RebillRequest => ({ method: "PATCH", path: `/v3/subscriptions/${encodeURIComponent(subscriptionId)}`, json: { status: "active", nextChargeDate: nextChargeDateIso } });
export const buildChangePlanRequest = (subscriptionId: string, planId: string): RebillRequest => ({ method: "PATCH", path: `/v3/subscriptions/${encodeURIComponent(subscriptionId)}/plan`, json: { planId } });
export const buildCardUpdateLinkRequest = (subscriptionId: string): RebillRequest => ({ method: "POST", path: `/v3/subscriptions/${encodeURIComponent(subscriptionId)}/card/update-link` });

/** Fecha civil AAAA-MM-DD → instante ISO del mediodía de Argentina (nunca cae en el día anterior por la zona). */
export function resumeInstantIso(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const time = Date.parse(`${dateKey}T12:00:00-03:00`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

interface SubscriptionInfo {
  readonly id: string;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly planCode: PlanCode | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export class RebillAdapter implements ProviderAdapter {
  readonly name = "rebill" as const;
  /** Rebill crea la suscripción con el primer cobro aprobado: el uid se vincula a la cuenta cuando ese cobro se concilia (ver processor.ts). */
  readonly bindsSubscriberOnPayment = true as const;
  /** Rebill pide nombre y documento en su propio sitio de pago: TeacherFlow sólo le pasa el correo de la sesión. */
  readonly requiresCustomerIdentity = false as const;
  readonly capabilities: ProviderCapabilities;
  private readonly config: RebillConfig | null;
  private readonly planCodeById: ReadonlyMap<string, PlanCode>;
  private readonly cache = new Map<string, { readonly at: number; readonly info: SubscriptionInfo }>();

  constructor(config: RebillConfig | null) {
    this.config = config;
    this.capabilities = { changePlan: config?.validatedCapabilities.has("changePlan") ?? false, paymentMethodUpdate: config?.validatedCapabilities.has("paymentMethodUpdate") ?? false };
    this.planCodeById = new Map(Object.entries(config?.planIds ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && isPlanCode(entry[0])).map(([code, planId]) => [planId, code as PlanCode] as const));
  }

  get environment(): RebillEnvironment | null {
    return this.config?.environment ?? null;
  }

  private async send(request: RebillRequest): Promise<ProviderResult<unknown>> {
    const config = this.config;
    if (!config) return providerFail("not_configured"); // sin credenciales: nunca se llega a la red
    const url = new URL(request.path, config.baseUrl);
    const headers: Record<string, string> = { "x-api-key": config.apiKey };
    let body: string | undefined;
    if (request.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.json);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await config.fetchImpl(url, { method: request.method, headers, body, signal: controller.signal, redirect: "error" });
      if (response.status === 401 || response.status === 403) return providerFail("unauthorized");
      if (response.status === 429 || response.status >= 500) return providerFail("unavailable"); // 429: se reintenta más tarde (Retry-After)
      if (response.status >= 400) return providerFail("rejected");
      const text = await response.text();
      if (text.length === 0) return providerOk(null); // algunos pedidos documentan una respuesta vacía
      try {
        return providerOk(JSON.parse(text));
      } catch {
        return providerFail("invalid_response");
      }
    } catch (error) {
      return providerFail(error instanceof Error && error.name === "AbortError" ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async subscription(subscriptionId: string): Promise<ProviderResult<SubscriptionInfo>> {
    const cached = this.cache.get(subscriptionId);
    const nowMs = this.config?.now().getTime() ?? 0;
    if (cached && nowMs - cached.at < SUBSCRIPTION_CACHE_MS) return providerOk(cached.info);
    const result = await this.send(buildGetSubscriptionRequest(subscriptionId));
    if (!result.ok) return result;
    const parsed = parseSubscription(result.data, this.planCodeById);
    if (!parsed) return providerFail("invalid_response");
    this.cache.set(subscriptionId, { at: nowMs, info: parsed });
    return providerOk(parsed);
  }

  private async operationOf(payment: Record<string, unknown>): Promise<ProviderResult<ProviderOperation | null>> {
    const subscriptionId = typeof payment.subscriptionId === "string" ? payment.subscriptionId : null;
    let planReference: string | null = null;
    if (subscriptionId) {
      const info = await this.subscription(subscriptionId);
      if (!info.ok) return info;
      planReference = info.data.planCode;
    }
    return providerOk(operationFromPayment(payment, planReference, (this.config?.now() ?? new Date()).toISOString()));
  }

  async createCheckout(request: CheckoutRequest): Promise<ProviderResult<CheckoutResponse>> {
    const config = this.config;
    if (!config) return providerFail("not_configured");
    const plan = getPlan(request.plan.code);
    const link = plan ? config.checkoutUrls[plan.code] : undefined;
    if (!plan || !plan.active || !link) return providerFail("not_configured");
    if (!SUBSCRIBER_REFERENCE_PATTERN.test(request.subscriberReference)) return providerFail("rejected");
    const url = new URL(link);
    url.searchParams.set(REFERENCE_PARAM, request.subscriberReference);
    url.searchParams.set("language", "es");
    if (request.customer.email) url.searchParams.set("email", request.customer.email); // sólo precarga el correo (de sólo lectura en la página de pago)
    return providerOk({ checkoutUid: `link:${plan.code}`, subscriberUid: null, redirectUrl: url.toString() });
  }

  async getOperation(providerPaymentId: string): Promise<ProviderResult<ProviderOperation>> {
    if (!this.config) return providerFail("not_configured");
    const result = await this.send(buildGetPaymentRequest(providerPaymentId));
    if (!result.ok) return result;
    const payment = unwrap(result.data, ["data", "result", "payment"]);
    if (!payment) return providerFail("invalid_response");
    const operation = await this.operationOf(payment);
    if (!operation.ok) return operation;
    return operation.data ? providerOk(operation.data) : providerFail("invalid_response");
  }

  /** Barrido global: pagos de suscripción actualizados desde `updatedFromIso`, los más recientes primero. Recupera lo que ningún aviso trajo (cierre del navegador, aviso perdido). */
  async listOperations(request: { updatedFromIso: string; page: number; limit: number }): Promise<ProviderResult<{ operations: readonly ProviderOperation[]; nextPage: number | null }>> {
    if (!this.config) return providerFail("not_configured");
    const limit = Math.min(100, Math.max(1, request.limit));
    const result = await this.send(buildSearchPaymentsRequest({ limit, offset: request.page * limit }));
    if (!result.ok) return result;
    const root = asRecord(result.data);
    const records = Array.isArray(root?.records) ? root.records : null;
    if (!records) return providerFail("invalid_response");
    const since = Date.parse(request.updatedFromIso);
    const operations: ProviderOperation[] = [];
    let reachedOlder = false;
    for (const raw of records) {
      const payment = asRecord(raw);
      if (!payment) continue;
      const updated = Date.parse(typeof payment.updatedAt === "string" ? payment.updatedAt : typeof payment.createdAt === "string" ? payment.createdAt : "");
      if (Number.isFinite(updated) && updated < since) {
        reachedOlder = true; // ordenado por actualización descendente: el resto es más viejo
        break;
      }
      const subscriptionId = typeof payment.subscriptionId === "string" ? payment.subscriptionId : null;
      const hasOurReference = asRecord(payment.metadata)?.[REFERENCE_PARAM] !== undefined;
      if (!subscriptionId && !hasOurReference) continue; // un pago único: no es de la suscripción de TeacherFlow
      const operation = await this.operationOf(payment);
      if (!operation.ok) return operation;
      if (operation.data) operations.push(operation.data);
    }
    const pagination = asRecord(root?.pagination);
    const more = pagination?.hasNextPage === true && !reachedOlder;
    return providerOk({ operations, nextPage: more ? request.page + 1 : null });
  }

  async getSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<ProviderSubscriberState>> {
    if (!this.config) return providerFail("not_configured");
    const info = await this.subscription(input.subscriberUid);
    if (!info.ok) return info;
    const search = await this.send(buildSearchPaymentsRequest({ limit: 50, offset: 0, subscriptionId: input.subscriberUid }));
    const operations: ProviderOperation[] = [];
    let readable = false;
    if (search.ok) {
      const records = asRecord(search.data)?.records;
      if (Array.isArray(records)) {
        readable = true;
        for (const raw of records) {
          const payment = asRecord(raw);
          // El filtro de la búsqueda se vuelve a comprobar acá: sólo cuentan los pagos de ESTA suscripción.
          if (!payment || payment.subscriptionId !== input.subscriberUid) continue;
          const operation = await this.operationOf(payment);
          if (!operation.ok) return operation;
          if (operation.data) operations.push(operation.data);
        }
      }
    }
    return providerOk({ status: mapSubscriptionStatus(info.data.status, info.data.statusDetail), operations, executionsReadable: readable });
  }

  async getPaymentMethodUpdateUrl(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ redirectUrl: string }>> {
    if (!this.config) return providerFail("not_configured");
    if (!this.capabilities.paymentMethodUpdate) return providerFail("unsupported"); // sin validar en sandbox: no se ofrece
    const result = await this.send(buildCardUpdateLinkRequest(input.subscriberUid));
    if (!result.ok) return result;
    const url = asRecord(result.data)?.url;
    // Sólo se redirige a HTTPS de pay.rebill.com: cualquier otro destino de la respuesta se descarta.
    return typeof url === "string" && isRebillCheckoutUrl(url) ? providerOk({ redirectUrl: url }) : providerFail("invalid_response");
  }

  /** `true` si la suscripción ya está en uno de esos estados (repetir una acción que ya se cumplió no es un error). */
  private async alreadyIn(subscriptionId: string, statuses: readonly string[]): Promise<boolean> {
    this.cache.delete(subscriptionId);
    const info = await this.subscription(subscriptionId);
    return info.ok && statuses.includes(info.data.status);
  }

  async cancelSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ canceled: true }>> {
    if (!this.config) return providerFail("not_configured");
    const result = await this.send(buildPauseRequest(input.subscriberUid));
    this.cache.delete(input.subscriberUid);
    if (result.ok) return providerOk({ canceled: true as const });
    if (result.error.kind === "rejected" && (await this.alreadyIn(input.subscriberUid, ["paused", "cancelled"]))) return providerOk({ canceled: true as const });
    return result;
  }

  async reactivateSubscriber(input: { subscriberUid: string; planCode: PlanCode; resumeAt?: string | null }): Promise<ProviderResult<{ reactivated: true }>> {
    if (!this.config) return providerFail("not_configured");
    // El próximo cobro corresponde al fin del período ya pagado (un instante del dominio → su día civil de Argentina). Si ese día ya pasó o es hoy, el primer día posterior: Rebill
    // exige una fecha de próximo cobro futura al reanudar.
    const today = civilDayOf(this.config.now().toISOString());
    const periodEndDay = input.resumeAt ? civilDayOf(input.resumeAt) : null;
    const resumeDay = periodEndDay && periodEndDay > today ? periodEndDay : addDaysToDateKey(today, 1);
    const at = resumeInstantIso(resumeDay);
    if (!at) return providerFail("rejected");
    const result = await this.send(buildResumeRequest(input.subscriberUid, at));
    this.cache.delete(input.subscriberUid);
    if (result.ok) return providerOk({ reactivated: true as const });
    if (result.error.kind === "rejected" && (await this.alreadyIn(input.subscriberUid, ["active", "retrying"]))) return providerOk({ reactivated: true as const });
    return result;
  }

  async changePlan(input: { subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }): Promise<ProviderResult<{ changed: true }>> {
    const planId = this.config?.planIds[input.toPlanCode];
    if (!this.config || !planId) return providerFail("not_configured");
    // Rebill aplica el cambio de plan al instante y sin prorrateo; el dominio lo programa para el próximo período: no se ejecuta hasta que se declare validado.
    if (!this.capabilities.changePlan) return providerFail("unsupported");
    const result = await this.send(buildChangePlanRequest(input.subscriberUid, planId));
    this.cache.delete(input.subscriberUid);
    return result.ok ? providerOk({ changed: true as const }) : result;
  }

  parseNotice(input: { rawBody: string; contentType: string | undefined; now: Date }): NoticeParse {
    return parseRebillNotice(input);
  }

  verifyNotice(input: { rawBody: string; signature: string | undefined }): boolean {
    return verifyNoticeSignature({ rawBody: input.rawBody, signature: input.signature, secret: this.config?.webhookSecret ?? null });
  }
}

/** Suscripción de la consulta autenticada: estado, detalle y plan (por el `pln_` configurado). Sólo la forma que documenta Rebill. */
export function parseSubscription(json: unknown, planCodeById: ReadonlyMap<string, PlanCode>): SubscriptionInfo | null {
  const subscription = unwrap(json, ["data", "result", "subscription"]);
  if (!subscription || typeof subscription.status !== "string") return null;
  const plan = asRecord(subscription.plan);
  const planId = typeof plan?.id === "string" ? plan.id : null;
  return {
    id: subscription.id as string,
    status: subscription.status,
    statusDetail: typeof subscription.statusDetail === "string" ? subscription.statusDetail : null,
    planCode: planId ? (planCodeById.get(planId) ?? null) : null,
  };
}

export function createRebillAdapter(env: Readonly<Record<string, string | undefined>> = process.env): RebillAdapter {
  return new RebillAdapter(readRebillConfig(env));
}
