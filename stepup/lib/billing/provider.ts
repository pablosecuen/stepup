import type { BillingPlan, PlanCode } from "./plans.ts";

/**
 * Puerto del proveedor de cobros. El resto del módulo sólo conoce ESTA interfaz: Mobbex es un adaptador intercambiable y las
 * pruebas usan un adaptador falso determinista. Ningún método lanza al llamador: todo resultado es `ProviderResult`, y los
 * errores del proveedor (cuerpos crudos, encabezados, secretos) NUNCA se propagan: sólo la categoría.
 *
 * Los AVISOS (webhooks) del proveedor son señales NO CONFIABLES (decisión cerrada 2): `parseNotice` sólo extrae identificadores
 * mínimos para saber QUÉ consultar. Ningún estado, importe ni plan sale del cuerpo del aviso: todo se confirma con la consulta
 * autenticada (`getOperation`, `getSubscriber`).
 */

export type ProviderErrorKind =
  | "not_configured" // faltan credenciales: nunca se hace una llamada de red
  | "unauthorized" // el proveedor rechazó nuestras credenciales
  | "timeout"
  | "unavailable" // caída, 5xx o error de red
  | "rejected" // el proveedor entendió el pedido y lo rechazó (datos inválidos)
  | "invalid_response" // la respuesta no tiene la forma documentada: no se interpreta
  | "unsupported"; // el proveedor no documenta esta operación todavía

export interface ProviderError {
  readonly kind: ProviderErrorKind;
  /** ¿Tiene sentido reintentar más tarde sin cambiar nada? */
  readonly retryable: boolean;
}

export type ProviderResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ProviderError };

export function providerOk<T>(data: T): ProviderResult<T> {
  return { ok: true, data };
}
export function providerFail(kind: ProviderErrorKind): ProviderResult<never> {
  return { ok: false, error: { kind, retryable: kind === "timeout" || kind === "unavailable" } };
}

export type OperationOutcome = "approved" | "rejected" | "pending" | "refunded" | "chargeback" | "other";

/**
 * Alcance de una devolución informada por el proveedor. Sólo `full` se aplica sola (el período no se extiende y el acceso termina
 * al confirmarse); `partial` y `unknown` (ambigua) van a revisión manual y no cambian el estado.
 */
export type RefundScope = "full" | "partial" | "unknown";

/**
 * Una operación (un cobro) tal como la informa el proveedor, ya normalizada: sólo campos NO sensibles. Nunca lleva datos de
 * tarjeta, documento, correo ni nombre de la persona.
 */
export interface ProviderOperation {
  readonly providerPaymentId: string;
  readonly executionUid: string | null;
  readonly subscriberUid: string | null;
  /** Referencia que NOSOTROS enviamos al crear el suscriptor (única por propietaria). Nunca se acepta un `owner_id` del proveedor. */
  readonly subscriberReference: string | null;
  /** Referencia de la suscripción (plantilla de plan) en el proveedor: es el código del plan del catálogo. */
  readonly planReference: string | null;
  readonly outcome: OperationOutcome;
  readonly statusCode: string;
  /** Sólo para `refunded`: si la devolución fue total, parcial o no se puede saber. */
  readonly refundScope: RefundScope | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly dueAt: string | null;
  readonly occurredAt: string;
  /** `false` para operaciones de prueba (moneda de prueba): nunca activan nada en Production. */
  readonly livemode: boolean;
}

export type WebhookEventType = "subscription:execution" | "subscription:registration" | "subscription:change_source" | "subscription:subscriber:suspended" | "subscription:subscriber:active" | "checkout" | "other";

/** Identificadores mínimos de un aviso: lo único que se conserva de su cuerpo. Sin estado, importe, plan, correo ni documento. */
export interface NoticeHint {
  readonly providerPaymentId: string | null;
  readonly executionUid: string | null;
  readonly subscriberUid: string | null;
  readonly subscriberReference: string | null;
}

/** Un aviso NO CONFIABLE ya reducido a su pista mínima. */
export interface UntrustedNotice {
  readonly eventType: WebhookEventType;
  /** Identidad semántica de la pista (tipo + identificadores): repetirla mientras el aviso anterior sigue pendiente no genera trabajo nuevo. */
  readonly dedupKey: string;
  readonly payloadHash: string;
  readonly hint: NoticeHint;
  readonly receivedAt: string;
}

