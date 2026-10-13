import { createHash } from "node:crypto";
import { providerAmountToMinor } from "../money.ts";
import type { NormalizedWebhookEvent, OperationOutcome, ProviderOperation, WebhookEventType } from "../provider.ts";

/**
 * Normalización de los avisos y operaciones de Mobbex, según la documentación oficial (mobbex.dev: «Webhooks», «Suscriptores»,
 * «Códigos de Estado»). Función PURA. Reglas:
 *
 *  - un campo ausente, con otro tipo o fuera de rango se descarta (`null`): nunca se adivina ni se completa;
 *  - un dato ambiguo (p. ej. dos importes que no coinciden) deja el importe en `null`, y la conciliación lo rechaza;
 *  - sólo se conservan identificadores, importes, moneda, estado y fechas: NO se extraen el correo, el nombre, el documento, el
 *    teléfono ni el número de tarjeta que el aviso trae en `customer`/`user`/`source`;
 *  - el proveedor no entrega un identificador de evento: la identidad semántica del aviso (`dedupKey`) es el hash de
 *    tipo + pago + estado + fecha de actualización + ejecución + suscriptor.
 */

const MAX_ID_LENGTH = 128;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Estados de la tabla «Códigos de Estado» de Mobbex → resultado de dominio. Todo lo no listado es `other` (no se interpreta). */
const APPROVED_CODES = new Set(["200", "299", "300", "301", "302", "303"]);
const PENDING_CODES = new Set(["0", "1", "2", "3", "100", "210"]);
const REFUND_CODES = new Set(["600", "601", "602", "605", "610"]);

export function mapStatusCode(code: string): OperationOutcome {
  if (APPROVED_CODES.has(code)) return "approved";
  if (PENDING_CODES.has(code)) return "pending";
  if (REFUND_CODES.has(code)) return "refunded";
  const numeric = Number(code);
  if (Number.isInteger(numeric) && ((numeric >= 400 && numeric <= 419) || numeric === 500 || numeric === 604)) return "rejected";
  return "other";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const EVENT_TYPES: ReadonlySet<string> = new Set(["subscription:execution", "subscription:registration", "subscription:change_source", "subscription:subscriber:suspended", "subscription:subscriber:active", "checkout"]);

/** Cuerpo de un aviso: JSON, o `application/x-www-form-urlencoded` con notación de corchetes (`data[payment][id]=…`). */
export function parseWebhookBody(rawBody: string, contentType: string | undefined): unknown {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{") || (contentType ?? "").toLowerCase().includes("json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  }
  const root: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) {
    const path = key.split(/\]\[|\[|\]/).filter((part) => part.length > 0);
    if (path.length === 0 || path.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) continue;
    let cursor: Record<string, unknown> = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const next = cursor[path[index]];
      cursor = record(next) ?? (cursor[path[index]] = {}) as Record<string, unknown>;
    }
    cursor[path[path.length - 1]] = value;
  }
  return root;
}

/** Operación contenida en un aviso `subscription:execution` (o en la consulta de una operación), sólo con campos no sensibles. */
export function operationFromPayload(data: Record<string, unknown>, fallbackOccurredAt: string): ProviderOperation | null {
  const payment = record(data.payment);
  const status = record(payment?.status);
  const execution = record(data.execution);
  const subscription = record(data.subscription);
  const subscriber = record(data.subscriber);
  const providerPaymentId = text(payment?.id);
  const statusCode = status?.code === undefined ? null : text(String(status.code));
  if (!providerPaymentId || !statusCode) return null;

  const paymentAmount = providerAmountToMinor(payment?.total);
  const executionAmount = execution?.total === undefined ? null : providerAmountToMinor(execution.total);
  const amountMinor = paymentAmount !== null && (executionAmount === null || executionAmount === paymentAmount) ? paymentAmount : null;

  const paymentCurrency = text(record(payment?.currency)?.code);
  const executionCurrency = text(execution?.currency);
  const currency = paymentCurrency && executionCurrency && paymentCurrency !== executionCurrency ? null : (paymentCurrency ?? executionCurrency);

  const occurredAt = iso(payment?.updated) ?? iso(payment?.created) ?? fallbackOccurredAt;
  return {
    providerPaymentId,
    executionUid: text(execution?.uid),
    subscriberUid: text(subscriber?.uid),
    subscriberReference: text(subscriber?.reference),
    planReference: text(subscription?.reference),
    outcome: mapStatusCode(statusCode),
    statusCode,
    amountMinor,
    currency,
    dueAt: iso(execution?.date) ?? iso(payment?.created),
    occurredAt,
    livemode: currency === "ARS" && execution?.test !== true && data.test !== true,
  };
}

/** Normaliza un aviso ya parseado. `null` si no tiene la forma documentada. */
export function normalizeWebhook(input: { rawBody: string; body: unknown; receivedAt: Date }): NormalizedWebhookEvent | null {
  const body = record(input.body);
  const data = record(body?.data);
  if (!body || !data || typeof body.type !== "string") return null;
  const eventType: WebhookEventType = EVENT_TYPES.has(body.type) ? (body.type as WebhookEventType) : "other";
  const receivedAt = input.receivedAt.toISOString();
  const operation = eventType === "subscription:execution" ? operationFromPayload(data, receivedAt) : null;
  if (eventType === "subscription:execution" && !operation) return null;
  const subscriber = record(data.subscriber);
  const subscriberUid = operation?.subscriberUid ?? text(subscriber?.uid);
  const subscriberReference = operation?.subscriberReference ?? text(subscriber?.reference);
  const dedupKey = sha256Hex([eventType, operation?.providerPaymentId ?? "", operation?.statusCode ?? "", operation?.occurredAt ?? "", operation?.executionUid ?? "", subscriberUid ?? ""].join("|"));
  return { eventType, dedupKey, payloadHash: sha256Hex(input.rawBody), operation, subscriberUid, subscriberReference, receivedAt };
}
