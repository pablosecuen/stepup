import type { BillingFlags } from "./flags.ts";
import { logBilling } from "./log.ts";
import { nextCheckAt, projectStatus, type BillingSnapshot } from "./ledger.ts";
import { getPlan } from "./plans.ts";
import type { ProviderAdapter } from "./provider.ts";
import { billingErrorMessage, type BillingFailure } from "./safe-errors.ts";
import { applyTrigger, canApplyTrigger, type BillingStatus } from "./state-machine.ts";
import type { BillingStore, ChangeRow, CheckoutAttempt } from "./store.ts";

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
export function decidePlanChange(snapshot: BillingSnapshot, toPlanCode: unknown, now: Date): Decision {
  const target = getPlan(toPlanCode);
  if (!target || !target.active) return REJECT("plan_invalid");
  const current = projectStatus(snapshot, now);
  if (!canApplyTrigger(current, "plan_change_requested")) return REJECT("not_allowed");
  if (target.code === snapshot.pendingPlanCode) return { ok: true, kind: "noop" };
  if (target.code === snapshot.planCode) {
    if (snapshot.pendingPlanCode === null) return { ok: true, kind: "noop" };
    return { ok: true, kind: "apply", next: { ...snapshot, pendingPlanCode: null }, change: { kind: "plan_change", fromPlanCode: snapshot.planCode, toPlanCode: target.code, effectiveAt: snapshot.currentPeriodEnd } };
  }
  return { ok: true, kind: "apply", next: { ...snapshot, pendingPlanCode: target.code }, change: { kind: "plan_change", fromPlanCode: snapshot.planCode, toPlanCode: target.code, effectiveAt: snapshot.currentPeriodEnd } };
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
    if (!snapshot.providerSubscriberUid || !snapshot.planCode) return null; // sin suscriptor en el proveedor (nunca pagó): sólo se registra la decisión
    const result = await deps.provider.cancelSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode: snapshot.planCode });
    return result.ok ? null : result.error.retryable ? "provider_unavailable" : "provider_rejected";
  });
}

export async function reactivateSubscription(deps: CommandDeps, ownerId: string): Promise<CommandResult> {
  return run(deps, ownerId, decideReactivate, async (snapshot) => {
    if (!snapshot.providerSubscriberUid || !snapshot.planCode) return null;
    const result = await deps.provider.reactivateSubscriber({ subscriberUid: snapshot.providerSubscriberUid, planCode: snapshot.planCode });
    return result.ok ? null : result.error.retryable ? "provider_unavailable" : "provider_rejected";
  });
}

export async function changePlan(deps: CommandDeps, ownerId: string, toPlanCode: unknown): Promise<CommandResult> {
  return run(deps, ownerId, (snapshot, now) => decidePlanChange(snapshot, toPlanCode, now));
}

export type StartCheckoutResult = { readonly ok: true; readonly redirectUrl: string; readonly attempt: CheckoutAttempt } | { readonly ok: false; readonly failure: BillingFailure; readonly message: string };

/**
 * Abre un checkout: el plan sólo puede ser un código del catálogo; el intento (importe y moneda incluidos) lo fija el servidor y
 * la base lo vuelve a validar contra su propio catálogo. Volver del proveedor NUNCA activa la suscripción: sólo un cobro
 * verificado y conciliado lo hace.
 */
export async function startCheckout(
  deps: CommandDeps & { readonly attemptTtlMinutes?: number },
  input: { readonly ownerId: string; readonly planCode: unknown; readonly idempotencyKey: string; readonly returnUrl: string; readonly customer: { email: string; name: string; identification: string } },
): Promise<StartCheckoutResult> {
  const failure = (code: BillingFailure): StartCheckoutResult => ({ ok: false, failure: code, message: billingErrorMessage(code) });
  if (!deps.flags.enabled) return failure("billing_disabled");
  const plan = getPlan(input.planCode);
  if (!plan || !plan.active) return failure("plan_invalid");
  let opened;
  try {
    const expiresAt = new Date(deps.now().getTime() + (deps.attemptTtlMinutes ?? 60) * 60_000).toISOString();
    opened = await deps.store.openCheckoutAttempt({ ownerId: input.ownerId, plan, provider: deps.provider.name, idempotencyKey: input.idempotencyKey, expiresAt });
  } catch {
    return failure("billing_unavailable");
  }
  if (!opened.ok) return failure(opened.reason === "not_allowed" ? "already_subscribed" : opened.reason === "plan_invalid" ? "plan_invalid" : "billing_unavailable");
  if (opened.attempt.status !== "open" && opened.attempt.status !== "completed") return failure("conflict");
  const response = await deps.provider.createCheckout({ subscriberReference: opened.attempt.subscriberReference, plan, customer: input.customer, returnUrl: input.returnUrl, idempotencyKey: opened.attempt.idempotencyKey });
  if (!response.ok) {
    await deps.store.failCheckoutAttempt(opened.attempt.id).catch(() => undefined);
    return failure(response.error.retryable ? "provider_unavailable" : "provider_rejected");
  }
  const completed = await deps.store.completeCheckoutAttempt({ attemptId: opened.attempt.id, providerCheckoutUid: response.data.checkoutUid, providerSubscriberUid: response.data.subscriberUid }).catch(() => false);
  if (!completed) return failure("billing_unavailable");
  return { ok: true, redirectUrl: response.data.redirectUrl, attempt: opened.attempt };
}
