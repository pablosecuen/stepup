import { addDaysToDateKey } from "../../calendar/timezone.ts";
import { civilDayOf } from "../periods.ts";
import { minorToProviderDecimal } from "../money.ts";
import { PLAN_CODES, getPlan, type BillingPlan, type PlanCode } from "../plans.ts";
import { providerFail, providerOk, type CheckoutRequest, type CheckoutResponse, type NoticeParse, type ProviderAdapter, type ProviderCapabilities, type ProviderOperation, type ProviderResult, type ProviderSubscriberState, type ProviderSubscriberStatus } from "../provider.ts";
import { operationFromPayload, parseNoticeBody } from "./mobbex-normalize.ts";

/**
 * Adaptador de Mobbex — ESQUELETO CERRADO (M1). Prepara pedidos, tipos y validaciones según la documentación oficial vigente
 * (mobbex.dev: «Suscripciones», «Suscriptores», «Webhooks», «Consulta de operaciones», «Códigos de Estado»), pero:
 *
 *  - NO realiza ninguna llamada de red sin credenciales: sin `MOBBEX_API_KEY` y `MOBBEX_ACCESS_TOKEN` cada método devuelve
 *    `not_configured` ANTES de armar un pedido. M1 no tiene credenciales sandbox configuradas;
 *  - los AVISOS (webhooks) son SEÑALES NO CONFIABLES: la documentación oficial NO define ninguna firma ni encabezado de
 *    autenticación (el aviso trae sólo `Content-Type`). Por decisión cerrada, `parseNotice` sólo extrae identificadores mínimos
 *    para saber qué consultar; ningún estado, importe ni plan sale del cuerpo. Toda modificación se confirma con la consulta
 *    autenticada. Queda por consultar por escrito a Mobbex si ofrece firma, secreto o lista de IP oficial;
 *  - las operaciones cuya forma de respuesta la documentación no muestra completa (listado de operaciones con identidad del
 *    suscriptor, contenido de las ejecuciones de un suscriptor) NO se interpretan: no se inventa un formato;
 *  - `changePlan` («mover suscriptor») y la actualización del medio de pago (URL de control del suscriptor) están implementados
 *    según la documentación pero NO validados en sandbox: sus capacidades están apagadas hasta que se declaren validadas
 *    (`MOBBEX_VALIDATED_CAPABILITIES`, una decisión explícita después del sandbox);
 *  - los secretos son sólo de servidor: `MOBBEX_API_KEY` y `MOBBEX_ACCESS_TOKEN` (encabezados `x-api-key` y `x-access-token`).
 *    Nunca llevan el prefijo `NEXT_PUBLIC_`, nunca se registran y nunca viajan en un mensaje de error.
 *
 * Pendiente (requiere credenciales sandbox): validar contra la cuenta de pruebas cada pedido y cada validador de este archivo.
 */
export interface MobbexConfig {
  readonly apiKey: string;
  readonly accessToken: string;
  readonly baseUrl: string;
  readonly sandbox: boolean;
  readonly timeoutMs: number;
  /** UID de la suscripción (plantilla) de cada plan en Mobbex. Son identificadores, no secretos. */
  readonly subscriptionUids: Readonly<Partial<Record<PlanCode, string>>>;
  readonly webhookUrl: string | null;
  /** Capacidades declaradas VALIDADAS en sandbox por quien opera el sistema (vacío por defecto). */
  readonly validatedCapabilities: ReadonlySet<keyof ProviderCapabilities>;
  readonly fetchImpl: typeof fetch;
  readonly now: () => Date;
}

