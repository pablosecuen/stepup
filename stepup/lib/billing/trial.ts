import { formatInstantDate } from "../format/date-format.ts";
import type { BillingSnapshot } from "./ledger.ts";
import { TRIAL_DAYS, trialEndsAtFor } from "./periods.ts";

/**
 * Prueba gratuita de TeacherFlow (condición comercial aprobada el 25/11/2026) — reglas PURAS:
 *  - 15 días calendario gratis, tarjeta obligatoria al contratar, sin cobrar el plan al empezar;
 *  - primer cobro automático a las 00:00 (America/Argentina/Buenos_Aires) del día inicio + 15: NO se promete «360 horas», se promete esa fecha;
 *  - UNA sola vez por cuenta (la marca `trialStartedAt` nunca se borra) y nunca automáticamente para las cuentas actuales (`grandfathered`).
 */
export { TRIAL_DAYS, trialEndsAtFor };

/** ¿La cuenta está dentro de su prueba gratuita? (hay prueba registrada y todavía no llegó su primer cobro) */
export function isInTrial(snapshot: Pick<BillingSnapshot, "trialStartedAt" | "trialEndsAt">, now: Date): boolean {
  return snapshot.trialStartedAt !== null && snapshot.trialEndsAt !== null && now.toISOString() < snapshot.trialEndsAt;
}

/** ¿Se ofrece la prueba en la próxima contratación de esta cuenta? Una vez por cuenta; nunca a las cuentas actuales sin una decisión explícita. */
export function isTrialEligible(snapshot: Pick<BillingSnapshot, "grandfathered" | "trialStartedAt">): boolean {
  return !snapshot.grandfathered && snapshot.trialStartedAt === null;
}

export interface TrialOffer {
  readonly days: number;
  /** Instante del primer cobro si se contrata ahora (00:00 de Argentina). */
  readonly firstChargeAtIso: string;
  /** Esa fecha en formato día/mes/año. */
  readonly firstChargeDate: string;
}

/** La oferta que se muestra ANTES de confirmar: la fecha exacta del primer cobro si la persona contrata en `now`. */
export function buildTrialOffer(now: Date): TrialOffer {
  const firstChargeAtIso = trialEndsAtFor(now.toISOString());
  return { days: TRIAL_DAYS, firstChargeAtIso, firstChargeDate: formatInstantDate(firstChargeAtIso) };
}
