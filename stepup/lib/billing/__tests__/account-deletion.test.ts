import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareAccountDeletion } from "../account-deletion.ts";
import { FakeProviderAdapter } from "../providers/fake.ts";
import { MemoryStore } from "./memory-store.ts";
import { OWNER_A, ar, snap } from "./helpers.ts";
import type { CommandDeps } from "../commands.ts";

const NOW = new Date(Date.parse(ar("2026-10-15", 12)));
const PAID = { planCode: "tf_monthly_ars_v1", providerPlanCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), providerSubscriberUid: "SUB1" } as const;

function setup(overrides: Parameters<typeof snap>[0] = { status: "active", ...PAID }, enabled = true) {
  const store = new MemoryStore();
  store.seed(snap(overrides));
  const provider = new FakeProviderAdapter();
  provider.seedSubscriber("SUB1", { status: "active" });
  const deps: CommandDeps = { store, provider, flags: { enabled, enforcement: false }, now: () => NOW };
  return { store, provider, deps };
}

test("con la facturación apagada ni siquiera se consulta: el flujo de eliminación es el de siempre", async () => {
  const { store, provider, deps } = setup(undefined, false);
  assert.deepEqual(await prepareAccountDeletion(deps, OWNER_A), { ok: true });
  assert.deepEqual(store.calls, []);
  assert.equal(provider.calls.cancelSubscriber + provider.calls.getSubscriber, 0);
});

test("sin suscriptor en el proveedor (nunca se suscribió, grandfathered) no hay nada que cancelar", async () => {
  const { provider, deps } = setup({ status: "grandfathered", grandfathered: true });
  assert.deepEqual(await prepareAccountDeletion(deps, OWNER_A), { ok: true });
  assert.equal(provider.calls.cancelSubscriber, 0);
});

test("con suscripción activa: se cancela primero en el proveedor, se CONFIRMA con una consulta autenticada y recién después se autoriza el borrado; la cancelación queda registrada en la base", async () => {
  const { store, provider, deps } = setup();
  assert.deepEqual(await prepareAccountDeletion(deps, OWNER_A), { ok: true });
  assert.ok(provider.canceled.has("SUB1"));
  assert.equal(provider.subscribers.get("SUB1")?.status, "suspended");
  assert.ok(provider.calls.getSubscriber >= 1, "se confirmó con una consulta");
  assert.equal(store.subscriptions.get(OWNER_A)?.status, "cancel_at_period_end");
  assert.equal(store.changes.filter((change) => change.kind === "cancel").length, 1);
});

test("si el proveedor no responde o rechaza la cancelación, el borrado queda BLOQUEADO y nada cambia en la base", async () => {
  for (const kind of ["unavailable", "timeout", "rejected"] as const) {
    const { store, provider, deps } = setup();
    provider.injectFailure("cancelSubscriber", kind, 10);
    const result = await prepareAccountDeletion(deps, OWNER_A);
    assert.equal(result.ok, false, kind);
    assert.equal(store.subscriptions.get(OWNER_A)?.status, "active", `${kind}: la base no cambió`);
    assert.equal(store.changes.length, 0);
  }
});

test("si NO se puede confirmar (estado ilegible, consulta caída) el borrado se bloquea; sólo «suspendido» o «terminado» lo autorizan", async () => {
  const unreadable = setup();
  unreadable.provider.subscribers.get("SUB1")!.status = "unknown";
  const first = await prepareAccountDeletion(unreadable.deps, OWNER_A);
  assert.equal(first.ok, false);
  assert.equal(first.ok ? "" : first.failure, "deletion_unconfirmed");
  const down = setup();
  down.provider.injectFailure("getSubscriber", "unavailable", 10);
  assert.equal((await prepareAccountDeletion(down.deps, OWNER_A)).ok, false);
  const finished = setup();
  finished.provider.subscribers.get("SUB1")!.status = "finished";
  assert.deepEqual(await prepareAccountDeletion(finished.deps, OWNER_A), { ok: true });
});

test("si el proveedor sigue «activo» tras cancelar se vuelve a cancelar UNA vez y se vuelve a consultar; si persiste, no se elimina", async () => {
  const { provider, deps } = setup();
  const original = provider.cancelSubscriber.bind(provider);
  let calls = 0;
  provider.cancelSubscriber = async (input) => {
    calls += 1;
    if (calls === 1) return { ok: true, data: { canceled: true } }; // dice que sí pero no cambia nada (respuesta engañosa)
    return original(input);
  };
  assert.deepEqual(await prepareAccountDeletion(deps, OWNER_A), { ok: true });
  assert.ok(calls >= 2);
  const stubborn = setup();
  stubborn.provider.cancelSubscriber = async () => ({ ok: true, data: { canceled: true } });
  assert.equal((await prepareAccountDeletion(stubborn.deps, OWNER_A)).ok, false, "nunca se elimina una cuenta que podría seguir cobrándose");
});

test("hay suscriptor pero se ignora su plan en el proveedor: no se puede confirmar, así que no se elimina", async () => {
  const { deps } = setup({ status: "pending", providerSubscriberUid: "SUB1", providerPlanCode: null, planCode: null });
  assert.equal((await prepareAccountDeletion(deps, OWNER_A)).ok, false);
});

test("sin poder leer la suscripción (base caída) tampoco se elimina", async () => {
  const { store, deps } = setup();
  store.failWith = new Error("db down");
  const result = await prepareAccountDeletion(deps, OWNER_A);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.failure, "billing_unavailable");
});

test("una cuenta que no se puede cancelar por su estado local (p. ej. grandfathered con un suscriptor sin plan registrado) no se elimina sin confirmar: sin plan no hay confirmación posible", async () => {
  const { provider, deps } = setup({ status: "grandfathered", grandfathered: true, providerSubscriberUid: "SUB1", providerPlanCode: null, planCode: null });
  const result = await prepareAccountDeletion(deps, OWNER_A);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.failure, "deletion_unconfirmed");
  assert.equal(provider.calls.getSubscriber, 0, "no se consultó con un plan inventado");
});

test("una falla transitoria al cancelar BLOQUEA el borrado aunque una consulta posterior pudiera confirmar: se reintenta, no se improvisa", async () => {
  const { provider, deps } = setup();
  provider.injectFailure("cancelSubscriber", "unavailable", 1);
  const result = await prepareAccountDeletion(deps, OWNER_A);
  assert.equal(result.ok, false);
  assert.equal(provider.calls.getSubscriber, 0, "ni siquiera se llegó a confirmar");
  // Reintentando sin falla, se elimina.
  assert.deepEqual(await prepareAccountDeletion(deps, OWNER_A), { ok: true });
});
