import type { BillingPlan, PlanCode } from "./plans.ts";

/**
 * Puerto del proveedor de cobros (M1). El resto del módulo sólo conoce ESTA interfaz: Mobbex es un adaptador intercambiable y
 * las pruebas usan un adaptador falso determinista. Ningún método lanza al llamador: todo resultado es `ProviderResult`, y los
 * errores del proveedor (cuerpos crudos, encabezados, secretos) NUNCA se propagan: sólo la categoría.
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

export type OperationOutcome = "approved" | "rejected" | "pending" | "refunded" | "other";

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
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly dueAt: string | null;
  readonly occurredAt: string;
  /** `false` para operaciones de prueba (moneda de prueba): nunca activan nada en Production. */
  readonly livemode: boolean;
}

export type WebhookEventType = "subscription:execution" | "subscription:registration" | "subscription:change_source" | "subscription:subscriber:suspended" | "subscription:subscriber:active" | "checkout" | "other";

/** Lo único que se conserva de un aviso: campos normalizados (sin cuerpo crudo, sin datos personales). */
export interface NormalizedWebhookEvent {
  readonly eventType: WebhookEventType;
  /** Identidad semántica del aviso (el proveedor no entrega un id de evento): se usa para descartar duplicados. */
  readonly dedupKey: string;
  readonly payloadHash: string;
  readonly operation: ProviderOperation | null;
  readonly subscriberUid: string | null;
  readonly subscriberReference: string | null;
  readonly receivedAt: string;
}

export type WebhookVerification =
  | { readonly verified: true; readonly events: readonly NormalizedWebhookEvent[] }
  | { readonly verified: false; readonly reason: "mechanism_not_documented" | "signature_missing" | "signature_invalid" | "malformed" | "too_large" | "not_configured" };

/** Datos de la persona que el proveedor exige para crear el suscriptor. Sólo viajan al proveedor: nunca se guardan ni se registran. */
export interface ProviderCustomer {
  readonly email: string;
  readonly name: string;
  /** Documento (DNI/CUIT): lo exige la API del proveedor. */
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

export interface ProviderAdapter {
  readonly name: "fake" | "mobbex";
  createCheckout(request: CheckoutRequest): Promise<ProviderResult<CheckoutResponse>>;
  /** Consulta AUTENTICADA de una operación: es la fuente de verdad con la que se concilia cualquier aviso. */
  getOperation(providerPaymentId: string): Promise<ProviderResult<ProviderOperation>>;
  /** Barrido paginado de operaciones actualizadas desde un instante (recupera avisos perdidos). */
  listOperations(request: ListOperationsRequest): Promise<ProviderResult<{ readonly operations: readonly ProviderOperation[]; readonly nextPage: number | null }>>;
  cancelSubscriber(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<{ readonly canceled: true }>>;
  /** Reanuda el cobro de un suscriptor suspendido (reactivar una cancelación antes de que termine el período pagado). */
  reactivateSubscriber(input: { readonly subscriberUid: string; readonly planCode: PlanCode }): Promise<ProviderResult<{ readonly reactivated: true }>>;
  /** Mueve al suscriptor a la suscripción de otro plan (el cambio se programa para el próximo período). */
  changePlan(input: { readonly subscriberUid: string; readonly fromPlanCode: PlanCode; readonly toPlanCode: PlanCode }): Promise<ProviderResult<{ readonly changed: true }>>;
  /** Verifica la autenticidad de un aviso y lo normaliza. Si el mecanismo no está documentado/configurado, SIEMPRE rechaza. */
  verifyWebhook(input: { readonly rawBody: string; readonly headers: Readonly<Record<string, string | undefined>>; readonly now: Date }): WebhookVerification;
}