const DEFAULT_BASE_URL = "https://api.mobbex.com";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Lee la configuración del entorno del SERVIDOR. `null` si faltan las credenciales (el adaptador queda cerrado). */
export function readMobbexConfig(env: Readonly<Record<string, string | undefined>> = process.env, overrides: Partial<Pick<MobbexConfig, "fetchImpl" | "now">> = {}): MobbexConfig | null {
  const apiKey = env.MOBBEX_API_KEY?.trim();
  const accessToken = env.MOBBEX_ACCESS_TOKEN?.trim();
  if (!apiKey || !accessToken) return null;
  const subscriptionUids: Partial<Record<PlanCode, string>> = {};
  for (const code of PLAN_CODES) {
    const uid = env[`MOBBEX_SUBSCRIPTION_UID_${code.toUpperCase()}`]?.trim();
    if (uid) subscriptionUids[code] = uid;
  }
  return {
    apiKey,
    accessToken,
    baseUrl: DEFAULT_BASE_URL,
    sandbox: env.MOBBEX_SANDBOX?.trim().toLowerCase() === "true",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    subscriptionUids,
    webhookUrl: env.MOBBEX_WEBHOOK_URL?.trim() || null,
    validatedCapabilities: new Set((env.MOBBEX_VALIDATED_CAPABILITIES ?? "").split(",").map((item) => item.trim()).filter((item): item is keyof ProviderCapabilities => item === "changePlan" || item === "paymentMethodUpdate")),
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Pedidos (puros): lo que se le enviaría a Mobbex, tal como lo documenta la API.
// ---------------------------------------------------------------------------

export interface MobbexRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly form?: Readonly<Record<string, string>>;
}

/** Alta de la suscripción (plantilla) de un plan: `POST /p/subscriptions`. Se hace una vez por plan, no por cliente. */
export function buildCreateSubscriptionRequest(plan: BillingPlan, options: { returnUrl: string; webhookUrl: string | null; test: boolean }): MobbexRequest {
  return {
    method: "POST",
    path: "/p/subscriptions/",
    json: {
      total: minorToProviderDecimal(plan.amountMinor), // «XXX.xx», con punto decimal
      currency: plan.currency, // la API sólo admite ARS
      type: "dynamic",
      name: `TeacherFlow ${plan.name}`,
      description: `Suscripción ${plan.name.toLowerCase()} a TeacherFlow`,
      interval: plan.providerInterval, // 1m · 3m · 6m · 1y
      limit: 0, // 0 = sin límite de períodos
      trial: 0, // sin período de prueba
      setupFee: 0, // sin costo de alta
      reference: plan.code, // única por plan
      return_url: options.returnUrl, // debe ser HTTPS
      ...(options.webhookUrl ? { webhook: options.webhookUrl } : {}), // debe ser HTTPS
      test: options.test,
    },
  };
}

/** Alta del suscriptor: `POST /p/subscriptions/{uid}/subscriber`. `startDate` debe ser al menos 1 día posterior a hoy. */
export function buildCreateSubscriberRequest(input: { subscriptionUid: string; reference: string; customer: CheckoutRequest["customer"]; startDateKey: string; test: boolean; /** Vencimiento del enlace de carga del medio de pago (ms desde 1970). */ expiresAtMs?: number }): MobbexRequest {
  const [year, month, day] = input.startDateKey.split("-").map(Number);
  return {
    method: "POST",
    path: `/p/subscriptions/${encodeURIComponent(input.subscriptionUid)}/subscriber`,
    json: {
      customer: { email: input.customer.email, name: input.customer.name, identification: input.customer.identification },
      startDate: { day, month, year },
      reference: input.reference,
      test: input.test,
      ...(input.expiresAtMs ? { expiresAt: input.expiresAtMs } : {}),
    },
  };
}

/** Consulta de un suscriptor (estado, agenda y ejecuciones): `GET /p/subscriptions/{uid}/subscriber/{sid}`. */
export function buildGetSubscriberRequest(subscriptionUid: string, subscriberUid: string): MobbexRequest {
  return { method: "GET", path: `/p/subscriptions/${encodeURIComponent(subscriptionUid)}/subscriber/${encodeURIComponent(subscriberUid)}` };
}

/** Consulta de una operación: `POST /2.0/transactions/status` (multipart, campo `id`). */
export function buildStatusQueryRequest(paymentId: string): MobbexRequest {
  return { method: "POST", path: "/2.0/transactions/status", form: { id: paymentId } };
}

/** Cancelar = suspender el cobro del suscriptor (conserva el registro y permite reactivar): `POST …/action/suspend`. */
export function buildSuspendSubscriberRequest(subscriptionUid: string, subscriberUid: string): MobbexRequest {
  return { method: "POST", path: `/p/subscriptions/${encodeURIComponent(subscriptionUid)}/subscriber/${encodeURIComponent(subscriberUid)}/action/suspend` };
}

/** Reactivar el cobro de un suscriptor suspendido: `POST …/action/activate`. */
export function buildActivateSubscriberRequest(subscriptionUid: string, subscriberUid: string): MobbexRequest {
  return { method: "POST", path: `/p/subscriptions/${encodeURIComponent(subscriptionUid)}/subscriber/${encodeURIComponent(subscriberUid)}/action/activate` };
}

/** Cambio de plan = mover al suscriptor a la suscripción del otro plan: `POST …/action/move` con `{ sid }`. */
export function buildMoveSubscriberRequest(subscriptionUid: string, subscriberUid: string, newSubscriptionUid: string): MobbexRequest {
  return { method: "POST", path: `/p/subscriptions/${encodeURIComponent(subscriptionUid)}/subscriber/${encodeURIComponent(subscriberUid)}/action/move`, json: { sid: newSubscriptionUid } };
}

// ---------------------------------------------------------------------------
// Validadores de respuestas (sólo las formas completas que muestra la documentación).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseSubscriberCreated(json: unknown): { subscriberUid: string; sourceUrl: string } | null {
  const data = asRecord(asRecord(json)?.data);
  const uid = data?.uid;
  const sourceUrl = data?.sourceUrl;
  if (asRecord(json)?.result !== true || typeof uid !== "string" || typeof sourceUrl !== "string") return null;
  try {
    const url = new URL(sourceUrl);
    // Sólo se redirige a una persona hacia HTTPS de mobbex.com: cualquier otro destino de la respuesta se descarta.
    if (url.protocol !== "https:" || !(url.hostname === "mobbex.com" || url.hostname.endsWith(".mobbex.com"))) return null;
  } catch {
    return null;
  }
  return { subscriberUid: uid, sourceUrl };
}

