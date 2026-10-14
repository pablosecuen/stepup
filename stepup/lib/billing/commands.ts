import type { BillingFlags } from "./flags.ts";
import { logBilling } from "./log.ts";
import { nextCheckAt, projectStatus, type BillingSnapshot } from "./ledger.ts";
import { getPlan } from "./plans.ts";
import type { ProviderAdapter } from "./provider.ts";
import { billingErrorMessage, type BillingFailure } from "./safe-errors.ts";
import { applyTrigger, canApplyTrigger, type BillingStatus } from "./state-machine.ts";
import type { BillingStore, ChangeRow, CheckoutAttempt } from "./store.ts";
import type { ProviderCustomer } from "./provider.ts";

/**
 * Comandos de la persona sobre su suscripción (M1): cancelar, reactivar, cambiar de plan y abrir un checkout. El navegador sólo
 * pide la acción; el servidor resuelve la cuenta (`ownerId` de la sesión, nunca del cliente), valida contra la máquina de
 * estados y el catálogo, y escribe con control optimista de versión. Nada de esto está conectado a una ruta o pantalla en M1.
 *
 * Los cambios de facturación FALLAN CERRADO: sin estado conocido, con la facturación apagada o ante cualquier duda no se cambia nada.
 */
export type Decision = { readonly ok: true; readonly kind: "noop" } | { readonly ok: true; readonly kind: "apply"; readonly next: BillingSnapshot; readonly change: Omit<ChangeRow, "ownerId" | "idempotencyKey"> } | { readonly ok: false; readonly failure: BillingFailure };

const REJECT = (failure: BillingFailure): Decision => ({ ok: false, failure });

/** Cancelar: conserva el acceso hasta el fin de lo pagado; repetir la cancelación no hace nada. */
export function decideCancel(snapshot: BillingSnapshot, now: Date): Decision {
  const current: BillingStatus = projectStatus(snapshot, now);
  if (current === "cancel_at_period_end" || current === "canceled") return { ok: true, kind: "noop" };
  const candidate: BillingSnapshot = { ...snapshot, cancelRequestedAt: now.toISOString() };
  const status = projectStatus(candidate, now);
  const move = applyTrigger(current, "cancel_requested", status);
  if (!move.ok) return REJECT("not_allowed");
  return { ok: true, kind: "apply", next: { ...candidate, status }, change: { kind: "cancel", fromPlanCode: snapshot.planCode, toPlanCode: null, effectiveAt: candidate.currentPeriodEnd } };
}

/** Reactivar una cancelación mientras el acceso todavía no terminó. */
export function decideReactivate(snapshot: BillingSnapshot, now: Date): Decision {
  const current = projectStatus(snapshot, now);
  if (current !== "cancel_at_period_end") return REJECT("not_allowed");
  const candidate: BillingSnapshot = { ...snapshot, cancelRequestedAt: null };
  const status = projectStatus(candidate, now);
  const move = applyTrigger(current, "reactivate_requested", status);
  if (!move.ok) return REJECT("not_allowed");
  return { ok: true, kind: "apply", next: { ...candidate, status }, change: { kind: "reactivate", fromPlanCode: snapshot.planCode, toPlanCode: null, effectiveAt: null } };
}

/**
 * Cambio de plan: sólo con la suscripción activa, programado para el PRÓXIMO período (sin prorrateo ni crédito) y nunca crea una
 * suscripción nueva. Pedir el plan que ya se tiene (o el que ya está programado) no hace nada; pedir el vigente cuando hay otro
 * programado descarta el cambio programado.
 */
/** Plan con el que se habla con el proveedor de esta cuenta: el de su suscripción allá (aunque todavía no haya pagado) o, si no, el vigente. */
export function providerPlanOf(snapshot: Pick<BillingSnapshot, "providerPlanCode" | "planCode">) {
  return snapshot.providerPlanCode ?? snapshot.planCode;
}

