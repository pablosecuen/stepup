/**
 * Interruptores de la facturación (M1). Ambos nacen APAGADOS y se leen únicamente del entorno del SERVIDOR:
 *
 *   BILLING_ENABLED=false               habilita la facturación (adaptadores, procesamiento, pantallas de facturación)
 *   BILLING_ENFORCEMENT_ENABLED=false   habilita el CONTROL DE ACCESO por estado de suscripción
 *
 * Reglas:
 *  - sólo el texto exacto `true` (sin distinguir mayúsculas ni espacios) enciende un interruptor; cualquier otro valor, o su
 *    ausencia, es APAGADO. Nunca se «interpreta» `1`, `yes`, `on` ni un valor mal escrito;
 *  - el control de acceso nunca puede estar encendido sin la facturación: `BILLING_ENFORCEMENT_ENABLED=true` con
 *    `BILLING_ENABLED` apagado se trata como APAGADO (sin facturación no hay estados que hacer cumplir);
 *  - ningún nombre lleva el prefijo `NEXT_PUBLIC_`: el navegador no debe ni puede conocer estos valores.
 */
export interface BillingFlags {
  readonly enabled: boolean;
  readonly enforcement: boolean;
}

export const BILLING_FLAGS_OFF: BillingFlags = Object.freeze({ enabled: false, enforcement: false });

function isOn(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function readBillingFlags(env: Readonly<Record<string, string | undefined>> = process.env): BillingFlags {
  const enabled = isOn(env.BILLING_ENABLED);
  const enforcement = enabled && isOn(env.BILLING_ENFORCEMENT_ENABLED);
  return { enabled, enforcement };
}
