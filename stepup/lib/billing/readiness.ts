import type { BillingFlags } from "./flags.ts";

/**
 * Requisitos para encender la facturación o el control de acceso. Función PURA: sólo informa qué falta (nombres de variables,
 * nunca valores). Es la lista que revisa quien active los interruptores; `/api/billing/*` y las pantallas no la usan para decidir
 * nada: con los interruptores apagados el sistema no cambia.
 */
export interface Readiness {
  readonly ready: boolean;
  readonly missing: readonly string[];
}

function present(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return typeof env[name] === "string" && env[name]!.trim().length > 0;
}

export function checkBillingReadiness(env: Readonly<Record<string, string | undefined>>, flags: BillingFlags, options: { readonly realProvider: boolean }): Readiness {
  const missing: string[] = [];
  if (!present(env, "SUPABASE_SERVICE_ROLE_KEY")) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!present(env, "CRON_SECRET") || env.CRON_SECRET!.trim().length < 32) missing.push("CRON_SECRET (mínimo 32 caracteres)");
  if (options.realProvider) {
    for (const name of ["MOBBEX_API_KEY", "MOBBEX_ACCESS_TOKEN"]) if (!present(env, name)) missing.push(name);
  }
  if (flags.enforcement) {
    const cutoff = env.BILLING_GRANDFATHER_CUTOFF ? Date.parse(env.BILLING_GRANDFATHER_CUTOFF) : Number.NaN;
    if (!Number.isFinite(cutoff)) missing.push("BILLING_GRANDFATHER_CUTOFF (fecha ISO igual al corte guardado en billing_settings)");
    if (!present(env, "BILLING_STATE_COOKIE_SECRET") || env.BILLING_STATE_COOKIE_SECRET!.trim().length < 32) missing.push("BILLING_STATE_COOKIE_SECRET (mínimo 32 caracteres)");
  }
  return { ready: missing.length === 0, missing };
}
