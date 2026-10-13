import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelSubscription, canStartCheckout, changePlan, decideCancel, decidePlanChange, decideReactivate, reactivateSubscription, startCheckout, type CommandDeps } from "../commands.ts";
import { FakeProviderAdapter } from "../providers/fake.ts";
import { ALL_BILLING_FAILURES, billingErrorMessage } from "../safe-errors.ts";
import { BILLING_STATUSES } from "../state-machine.ts";
import { MemoryStore } from "./memory-store.ts";
import { OWNER_A, ar, coherent, snap } from "./helpers.ts";

const NOW = new Date(Date.parse(ar("2026-10-15", 12)));
const PAID = { planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), providerSubscriberUid: "SUBR1" } as const;
const CUSTOMER = { email: "qa@example.com", name: "QA", identification: "20111222" };

function setup(initial = snap({ status: "active", ...PAID })) {
  const store = new MemoryStore();
  store.seed(initial);
  const provider = new FakeProviderAdapter(null);
  const deps: CommandDeps = { store, provider, flags: { enabled: true, enforcement: false }, now: () => NOW };
  return { store, provider, deps };
}

test("cancelar: active → cancel_at_period_end; desde limited o pending → canceled; grandfathered no tiene nada que cancelar", () => {
  const active = decideCancel(snap({ status: "active", ...PAID }), NOW);
  assert.equal(active.ok && active.kind === "apply" ? active.next.status : null, "cancel_at_period_end");
  assert.equal(active.ok && active.kind === "apply" ? active.next.cancelRequestedAt : null, NOW.toISOString());
  const pending = decideCancel(snap({ status: "pending" }), NOW);
  assert.equal(pending.ok && pending.kind === "apply" ? pending.next.status : null, "canceled");
  const limited = decideCancel(snap({ status: "limited", ...PAID, currentPeriodEnd: ar("2026-09-01"), graceEndsAt: ar("2026-09-07") }), NOW);
  assert.equal(limited.ok && limited.kind === "apply" ? limited.next.status : null, "canceled");
  assert.deepEqual(decideCancel(snap({ status: "grandfathered", grandfathered: true }), NOW), { ok: false, failure: "not_allowed" });
  const inGrace = decideCancel(snap({ status: "grace_period", ...PAID, currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-17"), renewalRejectedDueAt: ar("2026-10-11") }), NOW);
  assert.equal(inGrace.ok && inGrace.kind === "apply" ? inGrace.next.status : null, "cancel_at_period_end");
});

test("cancelación REPETIDA: no hace nada (ni escribe ni vuelve a llamar al proveedor)", async () => {
  const { store, provider, deps } = setup();
  assert.deepEqual(await cancelSubscription(deps, OWNER_A), { ok: true, changed: true });
  assert.deepEqual(await cancelSubscription(deps, OWNER_A), { ok: true, changed: false });
  assert.deepEqual(await cancelSubscription(deps, OWNER_A), { ok: true, changed: false });
  assert.equal(provider.calls.cancelSubscriber, 1, "el proveedor se llamó una sola vez");
  assert.equal(store.calls.filter((name) => name === "commitBatch").length, 1);
  assert.equal(store.changes.filter((change) => change.kind === "cancel").length, 1, "un solo registro de cancelación");
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "cancel_at_period_end");
});

test("cancelar NO borra historial: conserva el plan, el período y las fechas", async () => {
  const { store, deps } = setup();
  await cancelSubscription(deps, OWNER_A);
  const after = store.subscriptions.get(OWNER_A)!;
  assert.equal(after.planCode, "tf_monthly_ars_v1");
  assert.equal(after.currentPeriodEnd, ar("2026-11-01"));
  assert.equal(after.cancelRequestedAt, NOW.toISOString());
});

test("si el proveedor falla al cancelar, NO se cambia nada en la base (falla cerrado) y el mensaje no muestra detalles", async () => {
  const { store, provider, deps } = setup();
  provider.injectFailure("cancelSubscriber", "unavailable", 1);
  const result = await cancelSubscription(deps, OWNER_A);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, "provider_unavailable");
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "active");
  assert.equal(store.calls.includes("commitBatch"), false);
  // Se puede reintentar sin duplicar nada.
  assert.deepEqual(await cancelSubscription(deps, OWNER_A), { ok: true, changed: true });
});