const SUBSCRIBER_STATUSES: Readonly<Record<string, ProviderSubscriberStatus>> = { active: "active", finished: "finished" };

/**
 * Respuesta de `GET …/subscriber/{sid}`. Sólo se interpretan las formas que la documentación MUESTRA: `status` `active`/`finished`
 * (cualquier otro texto es `unknown`: la documentación no lista el valor de un suscriptor suspendido) y `executions` vacío. Un
 * arreglo de ejecuciones con contenido no tiene forma documentada: `executionsReadable = false` (no significa «sin cobros»).
 */
export function parseSubscriberState(json: unknown): { state: ProviderSubscriberState; controlUrl: string | null } | null {
  const data = asRecord(asRecord(json)?.data);
  const subscriber = asRecord(data?.subscriber);
  if (asRecord(json)?.result !== true || !subscriber) return null;
  const rawStatus = typeof subscriber.status === "string" ? subscriber.status : "";
  const executions = subscriber.executions;
  const readable = Array.isArray(executions) && executions.length === 0;
  let controlUrl: string | null = null;
  if (typeof data?.url === "string") {
    try {
      const url = new URL(data.url);
      if (url.protocol === "https:" && (url.hostname === "mobbex.com" || url.hostname.endsWith(".mobbex.com"))) controlUrl = url.toString();
    } catch {
      controlUrl = null;
    }
  }
  return { state: { status: SUBSCRIBER_STATUSES[rawStatus] ?? "unknown", operations: [], executionsReadable: readable }, controlUrl };
}

