"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getSiteOrigin } from "@/lib/auth/site-url";
import { getBillingRuntime } from "@/lib/billing/runtime";
import { cancelSubscription, changePlan, reactivateSubscription, startCheckout, updatePaymentMethod, type CommandDeps } from "@/lib/billing/commands";
import { parseCheckoutCustomer, type CustomerField } from "@/lib/billing/customer";
import { FixedWindowLimiter } from "@/lib/billing/rate-limit";
import { billingErrorMessage } from "@/lib/billing/safe-errors";
import { logBilling } from "@/lib/billing/log";

// Server Actions de Facturación. Reglas (M2):
//  - nunca reciben `ownerId`, precio, período, moneda ni estado del navegador: la cuenta sale de la sesión y el servidor resuelve el
//    resto desde el catálogo; sólo se acepta un CÓDIGO de plan;
//  - con la facturación apagada responden «no disponible» sin tocar nada;
//  - el nombre y el DNI/CUIT del checkout viajan de acá a Mobbex y NO se guardan, no se registran y no vuelven en ninguna respuesta
//    (ni siquiera en un error): el cliente los borra de su estado al terminar;
//  - volver del proveedor no activa nada: sólo un cobro conciliado lo hace.

export type BillingActionResult = { readonly ok: true; readonly error?: undefined; readonly redirectUrl?: string; readonly message?: string } | { readonly ok: false; readonly error: string; readonly field?: CustomerField };

const UNAVAILABLE: BillingActionResult = { ok: false, error: billingErrorMessage("billing_disabled") };
const BUSY: BillingActionResult = { ok: false, error: "Hiciste muchos intentos seguidos. Esperá un minuto y volvé a intentar." };

// Primera barrera por instancia (el abuso real lo frenan la base y el proveedor): 8 acciones por minuto y por cuenta.
const actionLimiter = new FixedWindowLimiter({ limit: 8, windowMs: 60_000, maxKeys: 5_000, now: Date.now });

async function context(): Promise<{ ownerId: string; email: string | null; deps: CommandDeps } | BillingActionResult> {
  const runtime = getBillingRuntime();
  if (!runtime.flags.enabled) return UNAVAILABLE;
  if (!runtime.store) return { ok: false, error: billingErrorMessage("billing_unavailable") };
  let ctx;
  try {
    ctx = await requireAuthenticatedDbContext();
  } catch {
    return { ok: false, error: billingErrorMessage("billing_unavailable") };
  }
  if (!actionLimiter.check(ctx.ownerId).allowed) return BUSY;
  const user = (await ctx.supabase.auth.getUser()).data.user;
  return { ownerId: ctx.ownerId, email: user?.email ?? null, deps: { store: runtime.store, provider: runtime.provider, flags: runtime.flags, now: runtime.now } };
}

function isResult(value: unknown): value is BillingActionResult {
  return typeof value === "object" && value !== null && "ok" in value && !("deps" in value);
}

export interface StartCheckoutInput {
  planCode: string;
  name: string;
  identification: string;
}

export async function startCheckoutAction(input: StartCheckoutInput): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  const parsed = parseCheckoutCustomer({ name: input?.name, identification: input?.identification }, ready.email);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field };
  let returnUrl: string;
  try {
    returnUrl = `${await getSiteOrigin()}/facturacion/resultado`;
  } catch {
    return { ok: false, error: billingErrorMessage("billing_unavailable") };
  }
  const result = await startCheckout(ready.deps, { ownerId: ready.ownerId, planCode: input?.planCode, idempotencyKey: randomUUID(), returnUrl, customer: parsed.customer });
  revalidatePath("/facturacion");
  if (!result.ok) return { ok: false, error: result.message };
  // El adaptador falso no tiene sitio de pago: la demostración vuelve a la pantalla de resultado (que nunca activa nada).
  return { ok: true, redirectUrl: ready.deps.provider.name === "fake" ? returnUrl : result.redirectUrl };
}

export async function cancelSubscriptionAction(): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  const result = await cancelSubscription(ready.deps, ready.ownerId);
  revalidatePath("/facturacion");
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function reactivateSubscriptionAction(): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  const result = await reactivateSubscription(ready.deps, ready.ownerId);
  revalidatePath("/facturacion");
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function changePlanAction(planCode: string): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  const result = await changePlan(ready.deps, ready.ownerId, planCode);
  revalidatePath("/facturacion");
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function updatePaymentMethodAction(): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  const result = await updatePaymentMethod(ready.deps, ready.ownerId);
  return result.ok ? { ok: true, redirectUrl: ready.deps.provider.name === "fake" ? "/facturacion/resultado" : result.redirectUrl } : { ok: false, error: result.message };
}

/**
 * Volver del proveedor (o «Actualizar» en la pantalla de resultado) NUNCA activa la suscripción: sólo pide que se mire de nuevo a
 * este suscriptor, con prioridad. El estado lo decide la conciliación autenticada.
 */
export async function requestConfirmationAction(): Promise<BillingActionResult> {
  const ready = await context();
  if (isResult(ready)) return ready;
  try {
    await ready.deps.store.prioritizePolls([ready.ownerId]);
  } catch {
    logBilling("action", "prioritize_failed", { provider: ready.deps.provider.name }, "warn");
  }
  revalidatePath("/facturacion");
  return { ok: true };
}