test("DOS PESTAÑAS: la cuenta cambió entre la lectura y la escritura → se relee y se decide de nuevo (resultado único, sin duplicados)", async () => {
  const { store, deps } = setup();
  let interfered = false;
  store.beforeCommit = () => {
    if (interfered) return;
    interfered = true;
    // La otra pestaña canceló primero.
    const current = store.subscriptions.get(OWNER_A)!;
    store.subscriptions.set(OWNER_A, { ...current, status: "cancel_at_period_end", cancelRequestedAt: NOW.toISOString(), version: current.version + 1 });
  };
  const result = await cancelSubscription(deps, OWNER_A);
  assert.deepEqual(result, { ok: true, changed: false }, "al releer, ya estaba cancelada: no hay nada que hacer");
  assert.equal(store.changes.length, 0);
});

test("conflictos persistentes terminan en un error claro (nunca un bucle infinito)", async () => {
  const { store, deps } = setup();
  store.beforeCommit = () => {
    const current = store.subscriptions.get(OWNER_A)!;
    store.subscriptions.set(OWNER_A, { ...current, version: current.version + 1 });
  };
  const result = await cancelSubscription(deps, OWNER_A);
  assert.equal(result.ok ? null : result.failure, "conflict");
  assert.equal(store.calls.filter((name) => name === "commitBatch").length, 3);
});

test("reactivar sólo dentro del acceso pagado, y sólo si estaba cancelada al final del período", async () => {
  const { store, deps } = setup(snap({ status: "cancel_at_period_end", ...PAID, cancelRequestedAt: ar("2026-10-10") }));
  assert.deepEqual(await reactivateSubscription(deps, OWNER_A), { ok: true, changed: true });
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "active");
  assert.equal(store.subscriptions.get(OWNER_A)?.cancelRequestedAt, null);
  assert.deepEqual(decideReactivate(snap({ status: "active", ...PAID }), NOW), { ok: false, failure: "not_allowed" });
  assert.deepEqual(decideReactivate(snap({ status: "canceled", cancelRequestedAt: ar("2026-09-01") }), NOW), { ok: false, failure: "not_allowed" });
});

test("cambio de plan: sólo con la suscripción ACTIVA, programado para el próximo período, sin duplicar suscripciones", () => {
  for (const status of BILLING_STATUSES) {
    const decision = decidePlanChange(coherent(status), "tf_annual_ars_v1", NOW);
    if (status === "active") {
      assert.equal(decision.ok && decision.kind === "apply" ? decision.next.pendingPlanCode : null, "tf_annual_ars_v1");
      assert.equal(decision.ok && decision.kind === "apply" ? decision.next.status : null, "active", "el estado no cambia");
      assert.equal(decision.ok && decision.kind === "apply" ? decision.change.effectiveAt : null, ar("2026-11-01"), "rige desde el próximo período");
    } else {
      assert.equal(decision.ok, false, status);
    }
  }
  const same = decidePlanChange(snap({ status: "active", ...PAID }), "tf_monthly_ars_v1", NOW);
  assert.deepEqual(same, { ok: true, kind: "noop" });
  const already = decidePlanChange(snap({ status: "active", ...PAID, pendingPlanCode: "tf_annual_ars_v1" }), "tf_annual_ars_v1", NOW);
  assert.deepEqual(already, { ok: true, kind: "noop" });
  const revert = decidePlanChange(snap({ status: "active", ...PAID, pendingPlanCode: "tf_annual_ars_v1" }), "tf_monthly_ars_v1", NOW);
  assert.equal(revert.ok && revert.kind === "apply" ? revert.next.pendingPlanCode : "x", null, "volver al plan vigente descarta el cambio programado");
});

