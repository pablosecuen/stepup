import type { BillingFlags } from "./flags.ts";
import type { BillingSnapshot } from "./ledger.ts";
import { cancelAccessEnd, projectStatus } from "./ledger.ts";
import { BILLING_STATUSES, type BillingStatus } from "./state-machine.ts";

/**
 * Resolución de acceso — función PURA y centralizada: dado el estado de facturación y el instante, responde qué puede hacer la
 * cuenta, por qué (motivo seguro, sin datos internos) y cuál es la próxima acción.
 *
 * IMPORTANTE: esta función NO está conectada a `proxy.ts`, al layout privado ni a ninguna Server Action que modifique datos
 * operativos. Con `BILLING_ENFORCEMENT_ENABLED` apagado (o `BILLING_ENABLED` apagado) devuelve SIEMPRE acceso completo, igual que hoy.
 *
 * El navegador nunca decide si una cuenta está paga: esta función corre en el servidor con el estado guardado, y no confía en
 * el estado materializado sino que lo reproyecta con el reloj (`projectStatus`): una cuenta cuyo vencimiento ya pasó pero
 * todavía no fue barrida por el procesamiento se resuelve igual que si lo hubiera sido.
 *
 * Decisiones cerradas («estado desconocido»):
 *  - cuenta EXISTENTE o `grandfathered`: acceso completo, con aviso INTERNO seguro (`internalNotice`: se registra un código, la
 *    persona no ve nada) y conciliación prioritaria;
 *  - cuenta ANTERIORMENTE ACTIVA ante una falla PROPIA (la base no responde, estado ilegible): acceso durante una tolerancia
 *    ACOTADA (`OWN_FAILURE_TOLERANCE_MS`, contada desde la última verificación) con aviso visible y conciliación prioritaria;
 *    vencida la tolerancia, modo limitado;
 *  - cuenta NUEVA sin pago verificado: modo limitado;
 *  - jamás se activa por un redirect, un parámetro del cliente ni un aviso sin conciliar: esta función no recibe ninguno de ellos.
 *    Lo «anteriormente activo» sólo puede venir de una verificación firmada por el servidor (`last-known.ts`), nunca del navegador.
 *
 * El modo limitado nunca borra ni oculta datos: se puede ingresar, ver los propios datos, exportarlos, ver la facturación,
 * actualizar el medio de pago, cancelar y contactar a soporte; no se crea, edita ni importa información operativa.
 */
export type AccessLevel = "full" | "full_with_notice" | "limited";

export type AccessReason =
  | "enforcement_off"
  | "state_unavailable_grandfathered"
  | "state_unavailable_existing_account"
  | "state_unavailable_tolerance"
  | "state_unavailable_tolerance_expired"
  | "state_unavailable_unverified"
  | "grandfathered"
  | "subscription_active"
  | "renewal_processing"
  | "payment_failed_grace"
  | "subscription_ending"
  | "subscription_pending"
  | "subscription_unpaid"
  | "subscription_canceled"
  | "subscription_expired";

/** Tolerancia ante una falla PROPIA para una cuenta que estaba activa: 72 h desde la última verificación (cubre un fin de semana). */
export const OWN_FAILURE_TOLERANCE_MS = 72 * 3_600_000;

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
  readonly contactSupport: boolean;
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
  /** Registrar un código seguro (sin datos de la cuenta) para quien opera el sistema: el estado no se pudo resolver con certeza. */
  readonly internalNotice: boolean;
  /** Pedir una conciliación prioritaria de esta cuenta (consulta al proveedor) en cuanto sea posible. */
  readonly reconcilePriority: boolean;
}

/** Última verificación hecha POR EL SERVIDOR del estado de la cuenta (firmada: ver `last-known.ts`). */
export interface LastKnownAccess {
  readonly status: BillingStatus;
  readonly grandfathered: boolean;
  /** Instante de la verificación (ISO). */
  readonly verifiedAt: string;
}