export function decidePlanChange(snapshot: BillingSnapshot, toPlanCode: unknown, now: Date): Decision {
  const target = getPlan(toPlanCode);
  if (!target || !target.active) return REJECT("plan_invalid");
  const current = projectStatus(snapshot, now);
  if (!canApplyTrigger(current, "plan_change_requested")) return REJECT("not_allowed");
  if (target.code === snapshot.pendingPlanCode) return { ok: true, kind: "noop" };
  if (target.code === snapshot.planCode) {
    if (snapshot.pendingPlanCode === null) return { ok: true, kind: "noop" };
    return { ok: true, kind: "apply", next: { ...snapshot, pendingPlanCode: null, providerPlanCode: snapshot.planCode }, change: { kind: "plan_change", fromPlanCode: snapshot.planCode, toPlanCode: target.code, effectiveAt: snapshot.currentPeriodEnd } };
  }
  return { ok: true, kind: "apply", next: { ...snapshot, pendingPlanCode: target.code, providerPlanCode: target.code }, change: { kind: "plan_change", fromPlanCode: snapshot.planCode, toPlanCode: target.code, effectiveAt: snapshot.currentPeriodEnd } };
}

/** ¿Puede esta cuenta empezar un checkout ahora? (La validación atómica real vive en la base; esto sólo informa a la pantalla.) */
export function canStartCheckout(snapshot: BillingSnapshot, now: Date): boolean {
  return canApplyTrigger(projectStatus(snapshot, now), "checkout_started");
}

export interface CommandDeps {
  readonly store: BillingStore;
  readonly provider: ProviderAdapter;
  readonly flags: BillingFlags;
  readonly now: () => Date;
}

export type CommandResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly failure: BillingFailure; readonly message: string };

const fail = (failure: BillingFailure): CommandResult => ({ ok: false, failure, message: billingErrorMessage(failure) });

function changeKey(kind: ChangeRow["kind"], snapshot: BillingSnapshot, extra: string): string {
  return `${kind}:${snapshot.version}:${extra}`;
}

const MAX_CONFLICT_RETRIES = 3;

async function run(deps: CommandDeps, ownerId: string, decide: (snapshot: BillingSnapshot, now: Date) => Decision, afterDecision?: (snapshot: BillingSnapshot) => Promise<BillingFailure | null>): Promise<CommandResult> {
  if (!deps.flags.enabled) return fail("billing_disabled");
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
    let snapshot: BillingSnapshot | undefined;
    try {
      snapshot = (await deps.store.loadSubscriptions([ownerId])).get(ownerId) ?? (await deps.store.ensureAccount(ownerId));
    } catch {
      return fail("billing_unavailable"); // Supabase caído: falla cerrado, no se cambia nada
    }
    if (!snapshot) return fail("billing_unavailable");
    const now = deps.now();
    const decision = decide(snapshot, now);
    if (!decision.ok) return fail(decision.failure);
    if (decision.kind === "noop") return { ok: true, changed: false };
    // Primero el proveedor (idempotente), después la base: si el proveedor falla no queda ningún cambio a medias.
    const providerFailure = afterDecision ? await afterDecision(snapshot) : null;
    if (providerFailure) return fail(providerFailure);
    try {
      const commit = await deps.store.commitBatch({
        executions: [],
        periods: [],
        reconciliations: [],
        events: [],
        subscriptions: [{ snapshot: decision.next, expectedVersion: snapshot.version, nextCheckAt: nextCheckAt(decision.next) }],
        changes: [{ ownerId, ...decision.change, idempotencyKey: changeKey(decision.change.kind, snapshot, decision.change.toPlanCode ?? "-") }],
      });
      if (commit.conflicts.length === 0) return { ok: true, changed: true };
      // Alguien cambió la cuenta en el medio (dos pestañas): se relee y se vuelve a decidir sobre el estado nuevo.
    } catch {
      logBilling("command", "commit_failed", { code: decision.change.kind }, "error");
      return fail("billing_unavailable");
    }
  }
  return fail("conflict");
}