export function parseStatusQuery(json: unknown, fallbackOccurredAt: string): ProviderOperation | null {
  const transaction = asRecord(asRecord(asRecord(json)?.data)?.transaction);
  if (asRecord(json)?.result !== true || !transaction) return null;
  return operationFromPayload(transaction, fallbackOccurredAt);
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export class MobbexAdapter implements ProviderAdapter {
  readonly name = "mobbex" as const;

  private readonly config: MobbexConfig | null;
  readonly capabilities: ProviderCapabilities;

  constructor(config: MobbexConfig | null) {
    this.config = config;
    this.capabilities = { changePlan: config?.validatedCapabilities.has("changePlan") ?? false, paymentMethodUpdate: config?.validatedCapabilities.has("paymentMethodUpdate") ?? false };
  }

  private async send(request: MobbexRequest): Promise<ProviderResult<unknown>> {
    const config = this.config;
    if (!config) return providerFail("not_configured"); // sin credenciales: nunca se llega a la red
    const url = new URL(request.path, config.baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { "x-api-key": config.apiKey, "x-access-token": config.accessToken };
    let body: BodyInit | undefined;
    if (request.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.json);
    } else if (request.form) {
      const form = new FormData();
      for (const [key, value] of Object.entries(request.form)) form.append(key, value);
      body = form;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await config.fetchImpl(url, { method: request.method, headers, body, signal: controller.signal, redirect: "error" });
      if (response.status === 401 || response.status === 403) return providerFail("unauthorized");
      if (response.status >= 500) return providerFail("unavailable");
      if (response.status >= 400) return providerFail("rejected");
      try {
        return providerOk(await response.json());
      } catch {
        return providerFail("invalid_response");
      }
    } catch (error) {
      return providerFail(error instanceof Error && error.name === "AbortError" ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async createCheckout(request: CheckoutRequest): Promise<ProviderResult<CheckoutResponse>> {
    const config = this.config;
    if (!config) return providerFail("not_configured");
    const plan = getPlan(request.plan.code);
    const subscriptionUid = plan ? config.subscriptionUids[plan.code] : undefined;
    if (!plan || !plan.active || !subscriptionUid) return providerFail("not_configured");
    const startDateKey = addDaysToDateKey(civilDayOf(config.now().toISOString()), 1);
    const result = await this.send(buildCreateSubscriberRequest({ subscriptionUid, reference: request.subscriberReference, customer: request.customer, startDateKey, test: config.sandbox, expiresAtMs: config.now().getTime() + 24 * 3_600_000 }));
    if (!result.ok) return result;
    const parsed = parseSubscriberCreated(result.data);
    if (!parsed) return providerFail("invalid_response");
    return providerOk({ checkoutUid: parsed.subscriberUid, subscriberUid: parsed.subscriberUid, redirectUrl: parsed.sourceUrl });
  }

  async getOperation(providerPaymentId: string): Promise<ProviderResult<ProviderOperation>> {
    const config = this.config;
    if (!config) return providerFail("not_configured");
    const result = await this.send(buildStatusQueryRequest(providerPaymentId));
    if (!result.ok) return result;
    const operation = parseStatusQuery(result.data, config.now().toISOString());
    return operation ? providerOk(operation) : providerFail("invalid_response");
  }

  /** La documentación del listado de operaciones no incluye la identidad del suscriptor ni de la ejecución: no se puede conciliar con ella. */
  async listOperations(): Promise<ProviderResult<{ operations: readonly ProviderOperation[]; nextPage: number | null }>> {
    return providerFail(this.config ? "unsupported" : "not_configured");
  }

  async getSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<ProviderSubscriberState>> {
    const subscriptionUid = this.config?.subscriptionUids[input.planCode];
    if (!this.config || !subscriptionUid) return providerFail("not_configured");
    const result = await this.send(buildGetSubscriberRequest(subscriptionUid, input.subscriberUid));
    if (!result.ok) return result;
    const parsed = parseSubscriberState(result.data);
    return parsed ? providerOk(parsed.state) : providerFail("invalid_response");
  }

  async getPaymentMethodUpdateUrl(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ redirectUrl: string }>> {
    const subscriptionUid = this.config?.subscriptionUids[input.planCode];
    if (!this.config || !subscriptionUid) return providerFail("not_configured");
    if (!this.capabilities.paymentMethodUpdate) return providerFail("unsupported"); // sin validar en sandbox: no se ofrece
    const result = await this.send(buildGetSubscriberRequest(subscriptionUid, input.subscriberUid));
    if (!result.ok) return result;
    const parsed = parseSubscriberState(result.data);
    return parsed?.controlUrl ? providerOk({ redirectUrl: parsed.controlUrl }) : providerFail("invalid_response");
  }

  async cancelSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ canceled: true }>> {
    const subscriptionUid = this.config?.subscriptionUids[input.planCode];
    if (!this.config || !subscriptionUid) return providerFail("not_configured");
    const result = await this.send(buildSuspendSubscriberRequest(subscriptionUid, input.subscriberUid));
    if (!result.ok) return result;
    return asRecord(result.data)?.result === true ? providerOk({ canceled: true as const }) : providerFail("invalid_response");
  }

  async reactivateSubscriber(input: { subscriberUid: string; planCode: PlanCode }): Promise<ProviderResult<{ reactivated: true }>> {
    const subscriptionUid = this.config?.subscriptionUids[input.planCode];
    if (!this.config || !subscriptionUid) return providerFail("not_configured");
    const result = await this.send(buildActivateSubscriberRequest(subscriptionUid, input.subscriberUid));
    if (!result.ok) return result;
    return asRecord(result.data)?.result === true ? providerOk({ reactivated: true as const }) : providerFail("invalid_response");
  }

  async changePlan(input: { subscriberUid: string; fromPlanCode: PlanCode; toPlanCode: PlanCode }): Promise<ProviderResult<{ changed: true }>> {
    const from = this.config?.subscriptionUids[input.fromPlanCode];
    const to = this.config?.subscriptionUids[input.toPlanCode];
    if (!this.config || !from || !to) return providerFail("not_configured");
    if (!this.capabilities.changePlan) return providerFail("unsupported"); // «mover suscriptor» sin validar en sandbox: no se ejecuta
    const result = await this.send(buildMoveSubscriberRequest(from, input.subscriberUid, to));
    if (!result.ok) return result;
    return asRecord(result.data)?.result === true ? providerOk({ changed: true as const }) : providerFail("invalid_response");
  }

  /** Reduce un aviso a su pista mínima (identificadores). NO lo autentica: la documentación de Mobbex no define ninguna firma. */
  parseNotice(input: { rawBody: string; contentType: string | undefined; now: Date }): NoticeParse {
    return parseNoticeBody(input);
  }
}

export function createMobbexAdapter(env: Readonly<Record<string, string | undefined>> = process.env): MobbexAdapter {
  return new MobbexAdapter(readMobbexConfig(env));
}
