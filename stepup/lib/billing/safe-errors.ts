/**
 * Errores de facturación visibles para la persona (M1). Texto en español, claro y accionable; NUNCA códigos internos, secretos,
 * cuerpos de proveedores, SQL, restricciones ni identificadores. El código interno (`BillingFailure`) sólo se usa para decidir qué
 * frase mostrar y para el registro seguro (`log.ts`).
 *
 * Regla de la facturación: ante la duda se falla CERRADO para cualquier cambio (no se cobra, no se activa, no se cancela «a
 * medias»), pero la aplicación operativa nunca se bloquea mientras el control de acceso esté apagado.
 */
export type BillingFailure =
  | "billing_disabled"
  | "billing_unavailable"
  | "plan_invalid"
  | "already_subscribed"
  | "not_allowed"
  | "conflict"
  | "provider_unavailable"
  | "provider_rejected"
  | "unknown";

const MESSAGES: Readonly<Record<BillingFailure, string>> = {
  billing_disabled: "La suscripción todavía no está disponible. Podés seguir usando TeacherFlow con normalidad.",
  billing_unavailable: "No pudimos consultar tu suscripción en este momento. Probá de nuevo en unos minutos; no se hizo ningún cambio.",
  plan_invalid: "El plan elegido ya no está disponible. Elegí otro y volvé a intentar.",
  already_subscribed: "Ya tenés una suscripción en curso. Podés cambiar de plan o cancelarla desde Facturación.",
  not_allowed: "Esa acción no está disponible para tu suscripción en este momento.",
  conflict: "Tu suscripción cambió mientras hacías esta acción. Revisá el estado actual y, si hace falta, volvé a intentar.",
  provider_unavailable: "No pudimos comunicarnos con el servicio de cobro. No se hizo ningún cambio ni ningún cobro; probá de nuevo en unos minutos.",
  provider_rejected: "El servicio de cobro no pudo completar la acción. No se hizo ningún cobro. Si vuelve a pasar, contactanos.",
  unknown: "No pudimos completar la acción y no se hizo ningún cambio. Probá de nuevo; si vuelve a pasar, contactanos.",
};

export function billingErrorMessage(failure: BillingFailure): string {
  return MESSAGES[failure] ?? MESSAGES.unknown;
}

export const ALL_BILLING_FAILURES = Object.keys(MESSAGES) as BillingFailure[];
