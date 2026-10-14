import "server-only";
import { readBillingFlags, type BillingFlags } from "./flags.ts";
import { createNoticeLimiter, type RateLimiter } from "./rate-limit.ts";
import { FakeProviderAdapter } from "./providers/fake.ts";
import { createMobbexAdapter } from "./providers/mobbex.ts";
import type { ProviderAdapter } from "./provider.ts";
import { resolveProviderChoice } from "./provider-selection.ts";
import type { ProcessorDeps } from "./processor.ts";
import { createBillingStore } from "./supabase-store.ts";
import type { BillingStore } from "./store.ts";

/**
 * Raíz de composición de la facturación en el SERVIDOR: lee el entorno una vez y arma interruptores, adaptador y almacén.
 *  - con los interruptores apagados nada se construye más allá de los propios interruptores (ni almacén ni adaptador);
 *  - sin la clave de servicio de Supabase el almacén es `null` y todo cambio de facturación falla cerrado;
 *  - el adaptador falso sólo existe fuera de Production (ver `provider-selection.ts`).
 */
export interface BillingRuntime {
  readonly flags: BillingFlags;
  readonly provider: ProviderAdapter;
  readonly store: BillingStore | null;
  readonly limiter: RateLimiter;
  readonly now: () => Date;
}

let cached: BillingRuntime | null = null;
let fakeAdapter: FakeProviderAdapter | null = null;
let noticeLimiter: RateLimiter | null = null;

export function getBillingFlags(): BillingFlags {
  return readBillingFlags(process.env);
}

export function getBillingRuntime(): BillingRuntime {
  if (cached) return cached;
  const env = process.env;
  const choice = resolveProviderChoice(env);
  fakeAdapter ??= new FakeProviderAdapter();
  noticeLimiter ??= createNoticeLimiter();
  cached = {
    flags: readBillingFlags(env),
    provider: choice === "fake" ? fakeAdapter : createMobbexAdapter(env),
    store: createBillingStore(env),
    limiter: noticeLimiter,
    now: () => new Date(),
  };
  return cached;
}

/** Dependencias del procesamiento. `expectLive`: en Production sólo cuentan operaciones reales (con el adaptador falso, todas valen). */
export function processorDeps(runtime: BillingRuntime, worker: string): ProcessorDeps | null {
  if (!runtime.store) return null;
  return { store: runtime.store, provider: runtime.provider, now: runtime.now, expectLive: runtime.provider.name === "mobbex" && process.env.MOBBEX_SANDBOX?.trim().toLowerCase() !== "true", worker };
}
