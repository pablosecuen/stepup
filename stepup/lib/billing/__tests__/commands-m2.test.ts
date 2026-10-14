import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelSubscription, changePlan, reactivateSubscription, startCheckout, updatePaymentMethod, providerPlanOf, type CommandDeps } from "../commands.ts";
import { FakeProviderAdapter } from "../providers/fake.ts";
import { MemoryStore } from "./memory-store.ts";
import { OWNER_A, ar, snap } from "./helpers.ts";

const NOW = new Date(Date.parse(ar("2026-10-15", 12)));
const PAID = { planCode: "tf_monthly_ars_v1", providerPlanCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), providerSubscriberUid: "SUB1" } as const;
const CUSTOMER = { email: "qa@example.com", name: "QA", identification: "20111222" };

function setup(initial = snap({ status: "active", ...PAID }), capabilities?: { changePlan: boolean; paymentMethodUpdate: boolean }) {
  const store = new MemoryStore();
  store.seed(initial);
  const provider = new FakeProviderAdapter();
  provider.seedSubscriber("SUB1", { status: "active" });
  if (capabilities) Object.defineProperty(provider, "capabilities", { value: capabilities });
  const deps: CommandDeps = { store, provider, flags: { enabled: true, enforcement: false }, now: () => NOW };
  return { store, provider, deps };
}

