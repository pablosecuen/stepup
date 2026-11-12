import "server-only";
import { readBillingFlags, type BillingFlags } from "./flags.ts";
import { createNoticeLimiter, type RateLimiter } from "./rate-limit.ts";
import { FakeProviderAdapter } from "./providers/fake.ts";
import { createMobbexAdapter } from "./providers/mobbex.ts";
import { createRebillAdapter } from "./providers/rebill.ts";
import type { ProviderAdapter } from "./provider.ts";
import { expectsLiveOperations, resolveProviderChoice } from "./provider-selection.ts";
import { confirmOwnerPayment, type ConfirmOutcome } from "./confirm.ts";
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
    provider: choice === "fake" ? fakeAdapter : choice === "mobbex" ? createMobbexAdapter(env) : createRebillAdapter(env),
    store: createBillingStore(env),
    limiter: noticeLimiter,
    now: () => new Date(),
  };
  return cached;
}

/** Concilia a pedido los cobros recientes de UNA cuenta sin suscriptor vinculado (ver confirm.ts): al volver del pago y antes de eliminar una cuenta. */
export async function reconcileOwnerNow(runtime: BillingRuntime, ownerId: string, options: { readonly force?: boolean } = {}): Promise<ConfirmOutcome> {
  return confirmOwnerPayment(processorDeps(runtime, `owner-${Date.now().toString(36)}`), ownerId, options);
}

/** Dependencias del procesamiento. `expectLive`: en Production sólo cuentan operaciones reales (con el adaptador falso, todas valen). */
export function processorDeps(runtime: BillingRuntime, worker: string): ProcessorDeps | null {
  if (!runtime.store) return null;
  return { store: runtime.store, provider: runtime.provider, now: runtime.now, expectLive: expectsLiveOperations(runtime.provider.name, process.env), worker };
}