export interface AccessInput {
  readonly flags: BillingFlags;
  /** Estado leído en la base; `null` si no hay fila o si la lectura falló (ver `read`). */
  readonly snapshot: BillingSnapshot | null;
  readonly now: Date;
  /** `failed` = la lectura del estado falló (falla PROPIA); `ok` (por defecto) = se leyó, y `snapshot: null` significa «sin fila». */
  readonly read?: "ok" | "failed";
  readonly lastKnown?: LastKnownAccess | null;
  /** Alta de la cuenta (auth) y corte de cuentas existentes: deciden si una cuenta sin estado es «existente» o «nueva». */
  readonly account?: { readonly createdAt: string | null } | null;
  readonly grandfatherCutoff?: string | null;
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
  contactSupport: true,
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
  contactSupport: true,
});

interface Extras {
  internalNotice?: boolean;
  reconcilePriority?: boolean;
}

function access(level: AccessLevel, reason: AccessReason, nextAction: NextAction, status: BillingStatus | null, endsAt: string | null, extras: Extras = {}): BillingAccess {
  return {
    level,
    reason,
    nextAction,
    endsAt,
    status,
    capabilities: level === "limited" ? LIMITED_CAPABILITIES : FULL_CAPABILITIES,
    internalNotice: extras.internalNotice ?? false,
    reconcilePriority: extras.reconcilePriority ?? false,
  };
}

/** Estados con los que la cuenta tenía acceso pagado al verificarse por última vez. */
const PAID_ACCESS_STATUSES: ReadonlySet<BillingStatus> = new Set<BillingStatus>(["active", "past_due", "grace_period", "cancel_at_period_end"]);

function isExistingAccount(input: AccessInput): boolean {
  const cutoff = input.grandfatherCutoff ? Date.parse(input.grandfatherCutoff) : Number.NaN;
  // Sin corte configurado no se puede probar que la cuenta sea nueva: se la trata como existente (nunca se castiga a una cuenta real
  // por una configuración faltante; el control de acceso no debe encenderse sin el corte: ver `readiness.ts`).
  if (!Number.isFinite(cutoff)) return true;
  const created = input.account?.createdAt ? Date.parse(input.account.createdAt) : Number.NaN;
  if (!Number.isFinite(created)) return false; // sin fecha de alta fiable no se asume antigüedad
  return created <= cutoff;
}

/** Estado NO determinable (falla propia, sin fila o estado ilegible): aplica las variantes de la decisión «estado desconocido». */
function resolveUnknown(input: AccessInput, readFailed: boolean): BillingAccess {
  const { lastKnown, now } = input;
  const extras: Extras = { internalNotice: true, reconcilePriority: true };
  const grandfathered = (input.snapshot?.grandfathered ?? false) || (lastKnown?.grandfathered ?? false) || lastKnown?.status === "grandfathered";
  if (grandfathered) return access("full", "state_unavailable_grandfathered", "none", null, null, extras);
  if (lastKnown && PAID_ACCESS_STATUSES.has(lastKnown.status)) {
    const verified = Date.parse(lastKnown.verifiedAt);
    const until = verified + OWN_FAILURE_TOLERANCE_MS;
    // Un reloj o una verificación ilegibles son una falla propia: se otorga la tolerancia (a favor de quien pagó).
    const within = !Number.isFinite(now.getTime()) || !Number.isFinite(verified) ? true : now.getTime() < until;
    if (within) return access("full_with_notice", "state_unavailable_tolerance", "wait", null, Number.isFinite(until) ? new Date(until).toISOString() : null, extras);
    return access("limited", "state_unavailable_tolerance_expired", "wait", null, null, extras);
  }
  if (isExistingAccount(input)) return access("full", "state_unavailable_existing_account", "none", null, null, extras);
  return access("limited", "state_unavailable_unverified", readFailed ? "wait" : "subscribe", null, null, extras);
}

export function resolveBillingAccess(input: AccessInput): BillingAccess {
  const { flags, snapshot, now } = input;
  if (!flags.enabled || !flags.enforcement) return access("full", "enforcement_off", "none", null, null);
  if (input.read === "failed") return resolveUnknown({ ...input, snapshot: null }, true);
  if (!snapshot) return resolveUnknown(input, false);
  if (!Number.isFinite(now.getTime())) return resolveUnknown(input, true);
  if (!(BILLING_STATUSES as readonly string[]).includes(snapshot.status)) return resolveUnknown(input, true); // estado ilegible

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