export type NoticeParse =
  | { readonly ok: true; readonly notices: readonly UntrustedNotice[] }
  | { readonly ok: false; readonly reason: "malformed" | "unsupported_content_type" | "too_large" };

/** Estado del suscriptor en el proveedor (cobros activos, suspendidos o terminados). `unknown` = el proveedor devolvió algo que no se interpreta. */
export type ProviderSubscriberStatus = "active" | "suspended" | "finished" | "unknown";

export interface ProviderSubscriberState {
  readonly status: ProviderSubscriberStatus;
  /** Cobros del suscriptor informados por el proveedor (sólo si `executionsReadable`). */
  readonly operations: readonly ProviderOperation[];
  /** `false` si el proveedor mostró ejecuciones con una forma que no se interpreta: entonces `operations` NO significa «sin cobros». */
  readonly executionsReadable: boolean;
}

/** Datos de la persona que el proveedor exige para crear el suscriptor. Sólo viajan al proveedor: NUNCA se guardan ni se registran. */
export interface ProviderCustomer {
  readonly email: string;
  readonly name: string;
  /** Documento (DNI/CUIT): lo exige la API del proveedor. Nunca se persiste, no entra en registros ni en mensajes de error. */
  readonly identification: string;
}

export interface CheckoutRequest {
  /** Referencia propia y estable del suscriptor (no contiene datos personales). */
  readonly subscriberReference: string;
  readonly plan: BillingPlan;
  readonly customer: ProviderCustomer;
  readonly returnUrl: string;
  /** Misma clave = mismo checkout: el adaptador no crea dos. */
  readonly idempotencyKey: string;
}

export interface CheckoutResponse {
  readonly checkoutUid: string;
  readonly subscriberUid: string | null;
  /** Dónde la persona carga su medio de pago. Volver de ahí NUNCA activa la suscripción. */
  readonly redirectUrl: string;
}

export interface ListOperationsRequest {
  readonly updatedFromIso: string;
  readonly page: number;
  /** Máximo 50 (límite del proveedor). */
  readonly limit: number;
}

/**
 * Qué operaciones están VALIDADAS de punta a punta con este proveedor. La interfaz nunca ofrece un botón cuyo respaldo no esté
 * validado (el adaptador falso las tiene todas; el de Mobbex las activa recién cuando el sandbox las confirma).
 */
export interface ProviderCapabilities {
  readonly changePlan: boolean;
  readonly paymentMethodUpdate: boolean;
}

export interface ProviderAdapter {
  readonly name: "fake" | "mobbex";
  readonly capabilities: ProviderCapabilities;
  createCheckout(request: CheckoutRequest): Promise<ProviderResult<CheckoutResponse>>;
  /** Consulta AUTENTICADA de una operación: es la fuente de verdad con la que se concilia cualquier aviso. */
  getOperation(providerPaymentId: string): Promise<ProviderResult<ProviderOperation>>;
  /** Barrido paginado de operaciones actualizadas desde un instante. */
  listOperations(request: ListOperationsRequest): Promise<ProviderResult<{ readonly operations: readonly ProviderOperation[]; readonly nextPage: number | null }>>;
  /** Consulta AUTENTICADA de un suscriptor (sondeo por suscriptor): recupera los avisos perdidos y detecta cancelaciones hechas del lado del proveedor. */
  getSubscriber(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<ProviderSubscriberState>>;
  /** Dónde la persona actualiza su medio de pago (siempre un destino HTTPS del proveedor). */
  getPaymentMethodUpdateUrl(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<{ readonly redirectUrl: string }>>;
  cancelSubscriber(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<{ readonly canceled: true }>>;
  /** Reanuda el cobro de un suscriptor suspendido (reactivar una cancelación antes de que termine el período pagado). */
  reactivateSubscriber(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<{ readonly reactivated: true }>>;
  /** Mueve al suscriptor a la suscripción de otro plan (el cambio se programa para el próximo período). */
  changePlan(input: { readonly subscriberUid: string; readonly fromPlanCode: PlanCode; readonly toPlanCode: PlanCode }): Promise<ProviderResult<{ readonly changed: true }>>;
  /** Reduce un aviso a su pista mínima. NO lo autentica ni decide nada con su contenido. */
  parseNotice(input: { readonly rawBody: string; readonly contentType: string | undefined; readonly now: Date }): NoticeParse;
}
