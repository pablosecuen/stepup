import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { providerAmountToMinor } from "../money.ts";
import type { NoticeHint, NoticeParse, OperationOutcome, ProviderOperation, ProviderSubscriberStatus, RefundScope, UntrustedNotice, WebhookEventType } from "../provider.ts";

/**
 * Normalización de lo que informa Rebill y reducción de sus avisos, según la documentación oficial vigente (docs.rebill.com: «Payments»,
 * «Subscriptions», «Webhooks», «Payment links»). Funciones PURAS. Reglas (las mismas que el adaptador de Mobbex):
 *
 *  - un campo ausente, con otro tipo o fuera de rango se descarta (`null`): nunca se adivina ni se completa;
 *  - sólo se conservan identificadores, importes, moneda, estado y fechas: NO se extraen el correo, el nombre, el documento, el teléfono ni los
 *    datos de la tarjeta que los pagos y avisos traen en `customer`/`card`/`billingAddress`;
 *  - LOS AVISOS SON SEÑALES: `parseRebillNotice` sólo extrae identificadores (pago, suscripción y nuestra referencia) para saber QUÉ consultar. Nunca lee
 *    el estado, el importe, el plan ni las fechas de un aviso para decidir nada: eso sale de la consulta autenticada (`GET /v3/payments/:id`).
 */

const ID_PATTERN = /^[A-Za-z0-9_.:~-]{1,128}$/;
/** Nuestra referencia opaca del suscriptor (`billing_subscriptions.provider_reference`): `tfs_` + 32 hex. Sin datos personales. */
export const SUBSCRIBER_REFERENCE_PATTERN = /^tfs_[0-9a-f]{32}$/;
/** Parámetro de la dirección del pago donde viaja nuestra referencia; Rebill lo conserva en `payment.metadata` (docs: «Checkout landing»). */
export const REFERENCE_PARAM = "tf_ref";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** La respuesta de la API puede traer el objeto directo o envuelto (`data`, `result`, `payment`, `subscription`): se acepta el que tenga `id`. */
export function unwrap(json: unknown, keys: readonly string[] = ["data", "result"]): Record<string, unknown> | null {
  const root = record(json);
  if (!root) return null;
  if (typeof root.id === "string") return root;
  for (const key of keys) {
    const inner = record(root[key]);
    if (inner && typeof inner.id === "string") return inner;
  }
  return null;
}

/** Nuestra referencia dentro del `metadata` del pago (nunca de otro lugar): sólo si tiene exactamente la forma que generamos. */
export function referenceFromMetadata(metadata: unknown): string | null {
  const value = record(metadata)?.[REFERENCE_PARAM];
  return typeof value === "string" && SUBSCRIBER_REFERENCE_PATTERN.test(value) ? value : null;
}

/** Los objetos de prueba de Rebill llevan `test_` en su identificador (`test_pay_…`): sólo lo que NO lo lleva es una operación real. */
export function isLiveId(value: string): boolean {
  return !value.startsWith("test_");
}

/**
 * Estado del pago de Rebill (enum documentado: `pending`, `approved`, `rejected`, `refunded`, `partially_refunded`, `cancelled`, `chargeback`) → resultado de
 * dominio. `cancelled` (reverso previo a la liquidación) y todo lo no listado NO se aplican solos: la devolución es de alcance ambiguo y va a revisión manual.
 */
export function mapPaymentStatus(status: unknown): { readonly outcome: OperationOutcome; readonly refundScope: RefundScope | null } {
  switch (status) {
    case "approved":
      return { outcome: "approved", refundScope: null };
    case "pending":
      return { outcome: "pending", refundScope: null };
    case "rejected":
      return { outcome: "rejected", refundScope: null };
    case "refunded":
      return { outcome: "refunded", refundScope: "full" };
    case "partially_refunded":
      return { outcome: "refunded", refundScope: "partial" };
    case "cancelled":
      return { outcome: "refunded", refundScope: "unknown" };
    case "chargeback":
      return { outcome: "chargeback", refundScope: null };
    default:
      return { outcome: "other", refundScope: null };
  }
}

/** Estado de la suscripción de Rebill → estado de dominio. `paused` con `statusDetail: "defaulted"` es mora (reintentos agotados), NO una cancelación pedida. */
export function mapSubscriptionStatus(status: unknown, statusDetail: unknown): ProviderSubscriberStatus {
  if (status === "active" || status === "retrying" || status === "processing") return "active";
  if (status === "paused") return statusDetail === "defaulted" ? "unknown" : "suspended";
  if (status === "cancelled") return "suspended";
  if (status === "finished") return "finished";
  return "unknown";
}

export interface RebillPaymentFacts {
  readonly paymentId: string;
  readonly subscriptionId: string | null;
}

/**
 * Operación a partir de la consulta autenticada de un pago. `planReference` y `subscriberUid` salen de la suscripción (el pago sólo trae su `subscriptionId`);
 * la referencia propia sale del `metadata` del pago (presente en el primer cobro: viaja en la dirección del pago de Rebill) y en las renovaciones se resuelve por
 * el uid de la suscripción, ya vinculado a la cuenta.
 */
