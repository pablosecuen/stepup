import { test } from "node:test";
import assert from "node:assert/strict";
import { RPC_JSON_ARGS, RPC_SHAPES, RpcBillingStore, commitBatchToJson, snapshotFromRow, toIso, type RpcCaller, type RpcName } from "../rpc-store.ts";
import { MONTHLY_ROW } from "./rpc-fixtures.ts";
import { OWNER_A, OWNER_B, ar, snap } from "./helpers.ts";

function recorder(respond: (name: RpcName, args: Record<string, unknown>) => unknown): { rpc: RpcCaller; calls: Array<{ name: RpcName; args: Record<string, unknown> }> } {
  const calls: Array<{ name: RpcName; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return respond(name, args);
    },
  };
}

test("las fechas de la base (texto de PostgREST con huso, o Date de pg) se normalizan SIEMPRE al mismo ISO en UTC", () => {
  assert.equal(toIso("2026-10-01T03:00:00+00:00"), "2026-10-01T03:00:00.000Z");
  assert.equal(toIso("2026-10-01T00:00:00-03:00"), "2026-10-01T03:00:00.000Z");
  assert.equal(toIso(new Date("2026-10-01T03:00:00Z")), "2026-10-01T03:00:00.000Z");
  assert.equal(toIso(null), null);
  assert.equal(toIso(undefined), null);
  assert.throws(() => toIso("no es una fecha"), TypeError);
});

test("una fila de la base se convierte en un snapshot validado (bigint como texto incluido); estados y planes desconocidos se rechazan", () => {
  const snapshot = snapshotFromRow({ ...MONTHLY_ROW, version: "7" });
  assert.equal(snapshot.version, 7);
  assert.equal(snapshot.status, "active");
  assert.equal(snapshot.planCode, "tf_monthly_ars_v1");
  assert.equal(snapshot.currentPeriodEnd, "2026-11-01T03:00:00.000Z");
  assert.equal(snapshot.providerSubscriberUid, "SUBR1");
  assert.throws(() => snapshotFromRow({ ...MONTHLY_ROW, status: "paid" }), TypeError);
  assert.equal(snapshotFromRow({ ...MONTHLY_ROW, plan_code: "tf_unknown_ars_v9" }).planCode, null, "un plan fuera del catálogo nunca llega al dominio");
  assert.throws(() => snapshotFromRow({ ...MONTHLY_ROW, owner_id: 5 }), TypeError);
});

test("las lecturas por lotes se parten en tandas de 500 identificadores (nunca una consulta por cuenta)", async () => {
  const ids = Array.from({ length: 1200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const { rpc, calls } = recorder(() => []);
  const store = new RpcBillingStore(rpc);
  await store.loadSubscriptions(ids);
  await store.loadExecutions(ids, 24);
  await store.resolveSubscribers({ references: ids.map((id) => `tfs_${id.replace(/-/g, "").slice(0, 32)}`), uids: [] });
  assert.deepEqual(calls.map((call) => [call.name, (call.args.p_owner_ids ?? call.args.p_refs) instanceof Array ? ((call.args.p_owner_ids ?? call.args.p_refs) as unknown[]).length : -1]), [
    ["billing_get_subscriptions", 500], ["billing_get_subscriptions", 500], ["billing_get_subscriptions", 200],
    ["billing_owner_executions", 500], ["billing_owner_executions", 500], ["billing_owner_executions", 200],
    ["billing_resolve_subscribers", 500], ["billing_resolve_subscribers", 500], ["billing_resolve_subscribers", 200],
  ]);
});

test("la recepción de avisos se parte en tandas de 200 y suma lo insertado y lo descartado", async () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({ dedupKey: String(i).padStart(64, "0"), provider: "fake" as const, eventType: "other" as const, payloadHash: "a".repeat(64), hint: { providerPaymentId: null, executionUid: null, subscriberUid: "S", subscriberReference: null }, receivedAt: "2026-10-13T00:00:00.000Z" }));
  const { rpc, calls } = recorder((_, args) => ({ inserted: (args.p_rows as unknown[]).length - 1, duplicates: 1 }));
  const result = await new RpcBillingStore(rpc).ingestEvents(rows);
  assert.deepEqual(calls.map((call) => (call.args.p_rows as unknown[]).length), [200, 200, 50]);
  assert.deepEqual(result, { inserted: 447, duplicates: 3 });
  const sent = (calls[0].args.p_rows as Array<Record<string, unknown>>)[0];
  assert.deepEqual(Object.keys(sent).sort(), ["dedup_key", "event_type", "normalized", "payload_hash", "provider", "received_at"]);
});

