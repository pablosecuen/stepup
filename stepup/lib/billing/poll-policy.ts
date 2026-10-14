import type { ProviderSubscriberStatus } from "./provider.ts";
import type { BillingStatus } from "./state-machine.ts";

/**
 * Política de sondeo por suscriptor — PURA. Decide cada cuánto se consulta al proveedor por UN suscriptor (la consulta autenticada
 * que recupera avisos perdidos y detecta cancelaciones hechas del lado del proveedor). Cuanto más cerca está de cambiar el estado
 * (vencimiento, demora, gracia), más seguido; una cuenta estable se sondea una vez por semana. Con 1.000 suscripciones activas son
 * ~143 consultas por día en régimen, más las ventanas de renovación (6 h) — nunca una consulta por suscripción por minuto.
 *
 * `null` = ya no hace falta sondear (cuenta terminada y el proveedor lo confirmó).
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface PollPolicyInput {
  readonly status: BillingStatus;
  readonly currentPeriodEnd: string | null;
  readonly providerStatus: ProviderSubscriberStatus;
  readonly now: Date;
}

export function pollDelayMs(input: PollPolicyInput): number | null {
  const { status, providerStatus } = input;
  switch (status) {
    case "pending":
    case "grandfathered": // con un intento de pago en curso (la base descarta los abandonados)
      return 2 * HOUR;
    case "past_due":
      return HOUR;
    case "grace_period":
      return 6 * HOUR;
    case "limited":
      return DAY;
    case "cancel_at_period_end":
      return DAY;
    case "canceled":
    case "expired":
      // Terminada: se deja de sondear apenas el proveedor confirma que no cobra más; si no se puede saber, una vez por semana.
      return providerStatus === "suspended" || providerStatus === "finished" ? null : 7 * DAY;
    case "active": {
      const end = input.currentPeriodEnd ? Date.parse(input.currentPeriodEnd) : Number.NaN;
      if (Number.isFinite(end) && end - input.now.getTime() <= 2 * DAY) return 6 * HOUR; // ventana de renovación
      return 7 * DAY;
    }
  }
}

/** Dispersión determinista (±10 %) por cuenta: las renovaciones concentradas en la misma hora no se sondean todas en el mismo segundo. */
export function withJitter(delayMs: number, ownerId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const fraction = (hash % 2001) / 1000 - 1; // [-1, 1]
  return Math.round(delayMs * (1 + 0.1 * fraction));
}