test("el intento ya ABIERTO (la llamada anterior se perdió) se retoma con su clave ORIGINAL: el proveedor no crea un segundo suscriptor", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending" }));
  store.attempts.set("attempt-1", { id: "attempt-1", ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", priceVersion: 1, amountMinor: 2_490_000, currency: "ARS", subscriberReference: "tfs_" + "a".repeat(32), status: "open", idempotencyKey: "key-original-aaaa", redirectUrl: null });
  const result = await startCheckout(deps, { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-nueva-pestana", returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer: CUSTOMER });
  assert.equal(result.ok, true);
  assert.deepEqual([...provider.checkouts.keys()], ["key-original-aaaa"], "se usó la clave del intento original, nunca la de la pestaña actual");
});

test("con el intento ya completado, repetir el checkout devuelve el MISMO enlace y NO vuelve a llamar al proveedor", async () => {
  const { provider, deps } = setup(snap({ status: "pending" }));
  const base = { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1" as unknown, returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer: CUSTOMER };
  const first = await startCheckout(deps, { ...base, idempotencyKey: "key-uno-aaaaaaaa" });
  const calls = provider.calls.createCheckout;
  const again = await startCheckout(deps, { ...base, idempotencyKey: "key-dos-aaaaaaaa" });
  assert.ok(first.ok && again.ok);
  if (!(first.ok && again.ok)) return;
  assert.equal(again.redirectUrl, first.redirectUrl);
  assert.equal(provider.calls.createCheckout, calls);
});

test("cambiar de plan ANTES de pagar cancela al suscriptor del intento anterior ANTES de crear el nuevo; si no se puede cancelar, no se crea otro", async () => {
  const { provider, deps } = setup(snap({ status: "pending" }));
  const base = { ownerId: OWNER_A, returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer: CUSTOMER };
  const first = await startCheckout(deps, { ...base, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-uno-aaaaaaaa" });
  assert.ok(first.ok);
  const firstUid = [...provider.checkouts.values()][0].subscriberUid as string;
  const second = await startCheckout(deps, { ...base, planCode: "tf_annual_ars_v1", idempotencyKey: "key-dos-aaaaaaaa" });
  assert.ok(second.ok);
  assert.ok(provider.canceled.has(firstUid));
  assert.equal(provider.planCalls.at(-1)?.planCode, "tf_monthly_ars_v1", "se cancela en la suscripción del PLAN anterior");
  // Ahora el anterior ya no se puede cancelar: no se crea un tercer suscriptor.
  const { provider: p2, deps: d2 } = setup(snap({ status: "pending" }));
  await startCheckout(d2, { ...base, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-uno-bbbbbbbb" });
  const created = p2.calls.createCheckout;
  p2.injectFailure("cancelSubscriber", "unavailable", 3);
  const blocked = await startCheckout(d2, { ...base, planCode: "tf_annual_ars_v1", idempotencyKey: "key-dos-bbbbbbbb" });
  assert.equal(blocked.ok, false);
  assert.equal(p2.calls.createCheckout, created, "no se creó otro suscriptor");
});

test("el cambio de plan y el cambio de medio de pago NO se ofrecen si el proveedor no los tiene validados (no sale ningún pedido)", async () => {
  const closed = setup(undefined, { changePlan: false, paymentMethodUpdate: false });
  const refused = await changePlan(closed.deps, OWNER_A, "tf_annual_ars_v1");
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.failure, "feature_unavailable");
  const payment = await updatePaymentMethod(closed.deps, OWNER_A);
  assert.equal(payment.ok, false);
  assert.equal(payment.ok ? "" : payment.failure, "feature_unavailable");
  assert.equal(closed.provider.calls.changePlan + closed.provider.calls.getPaymentMethodUpdateUrl, 0);
  assert.equal(closed.store.subscriptions.get(OWNER_A)?.pendingPlanCode, null, "tampoco se programó nada en la base");
  const open = setup();
  assert.equal((await changePlan(open.deps, OWNER_A, "tf_annual_ars_v1")).ok, true);
  const link = await updatePaymentMethod(open.deps, OWNER_A);
  assert.ok(link.ok && link.redirectUrl.startsWith("https://"));
});

test("el medio de pago se actualiza desde cualquier estado con suscriptor menos grandfathered/finalizada, y sin suscriptor no existe", async () => {
  for (const status of ["active", "past_due", "grace_period", "limited", "cancel_at_period_end", "pending"] as const) {
    const overrides = status === "pending" ? snap({ status, providerSubscriberUid: "SUB1", providerPlanCode: "tf_monthly_ars_v1" }) : snap({ status, ...PAID, ...(status === "cancel_at_period_end" ? { cancelRequestedAt: ar("2026-10-10") } : {}), ...(status === "limited" ? { currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07") } : {}), ...(status === "past_due" ? { currentPeriodEnd: ar("2026-10-14"), graceEndsAt: ar("2026-10-20") } : {}), ...(status === "grace_period" ? { currentPeriodEnd: ar("2026-10-14"), graceEndsAt: ar("2026-10-20"), renewalRejectedDueAt: ar("2026-10-14", 10) } : {}) });
    const result = await updatePaymentMethod(setup(overrides).deps, OWNER_A);
    assert.equal(result.ok, true, status);
  }
  for (const overrides of [snap({ status: "grandfathered", grandfathered: true }), snap({ status: "expired", ...PAID, currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07"), providerEndedAt: ar("2026-09-25") }), snap({ status: "pending" })]) assert.equal((await updatePaymentMethod(setup(overrides).deps, OWNER_A)).ok, false, overrides.status);
});

test("cancelar, reactivar y consultar hablan SIEMPRE con la suscripción del proveedor del suscriptor (puede diferir del plan vigente tras un cambio de plan)", async () => {
  const moved = snap({ status: "active", ...PAID, providerPlanCode: "tf_annual_ars_v1", pendingPlanCode: "tf_annual_ars_v1" });
  assert.equal(providerPlanOf(moved), "tf_annual_ars_v1");
  assert.equal(providerPlanOf(snap({ planCode: "tf_monthly_ars_v1" })), "tf_monthly_ars_v1");
  assert.equal(providerPlanOf(snap({})), null);
  const { provider, deps } = setup(moved);
  assert.deepEqual(await cancelSubscription(deps, OWNER_A), { ok: true, changed: true });
  assert.deepEqual(provider.planCalls.at(-1), { method: "cancelSubscriber", subscriberUid: "SUB1", planCode: "tf_annual_ars_v1" });
  assert.deepEqual(await reactivateSubscription(deps, OWNER_A), { ok: true, changed: true });
  assert.deepEqual(provider.planCalls.at(-1), { method: "reactivateSubscriber", subscriberUid: "SUB1", planCode: "tf_annual_ars_v1" });
});

test("hay suscriptor en el proveedor pero se ignora su plan: NO se cancela a medias (ni se registra la cancelación)", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending", providerSubscriberUid: "SUB1", providerPlanCode: null, planCode: null }));
  const result = await cancelSubscription(deps, OWNER_A);
  assert.equal(result.ok, false);
  assert.equal(provider.calls.cancelSubscriber, 0);
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "pending");
  assert.equal(store.changes.length, 0);
});