test("el lote de escritura lleva SÓLO campos normalizados y la versión esperada de cada cuenta", () => {
  const json = commitBatchToJson({
    executions: [{ ownerId: OWNER_A, provider: "fake", executionUid: "e1", providerPaymentId: "p1", outcome: "approved", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, currency: "ARS", dueAt: ar("2026-10-01"), occurredAt: ar("2026-10-01", 1) }],
    periods: [{ ownerId: OWNER_A, provider: "fake", executionUid: "e1", planCode: "tf_monthly_ars_v1", priceVersion: 1, amountMinor: 2_490_000, currency: "ARS", periodStart: ar("2026-10-01"), periodEnd: ar("2026-11-01") }],
    subscriptions: [{ snapshot: snap({ ownerId: OWNER_A, status: "active", planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), version: 4 }), expectedVersion: 4, nextCheckAt: ar("2026-11-01") }],
    reconciliations: [{ kind: "unknown_reference", ownerId: null, dedupeKey: "k", detail: { providerPaymentId: "p" } }],
    events: [{ id: 9, ownerId: OWNER_A, status: "processed", result: "fact", retryDelaySeconds: 0 }],
    changes: [{ ownerId: OWNER_B, kind: "cancel", fromPlanCode: "tf_monthly_ars_v1", toPlanCode: null, effectiveAt: null, idempotencyKey: "cancel:4:-" }],
  });
  assert.deepEqual(Object.keys(json).sort(), ["changes", "events", "executions", "periods", "reconciliations", "subscriptions", "voided_periods"]);
  const sub = (json.subscriptions as Array<Record<string, unknown>>)[0];
  assert.equal(sub.expected_version, 4);
  assert.equal(sub.next_check_at, ar("2026-11-01"));
  assert.ok(!("provider_reference" in sub) && !("provider_subscriber_uid" in sub), "la referencia del proveedor es inmutable: no viaja en una escritura");
  const text = JSON.stringify(json);
  for (const forbidden of ["email", "customer", "identification", "token", "secret", "password", "rawBody"]) assert.equal(text.includes(forbidden), false, forbidden);
});

test("el cursor de la página de vencimientos sólo existe si la página vino llena", async () => {
  const row = (n: number) => ({ ...MONTHLY_ROW, owner_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, next_check_at: "2026-11-01T03:00:00+00:00" });
  const full = new RpcBillingStore(recorder(() => [row(1), row(2)]).rpc);
  const page = await full.dueSubscriptions({ nowIso: "2026-11-02T00:00:00.000Z", after: null, limit: 2 });
  assert.equal(page.snapshots.length, 2);
  assert.deepEqual(page.nextCursor, { at: "2026-11-01T03:00:00.000Z", ownerId: "00000000-0000-4000-8000-000000000002" });
  const partial = new RpcBillingStore(recorder(() => [row(1)]).rpc);
  assert.equal((await partial.dueSubscriptions({ nowIso: "2026-11-02T00:00:00.000Z", after: null, limit: 2 })).nextCursor, null);
});

test("un resultado inesperado de la base (no es arreglo, estado desconocido) falla en lugar de interpretarse", async () => {
  await assert.rejects(new RpcBillingStore(recorder(() => ({ not: "an array" })).rpc).loadSubscriptions([OWNER_A]), TypeError);
  await assert.rejects(new RpcBillingStore(recorder(() => [{ ...MONTHLY_ROW, status: "weird" }]).rpc).loadSubscriptions([OWNER_A]), TypeError);
  const open = await new RpcBillingStore(recorder(() => ({ ok: false, reason: "algo raro" })).rpc).openCheckoutAttempt({ ownerId: OWNER_A, plan: (await import("../plans.ts")).getPlan("tf_monthly_ars_v1")!, provider: "fake", idempotencyKey: "k".repeat(10), expiresAt: "2026-10-13T00:00:00.000Z" });
  assert.deepEqual(open, { ok: false, reason: "no_account" }, "un motivo desconocido nunca se trata como éxito");
});

test("todas las funciones SQL tienen forma declarada y sólo p / p_rows / p_items viajan como JSON", () => {
  assert.equal(Object.keys(RPC_SHAPES).length, 20);
  assert.deepEqual([...RPC_JSON_ARGS].sort(), ["p", "p_items", "p_rows"]);
});