test("plan manipulado: sólo un código del catálogo; cualquier otra cosa se rechaza sin tocar nada", async () => {
  const { store, deps } = setup();
  for (const bad of ["tf_annual_ars_v1; drop table billing_plans", "tf_free_ars_v1", "", null, undefined, { code: "tf_annual_ars_v1" }, 249000, "TF_ANNUAL_ARS_V1"]) {
    const result = await changePlan(deps, OWNER_A, bad);
    assert.equal(result.ok ? null : result.failure, "plan_invalid", String(bad));
  }
  assert.equal(store.calls.includes("commitBatch"), false);
});

test("cambio de plan CONCURRENTE: dos pedidos distintos se serializan y queda UNO solo programado", async () => {
  const { store, deps } = setup();
  assert.deepEqual(await changePlan(deps, OWNER_A, "tf_quarterly_ars_v1"), { ok: true, changed: true });
  assert.deepEqual(await changePlan(deps, OWNER_A, "tf_annual_ars_v1"), { ok: true, changed: true });
  assert.equal(store.subscriptions.get(OWNER_A)?.pendingPlanCode, "tf_annual_ars_v1");
  assert.equal(store.subscriptions.get(OWNER_A)?.planCode, "tf_monthly_ars_v1", "el plan vigente no cambió");
  assert.deepEqual(await changePlan(deps, OWNER_A, "tf_annual_ars_v1"), { ok: true, changed: false }, "repetir no hace nada");
});

test("checkout: el importe y el plan los fija el SERVIDOR; el navegador sólo manda un código del catálogo", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending" }));
  const result = await startCheckout(deps, { ownerId: OWNER_A, planCode: "tf_annual_ars_v1", idempotencyKey: "key-aaaaaaaaaa", returnUrl: "https://teacherflowapp.com/facturacion", customer: CUSTOMER });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempt.amountMinor, 24_900_000);
  assert.equal(result.attempt.currency, "ARS");
  assert.equal(result.attempt.planCode, "tf_annual_ars_v1");
  assert.match(result.redirectUrl, /^https:\/\/fake-provider\.invalid\//);
  assert.equal(provider.calls.createCheckout, 1);
  // VOLVER del proveedor no activa nada: la cuenta sigue pending hasta un cobro verificado y conciliado.
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "pending");
});

test("checkout DUPLICADO y DOS PESTAÑAS: el mismo plan reutiliza el intento; uno solo abierto; otro plan reemplaza al anterior", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending" }));
  const base = { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1" as unknown, returnUrl: "https://teacherflowapp.com/facturacion", customer: CUSTOMER };
  const first = await startCheckout(deps, { ...base, idempotencyKey: "key-tab-one-aaa" });
  const second = await startCheckout(deps, { ...base, idempotencyKey: "key-tab-two-aaa" });
  const doubleClick = await startCheckout(deps, { ...base, idempotencyKey: "key-tab-one-aaa" });
  assert.ok(first.ok && second.ok && doubleClick.ok);
  if (!(first.ok && second.ok && doubleClick.ok)) return;
  assert.equal(first.attempt.id, second.attempt.id);
  assert.equal(first.attempt.id, doubleClick.attempt.id);
  assert.equal([...store.attempts.values()].filter((a) => a.status === "open" || a.status === "completed").length, 1);
  assert.equal(provider.checkouts.size, 1, "un solo suscriptor en el proveedor: siempre se usa la clave del intento original");
  const other = await startCheckout(deps, { ...base, planCode: "tf_annual_ars_v1", idempotencyKey: "key-tab-three-a" });
  assert.equal(other.ok, true);
  assert.equal([...store.attempts.values()].find((a) => a.id === first.attempt.id)?.status, "superseded", "elegir otro plan reemplaza al intento anterior");
  assert.equal([...store.attempts.values()].filter((a) => a.status === "open" || a.status === "completed").length, 1, "siempre un solo intento vivo");
});

