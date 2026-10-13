import type { BillingFlags } from "./flags.ts";
import type { BillingSnapshot } from "./ledger.ts";
import { cancelAccessEnd, projectStatus } from "./ledger.ts";
import type { BillingStatus } from "./state-machine.ts";

/**
 * Resolución de acceso (M1) — función PURA y centralizada: dado el estado de facturación y el instante, responde qué puede hacer
 * la cuenta, por qué (motivo seguro, sin datos internos) y cuál es la próxima acción.
 *
 * IMPORTANTE: en M1 esta función NO está conectada a `proxy.ts`, al layout privado ni a ninguna pantalla o Server Action. Con
 * `BILLING_ENFORCEMENT_ENABLED` apagado (o `BILLING_ENABLED` apagado) devuelve SIEMPRE acceso completo, igual que hoy.
 *
 * El navegador nunca decide si una cuenta está paga: esta función corre en el servidor con el estado guardado, y no confía en
 * el estado materializado sino que lo reproyecta con el reloj (`projectStatus`): una cuenta cuyo vencimiento ya pasó pero
 * todavía no fue barrida por el procesamiento se resuelve igual que si lo hubiera sido.
 *
 * Decisiones de diseño (a confirmar en la revisión):
 *  - sin estado conocido (sin fila, o la base no responde) con el control encendido: acceso completo con motivo
 *    `billing_state_unavailable`. Una falla de Supabase nunca bloquea a una profesora que paga; sí bloquea (falla cerrado)
 *    cualquier CAMBIO de facturación;
 *  - el modo limitado nunca borra ni oculta datos: se puede ingresar, ver los propios datos, ver la facturación, cancelar,
 *    actualizar el medio de pago, exportar y eliminar la cuenta; no se crea ni se modifica información operativa.
 */
export type AccessLevel = "full" | "full_with_notice" | "limited";

export type AccessReason =
  | "enforcement_off"
  | "billing_state_unavailable"
  | "grandfathered"
  | "subscription_active"
  | "renewal_processing"
  | "payment_failed_grace"
  | "subscription_ending"
  | "subscription_pending"
  | "subscription_unpaid"
  | "subscription_canceled"
  | "subscription_expired";

export type NextAction = "none" | "wait" | "update_payment_method" | "subscribe" | "resubscribe" | "reactivate";

export interface AccessCapabilities {
  readonly viewOperationalData: boolean;
  readonly createOperationalData: boolean;
  readonly modifyOperationalData: boolean;
  readonly viewBilling: boolean;
  readonly cancelSubscription: boolean;
  readonly updatePaymentMethod: boolean;
  readonly exportData: boolean;
  readonly deleteAccount: boolean;
}

export interface BillingAccess {
  readonly level: AccessLevel;
  readonly reason: AccessReason;
  readonly nextAction: NextAction;
  /** Fin del período pagado o de la gracia que corresponde al estado (instante ISO), o `null`. */
  readonly endsAt: string | null;
  /** Estado proyectado al instante evaluado; `null` si no se conoce. */
  readonly status: BillingStatus | null;
  readonly capabilities: AccessCapabilities;
}

const FULL_CAPABILITIES: AccessCapabilities = Object.freeze({
  viewOperationalData: true,
  createOperationalData: true,
  modifyOperationalData: true,
  viewBilling: true,
  cancelSubscription: true,
  updatePaymentMethod: true,
  exportData: true,
  deleteAccount: true,
});

const LIMITED_CAPABILITIES: AccessCapabilities = Object.freeze({
  viewOperationalData: true,
  createOperationalData: false,
  modifyOperationalData: false,
  viewBilling: true,
  cancelSubscription: true,
  updatePaymentMethod: true,
  exportData: true,
  deleteAccount: true,
});

function access(level: AccessLevel, reason: AccessReason, nextAction: NextAction, status: BillingStatus | null, endsAt: string | null): BillingAccess {
  return { level, reason, nextAction, endsAt, status, capabilities: level === "limited" ? LIMITED_CAPABILITIES : FULL_CAPABILITIES };
}

export function resolveBillingAccess(input: { flags: BillingFlags; snapshot: BillingSnapshot | null; now: Date }): BillingAccess {
  const { flags, snapshot, now } = input;
  if (!flags.enabled || !flags.enforcement) return access("full", "enforcement_off", "none", null, null);
  if (!snapshot || !Number.isFinite(now.getTime())) return access("full", "billing_state_unavailable", "none", null, null);

  const status = projectStatus(snapshot, now);
  const periodEnd = snapshot.currentPeriodEnd;
  const graceEnd = snapshot.graceEndsAt ?? periodEnd;
  switch (status) {
    case "grandfathered":
      return access("full", "grandfathered", "none", status, null);
    case "active":
      return access("full", "subscription_active", "none", status, periodEnd);
    case "past_due":
      return access("full", "renewal_processing", "wait", status, graceEnd);
    case "grace_period":
      return access("full_with_notice", "payment_failed_grace", "update_payment_method", status, graceEnd);
    case "cancel_at_period_end":
      return access("full_with_notice", "subscription_ending", "reactivate", status, cancelAccessEnd(snapshot));
    case "pending":
      return access("limited", "subscription_pending", "subscribe", status, null);
    case "limited":
      return access("limited", "subscription_unpaid", "update_payment_method", status, null);
    case "canceled":
      return access("limited", "subscription_canceled", "resubscribe", status, null);
    case "expired":
      return access("limited", "subscription_expired", "resubscribe", status, null);
  }
}