export async function cancelSubscription(deps: CommandDeps, ownerId: string): Promise<CommandResult> {
  return run(deps, ownerId, decideCancel, async (snapshot) => {
    const planCode = providerPlanOf(snapshot);
    if (!snapshot.providerSubscriberUid) return null; // sin suscriptor en el proveedor: sólo se registra la decisión
    if (!planCode) return "provider_rejected"; // hay suscriptor pero se ignora su plan: no se puede garantizar que no cobre → no se cancela a medias
    const result = await deps.provider.cancelSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode });
    return result.ok ? null : result.error.retryable ? "provider_unavailable" : "provider_rejected";
  });
}

export async function reactivateSubscription(deps: CommandDeps, ownerId: string): Promise<CommandResult> {
  return run(deps, ownerId, decideReactivate, async (snapshot) => {
    const planCode = providerPlanOf(snapshot);
    if (!snapshot.providerSubscriberUid || !planCode) return null;
    const result = await deps.provider.reactivateSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode });
    return result.ok ? null : result.error.retryable ? "provider_unavailable" : "provider_rejected";
  });
}

/**
 * Cambio de plan: efectivo en el PRÓXIMO período, sin prorrateo ni crédito automático (decisión cerrada 7). Sólo se ofrece si el
 * proveedor tiene la operación VALIDADA (`capabilities.changePlan`): con Mobbex hoy no lo está (falta validar en sandbox cómo se
 * comporta «mover suscriptor»), así que no se programa nada y no sale ningún pedido. Proveedor primero, después la base.
 */
export async function changePlan(deps: CommandDeps, ownerId: string, toPlanCode: unknown): Promise<CommandResult> {
  if (!deps.provider.capabilities.changePlan) return fail("feature_unavailable");
  return run(
    deps,
    ownerId,
    (snapshot, now) => decidePlanChange(snapshot, toPlanCode, now),
    async (snapshot) => {
      const target = getPlan(toPlanCode);
      const from = providerPlanOf(snapshot);
      if (!snapshot.providerSubscriberUid || !from || !target) return null;
      if (target.code === from) return null; // ya está en esa suscripción del proveedor
      const result = await deps.provider.changePlan({ subscriberUid: snapshot.providerSubscriberUid, fromPlanCode: from, toPlanCode: target.code });
      return result.ok ? null : result.error.kind === "unsupported" ? "feature_unavailable" : result.error.retryable ? "provider_unavailable" : "provider_rejected";
    },
  );
}

export type PaymentMethodResult = { readonly ok: true; readonly redirectUrl: string } | { readonly ok: false; readonly failure: BillingFailure; readonly message: string };

/**
 * Actualizar el medio de pago: lleva a la persona a la página del proveedor donde carga la tarjeta nueva. NO cambia ningún estado
 * (volver de allá nunca activa nada: lo único que cuenta es el cobro conciliado). Sólo para quien ya tiene un suscriptor.
 */
export async function updatePaymentMethod(deps: CommandDeps, ownerId: string): Promise<PaymentMethodResult> {
  const failure = (code: BillingFailure): PaymentMethodResult => ({ ok: false, failure: code, message: billingErrorMessage(code) });
  if (!deps.flags.enabled) return failure("billing_disabled");
  if (!deps.provider.capabilities.paymentMethodUpdate) return failure("feature_unavailable");
  let snapshot: BillingSnapshot | undefined;
  try {
    snapshot = (await deps.store.loadSubscriptions([ownerId])).get(ownerId);
  } catch {
    return failure("billing_unavailable");
  }
  const planCode = snapshot ? providerPlanOf(snapshot) : null;
  if (!snapshot?.providerSubscriberUid || !planCode) return failure("not_allowed");
  const status = projectStatus(snapshot, deps.now());
  if (status === "grandfathered" || status === "expired") return failure("not_allowed");
  const result = await deps.provider.getPaymentMethodUpdateUrl({ subscriberUid: snapshot.providerSubscriberUid, planCode });
  if (!result.ok) return failure(result.error.kind === "unsupported" ? "feature_unavailable" : result.error.retryable ? "provider_unavailable" : "provider_rejected");
  return { ok: true, redirectUrl: result.data.redirectUrl };
}