test("checkout no se permite con una suscripción en curso (no duplica suscripciones)", async () => {
  for (const status of ["active", "past_due", "grace_period", "limited", "cancel_at_period_end"] as const) {
    const { deps } = setup(coherent(status));
    const result = await startCheckout(deps, { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-abcdefghij", returnUrl: "https://teacherflowapp.com/facturacion", customer: CUSTOMER });
    assert.equal(result.ok ? null : result.failure, "already_subscribed", status);
  }
  for (const status of BILLING_STATUSES) assert.equal(canStartCheckout(coherent(status), NOW), ["grandfathered", "pending", "canceled", "expired"].includes(status), status);
});

test("caída del proveedor al crear el checkout: el intento queda fallido, no se cobra nada y se puede reintentar con la misma clave", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending" }));
  provider.injectFailure("createCheckout", "timeout", 1);
  const input = { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-retry-aaaaa", returnUrl: "https://teacherflowapp.com/facturacion", customer: CUSTOMER };
  const first = await startCheckout(deps, input);
  assert.equal(first.ok ? null : first.failure, "provider_unavailable");
  assert.equal([...store.attempts.values()][0].status, "failed");
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "pending");
});

test("la facturación APAGADA rechaza todo comando sin tocar la base ni el proveedor", async () => {
  const { store, provider, deps } = setup();
  const off: CommandDeps = { ...deps, flags: { enabled: false, enforcement: false } };
  const results = [
    await cancelSubscription(off, OWNER_A),
    await reactivateSubscription(off, OWNER_A),
    await changePlan(off, OWNER_A, "tf_annual_ars_v1"),
    await startCheckout(off, { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-abcdefghij", returnUrl: "https://x", customer: CUSTOMER }),
  ];
  for (const result of results) assert.equal(result.ok ? null : result.failure, "billing_disabled");
  assert.deepEqual(store.calls, []);
  assert.equal(Object.values(provider.calls).reduce((a, b) => a + b, 0), 0);
});

test("caída de Supabase: los cambios de facturación FALLAN CERRADO con un mensaje claro y sin detalles", async () => {
  const { store, deps } = setup();
  store.failWith = new Error('relation "public.billing_subscriptions" does not exist — password=secret');
  const results = [await cancelSubscription(deps, OWNER_A), await changePlan(deps, OWNER_A, "tf_annual_ars_v1"), await startCheckout(deps, { ownerId: OWNER_A, planCode: "tf_monthly_ars_v1", idempotencyKey: "key-abcdefghij", returnUrl: "https://x", customer: CUSTOMER })];
  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.failure, "billing_unavailable");
    for (const leak of ["relation", "billing_subscriptions", "password", "secret"]) assert.equal(result.message.includes(leak), false);
  }
});

test("los mensajes de error son claros, en español y NUNCA muestran códigos internos, secretos, SQL, restricciones ni respuestas del proveedor", () => {
  for (const failure of ALL_BILLING_FAILURES) {
    const message = billingErrorMessage(failure);
    assert.ok(message.length > 20 && message.length < 200, failure);
    assert.match(message, /^[A-ZÁÉÍÓÚ¿¡]/, "empieza como una oración");
    for (const forbidden of [/tf_[a-z]+_ars/i, /billing_/i, /mobbex/i, /supabase/i, /postgres|sql|constraint|violat/i, /[0-9a-f]{8}-[0-9a-f]{4}/i, /\b(null|undefined|NaN)\b/, /https?:\/\//, /_/]) {
      assert.doesNotMatch(message, forbidden, `${failure}: ${message}`);
    }
  }
  assert.equal(ALL_BILLING_FAILURES.length, 9);
});

test("checkout con un plan manipulado (código inventado, precio, objeto, inyección): se rechaza sin tocar la base ni el proveedor", async () => {
  const { store, provider, deps } = setup(snap({ status: "pending" }));
  for (const bad of ["tf_free_ars_v1", "tf_monthly_ars_v1' or '1'='1", "", null, undefined, 24900, { code: "tf_monthly_ars_v1" }, ["tf_monthly_ars_v1"]]) {
    const result = await startCheckout(deps, { ownerId: OWNER_A, planCode: bad, idempotencyKey: "key-bad-plan-aa", returnUrl: "https://teacherflowapp.com/facturacion", customer: CUSTOMER });
    assert.equal(result.ok ? null : result.failure, "plan_invalid", String(bad));
  }
  assert.deepEqual(store.calls, []);
  assert.equal(provider.calls.createCheckout, 0);
});
