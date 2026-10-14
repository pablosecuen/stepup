import { createHash } from "node:crypto";
import { providerAmountToMinor } from "../money.ts";
import type { NoticeHint, NoticeParse, OperationOutcome, ProviderOperation, RefundScope, UntrustedNotice, WebhookEventType } from "../provider.ts";

/**
 * Normalización de las operaciones consultadas a Mobbex y reducción de sus avisos, según la documentación oficial (mobbex.dev:
 * «Webhooks», «Suscriptores», «Códigos de Estado»). Funciones PURAS. Reglas:
 *
 *  - un campo ausente, con otro tipo o fuera de rango se descarta (`null`): nunca se adivina ni se completa;
 *  - un dato ambiguo (p. ej. dos importes que no coinciden) deja el importe en `null`, y la conciliación lo rechaza;
 *  - sólo se conservan identificadores, importes, moneda, estado y fechas: NO se extraen el correo, el nombre, el documento, el
 *    teléfono ni el número de tarjeta que los avisos traen en `customer`/`user`/`source`;
 *  - LOS AVISOS SON SEÑALES NO CONFIABLES: `parseNoticeBody` sólo extrae identificadores (pago, ejecución, suscriptor) para saber
 *    qué consultar. Nunca lee el estado, el importe, la moneda, el plan ni las fechas de un aviso.
 */

const ID_PATTERN = /^[A-Za-z0-9_.:~-]{1,128}$/;
const MAX_FORM_FIELDS = 300;
const MAX_FORM_KEY_LENGTH = 200;
const MAX_FORM_DEPTH = 8;

function id(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Estados de la tabla «Códigos de Estado» de Mobbex → resultado de dominio. Todo lo no listado es `other` (no se interpreta).
 *  200, 299–303 aprobado · 400–419, 500, 604 rechazado · 602 devuelta (total) · 605 parcialmente devuelta · 601 y 610 canceladas
 *  (alcance no definido: ambiguo) · 600 cancelación en proceso (todavía no es final).
 * Mobbex NO documenta ningún código de contracargo: ninguno se mapea acá (queda para un registro manual conciliado).
 */
const APPROVED_CODES = new Set(["200", "299", "300", "301", "302", "303"]);
const PENDING_CODES = new Set(["0", "1", "2", "3", "100", "210", "600"]);

export function mapStatusCode(code: string): { readonly outcome: OperationOutcome; readonly refundScope: RefundScope | null } {
  if (APPROVED_CODES.has(code)) return { outcome: "approved", refundScope: null };
  if (PENDING_CODES.has(code)) return { outcome: "pending", refundScope: null };
  if (code === "602") return { outcome: "refunded", refundScope: "full" };
  if (code === "605") return { outcome: "refunded", refundScope: "partial" };
  if (code === "601" || code === "610") return { outcome: "refunded", refundScope: "unknown" };
  const numeric = Number(code);
  if (Number.isInteger(numeric) && ((numeric >= 400 && numeric <= 419) || numeric === 500 || numeric === 604)) return { outcome: "rejected", refundScope: null };
  return { outcome: "other", refundScope: null };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const EVENT_TYPES: ReadonlySet<string> = new Set(["subscription:execution", "subscription:registration", "subscription:change_source", "subscription:subscriber:suspended", "subscription:subscriber:active", "checkout"]);

/** Cuerpo de un aviso: JSON, o `application/x-www-form-urlencoded` con notación de corchetes (`data[payment][id]=…`). Con topes de campos, largo y profundidad. */
export function parseWebhookBody(rawBody: string, contentType: string | undefined): unknown {
  const kind = (contentType ?? "").toLowerCase();
  if (kind.includes("json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  }
  const root: Record<string, unknown> = {};
  let fields = 0;
  for (const [key, value] of new URLSearchParams(rawBody)) {
    fields += 1;
    if (fields > MAX_FORM_FIELDS) return null;
    if (key.length > MAX_FORM_KEY_LENGTH) return null;
    const path = key.split(/\]\[|\[|\]/).filter((part) => part.length > 0);
    if (path.length === 0 || path.length > MAX_FORM_DEPTH || path.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) continue;
    let cursor: Record<string, unknown> = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const next = cursor[path[index]];
      cursor = record(next) ?? ((cursor[path[index]] = {}) as Record<string, unknown>);
    }
    cursor[path[path.length - 1]] = value;
  }
  return root;
}

/** Operación contenida en la consulta autenticada de un pago (o de un suscriptor), sólo con campos no sensibles. */
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
  const mapped = mapStatusCode(statusCode);
  return {
    providerPaymentId,
    executionUid: text(execution?.uid),
    subscriberUid: text(subscriber?.uid),
    subscriberReference: text(subscriber?.reference),
    planReference: text(subscription?.reference),
    outcome: mapped.outcome,
    statusCode,
    refundScope: mapped.refundScope,
    amountMinor,
    currency,
    dueAt: iso(execution?.date) ?? iso(payment?.created),
    occurredAt,
    livemode: currency === "ARS" && execution?.test !== true && data.test !== true,
  };
}

function hintFrom(data: Record<string, unknown>): NoticeHint {
  const payment = record(data.payment);
  const execution = record(data.execution);
  const subscriber = record(data.subscriber);
  return {
    providerPaymentId: id(payment?.id),
    executionUid: id(execution?.uid),
    subscriberUid: id(subscriber?.uid),
    subscriberReference: id(subscriber?.reference),
  };
}

const ALLOWED_CONTENT_TYPES = ["application/x-www-form-urlencoded", "application/json"];

/**
 * Reduce un aviso a su PISTA mínima. Esquema mínimo exigido:
 *   - `type` conocido (los desconocidos se ignoran: `ok` sin avisos) y `data` objeto;
 *   - `subscription:execution` → `data.payment.id` y al menos una identidad de suscriptor (`uid` o `reference`);
 *   - los demás tipos → al menos una identidad de suscriptor.
 * Lo que falte hace el aviso «malformado». Nada más del cuerpo se conserva (sólo su hash).
 */
export function parseNoticeBody(input: { rawBody: string; contentType: string | undefined; now: Date }): NoticeParse {
  const declared = (input.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_CONTENT_TYPES.includes(declared)) return { ok: false, reason: "unsupported_content_type" };
  const body = record(parseWebhookBody(input.rawBody, declared));
  const data = record(body?.data);
  if (!body || !data || typeof body.type !== "string") return { ok: false, reason: "malformed" };
  if (!EVENT_TYPES.has(body.type)) return { ok: true, notices: [] };
  const eventType = body.type as WebhookEventType;
  const hint = hintFrom(data);
  const hasIdentity = hint.subscriberUid !== null || hint.subscriberReference !== null;
  if (!hasIdentity || (eventType === "subscription:execution" && hint.providerPaymentId === null)) return { ok: false, reason: "malformed" };
  const notice: UntrustedNotice = {
    eventType,
    dedupKey: sha256Hex([eventType, hint.providerPaymentId ?? "", hint.executionUid ?? "", hint.subscriberUid ?? "", hint.subscriberReference ?? ""].join("|")),
    payloadHash: sha256Hex(input.rawBody),
    hint,
    receivedAt: input.now.toISOString(),
  };
  return { ok: true, notices: [notice] };
}