export type StartCheckoutResult = { readonly ok: true; readonly redirectUrl: string; readonly attempt: CheckoutAttempt } | { readonly ok: false; readonly failure: BillingFailure; readonly message: string };

/**
 * Abre un checkout: el plan sólo puede ser un código del catálogo; el intento (importe y moneda incluidos) lo fija el servidor y
 * la base lo vuelve a validar contra su propio catálogo. Volver del proveedor NUNCA activa la suscripción: sólo un cobro
 * verificado y conciliado lo hace.
 */
export async function startCheckout(
  deps: CommandDeps & { readonly attemptTtlMinutes?: number },
  input: { readonly ownerId: string; readonly planCode: unknown; readonly idempotencyKey: string; readonly returnUrl: string; readonly customer: ProviderCustomer },
): Promise<StartCheckoutResult> {
  const failure = (code: BillingFailure): StartCheckoutResult => ({ ok: false, failure: code, message: billingErrorMessage(code) });
  if (!deps.flags.enabled) return failure("billing_disabled");
  const plan = getPlan(input.planCode);
  if (!plan || !plan.active) return failure("plan_invalid");
  let opened;
  try {
    const expiresAt = new Date(deps.now().getTime() + (deps.attemptTtlMinutes ?? 1_440) * 60_000).toISOString();
    opened = await deps.store.openCheckoutAttempt({ ownerId: input.ownerId, plan, provider: deps.provider.name, idempotencyKey: input.idempotencyKey, expiresAt });
  } catch {
    return failure("billing_unavailable");
  }
  if (!opened.ok) return failure(opened.reason === "not_allowed" ? "already_subscribed" : opened.reason === "plan_invalid" ? "plan_invalid" : "billing_unavailable");
  if (opened.attempt.status !== "open" && opened.attempt.status !== "completed") return failure("conflict");
  // Dos pestañas, un doble clic o volver atrás: el intento ya tiene su enlace → se devuelve el MISMO, sin crear otro suscriptor en el proveedor.
  if (opened.attempt.status === "completed" && opened.attempt.redirectUrl) return { ok: true, redirectUrl: opened.attempt.redirectUrl, attempt: opened.attempt };
  // Cambió de plan antes de pagar: el suscriptor del intento anterior se cancela ANTES de crear el nuevo (nunca dos suscriptores con medio de pago).
  for (const stale of opened.stale) {
    const cancelled = await deps.provider.cancelSubscriber({ subscriberUid: stale.uid, planCode: stale.planCode });
    if (!cancelled.ok) {
      await deps.store.failCheckoutAttempt(opened.attempt.id).catch(() => undefined);
      return failure(cancelled.error.retryable ? "provider_unavailable" : "provider_rejected");
    }
  }
  const response = await deps.provider.createCheckout({ subscriberReference: opened.attempt.subscriberReference, plan, customer: input.customer, returnUrl: input.returnUrl, idempotencyKey: opened.attempt.idempotencyKey });
  if (!response.ok) {
    await deps.store.failCheckoutAttempt(opened.attempt.id).catch(() => undefined);
    return failure(response.error.retryable ? "provider_unavailable" : "provider_rejected");
  }
  const completed = await deps.store.completeCheckoutAttempt({ attemptId: opened.attempt.id, providerCheckoutUid: response.data.checkoutUid, providerSubscriberUid: response.data.subscriberUid, redirectUrl: response.data.redirectUrl }).catch(() => false);
  if (!completed) return failure("billing_unavailable");
  return { ok: true, redirectUrl: response.data.redirectUrl, attempt: opened.attempt };
}