export function operationFromPayment(payment: Record<string, unknown>, planReference: string | null, fallbackOccurredAt: string): ProviderOperation | null {
  const providerPaymentId = id(payment.id);
  if (!providerPaymentId) return null;
  const status = typeof payment.status === "string" ? payment.status : "";
  const mapped = mapPaymentStatus(status);
  const subscriptionId = id(payment.subscriptionId);
  const currency = typeof payment.currency === "string" && /^[A-Z]{3}$/.test(payment.currency) ? payment.currency : null;
  const createdAt = iso(payment.createdAt);
  return {
    providerPaymentId,
    executionUid: providerPaymentId, // un pago = una ejecución; un reintento de renovación es OTRO pago
    subscriberUid: subscriptionId,
    subscriberReference: referenceFromMetadata(payment.metadata),
    planReference,
    outcome: mapped.outcome,
    statusCode: status || "unknown",
    refundScope: mapped.refundScope,
    amountMinor: providerAmountToMinor(payment.amount),
    currency,
    dueAt: createdAt,
    occurredAt: iso(payment.updatedAt) ?? createdAt ?? fallbackOccurredAt,
    livemode: currency === "ARS" && isLiveId(providerPaymentId),
  };
}

// ---------------------------------------------------------------------------
// Avisos (webhooks)
// ---------------------------------------------------------------------------

/**
 * Firma documentada (docs.rebill.com «Webhooks»): encabezado `x-rebill-signature` = HMAC-SHA256 hexadecimal del CUERPO CRUDO, con el secreto de firma completo
 * (incluido el prefijo `whsec_`) como clave. No hay marca de tiempo (no existe ventana anti-repetición): por eso un aviso firmado NO activa nada por sí solo.
 */
export function signNotice(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyNoticeSignature(input: { rawBody: string; signature: string | undefined; secret: string | null }): boolean {
  if (!input.secret || !input.signature) return false;
  const expected = Buffer.from(signNotice(input.rawBody, input.secret), "utf8");
  const received = Buffer.from(input.signature.trim().toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const PAYMENT_EVENTS = new Set(["payment.created", "payment.updated"]);

function notice(eventType: WebhookEventType, hint: NoticeHint, distinguishing: readonly string[], rawBody: string, now: Date): UntrustedNotice {
  return {
    eventType,
    // El estado (`status`/`lastStatus`) sólo DISTINGUE un aviso de otro del mismo pago (aprobado → devuelto): nunca decide nada.
    dedupKey: sha256Hex([eventType, hint.providerPaymentId ?? "", hint.subscriberUid ?? "", hint.subscriberReference ?? "", ...distinguishing].join("|")),
    payloadHash: sha256Hex(rawBody),
    hint,
    receivedAt: now.toISOString(),
  };
}

function statusText(value: unknown): string {
  return typeof value === "string" && value.length <= 40 ? value : "";
}

/**
 * Reduce un aviso a su PISTA mínima. Eventos que interesan: `payment.created` y `payment.updated` (cobro: se consulta el pago), `subscription.created` y
 * `subscription.updated` (cambió algo de la suscripción: se vuelve a mirar al suscriptor). `subscription.renewal_soon`, `payment.available`, `payout.updated` y los
 * demás se reconocen e ignoran. Un cuerpo que no es JSON, sin `webhook.event` o sin ninguna identidad se rechaza como mal formado.
 */
export function parseRebillNotice(input: { rawBody: string; contentType: string | undefined; now: Date }): NoticeParse {
  const declared = (input.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (declared !== "application/json") return { ok: false, reason: "unsupported_content_type" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const body = record(parsed);
  const data = record(body?.data);
  const webhook = record(body?.webhook);
  const event = webhook?.event;
  if (!body || !data || typeof event !== "string") return { ok: false, reason: "malformed" };
  // `webhook.logId` identifica la entrega: avisos distintos del mismo recurso con el mismo estado (pausa → reactivación → pausa) no se descartan como repetidos.
  const logId = id(webhook?.logId) ?? "";

  if (PAYMENT_EVENTS.has(event)) {
    // `payment.created` anida el pago en `data.payment`; `payment.updated` es plano en `data`.
    const nested = record(data.payment);
    const paymentId = id(nested ? nested.id : data.id);
    const metadata = nested ? nested.metadata : data.metadata;
    const subscriptionId = id(data.subscriptionId);
    const reference = referenceFromMetadata(metadata);
    if (!paymentId) return { ok: false, reason: "malformed" };
    // Un pago único (sin suscripción ni nuestra referencia) no es de la suscripción de TeacherFlow: se reconoce e ignora.
    if (!subscriptionId && !reference && event === "payment.created") return { ok: true, notices: [] };
    const hint: NoticeHint = { providerPaymentId: paymentId, executionUid: paymentId, subscriberUid: subscriptionId, subscriberReference: reference };
    return { ok: true, notices: [notice("subscription:execution", hint, [statusText(nested ? nested.status : data.status), statusText(data.lastStatus), logId], input.rawBody, input.now)] };
  }

  if (event === "subscription.created" || event === "subscription.updated") {
    const nested = record(data.subscription);
    const subscriptionId = id(nested ? nested.id : data.id);
    if (!subscriptionId) return { ok: false, reason: "malformed" };
    const hint: NoticeHint = { providerPaymentId: null, executionUid: null, subscriberUid: subscriptionId, subscriberReference: null };
    const status = statusText(nested ? nested.status : data.status);
    const eventType: WebhookEventType = event === "subscription.created" ? "subscription:registration" : status === "paused" || status === "cancelled" ? "subscription:subscriber:suspended" : status === "active" ? "subscription:subscriber:active" : "subscription:change_source";
    return { ok: true, notices: [notice(eventType, hint, [status, statusText(data.lastStatus), data.cardUpdated === true ? "card" : "", data.planUpdated === true ? "plan" : "", logId], input.rawBody, input.now)] };
  }

  return { ok: true, notices: [] };
}
