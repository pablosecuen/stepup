import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileOperation, type ReconcileContext, type SubscriberRecord } from "../reconcile.ts";
import type { ProviderOperation } from "../provider.ts";
import { OWNER_A, OWNER_B, ar } from "./helpers.ts";

const REF_A = "tfs_" + "a".repeat(32);
const REF_B = "tfs_" + "b".repeat(32);

const recordA: SubscriberRecord = { ownerId: OWNER_A, subscriberReference: REF_A, subscriberUid: "sub_a", acceptablePlans: ["tf_monthly_ars_v1"] };
const recordB: SubscriberRecord = { ownerId: OWNER_B, subscriberReference: REF_B, subscriberUid: "sub_b", acceptablePlans: ["tf_annual_ars_v1"] };

function operation(overrides: Partial<ProviderOperation> = {}): ProviderOperation {
  return {
    providerPaymentId: "pay_1",
    executionUid: "exe_1",
    subscriberUid: "sub_a",
    subscriberReference: REF_A,
    planReference: "tf_monthly_ars_v1",
    outcome: "approved",
    statusCode: "200",
    amountMinor: 2_490_000,
    currency: "ARS",
    dueAt: ar("2026-10-01", 10),
    occurredAt: ar("2026-10-01", 10, 5),
    livemode: true,
    ...overrides,
  };
}

function context(overrides: Partial<ReconcileContext> = {}): ReconcileContext {
  return { hintedReference: REF_A, hintedExecutionUid: "exe_1", records: new Map([[REF_A, recordA], [REF_B, recordB]]), expectLive: true, ...overrides };
}

test("una operación aprobada, con importe, moneda y plan correctos de la cuenta que la pidió, se convierte en un hecho", () => {
  const result = reconcileOperation(operation(), context());
  assert.equal(result.kind, "fact");
  if (result.kind !== "fact") return;
  assert.equal(result.ownerId, OWNER_A);
  assert.deepEqual(result.fact, { executionId: "exe_1", outcome: "approved", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar("2026-10-01", 10), occurredAt: ar("2026-10-01", 10, 5) });
});

test("el importe, la moneda y el plan del hecho salen del CATÁLOGO del servidor, no del aviso", () => {
  const result = reconcileOperation(operation({ amountMinor: 2_490_000 }), context());
  assert.equal(result.kind === "fact" ? result.fact.amountMinor : null, 2_490_000);
});

test("importe manipulado (aunque sea por un centavo), moneda distinta de ARS o plan manipulado: anomalía y NADA cambia", () => {
  const cases: Array<[Partial<ProviderOperation>, string]> = [
    [{ amountMinor: 2_489_999 }, "amount_mismatch"],
    [{ amountMinor: 24_900_000 }, "amount_mismatch"], // el importe de OTRO plan
    [{ amountMinor: null }, "amount_mismatch"],
    [{ currency: "USD" }, "currency_mismatch"],
    [{ currency: "TEST" }, "currency_mismatch"], // el aviso dice «real» pero la moneda es de prueba: no cierra
    [{ currency: null }, "currency_mismatch"],
    [{ planReference: "tf_free_ars_v1" }, "unknown_plan"],
    [{ planReference: null }, "unknown_plan"],
    [{ planReference: "tf_annual_ars_v1", amountMinor: 24_900_000 }, "plan_not_expected"], // plan válido pero que esta cuenta no tiene ni pidió
  ];
  for (const [overrides, expected] of cases) {
    const result = reconcileOperation(operation(overrides), context());
    assert.equal(result.kind, "anomaly", JSON.stringify(overrides));
    assert.equal(result.kind === "anomaly" ? result.anomaly : null, expected, JSON.stringify(overrides));
  }
});

test("owner_id ajeno: la propietaria sale de NUESTRA referencia; un aviso que mezcla referencias o suscriptores ajenos se rechaza", () => {
  // La operación pertenece al suscriptor de B, pero el aviso dice que es de A.
  const crossed = reconcileOperation(operation({ subscriberReference: REF_B, subscriberUid: "sub_b" }), context());
  assert.equal(crossed.kind === "anomaly" ? crossed.anomaly : null, "owner_mismatch");
  // La referencia es de A pero el suscriptor del proveedor es el de B.
  const wrongUid = reconcileOperation(operation({ subscriberUid: "sub_b" }), context());
  assert.equal(wrongUid.kind === "anomaly" ? wrongUid.anomaly : null, "subscriber_mismatch");
  // Un cobro de B con el plan de B se acredita a B, nunca a A.
  const forB = reconcileOperation(operation({ subscriberReference: REF_B, subscriberUid: "sub_b", planReference: "tf_annual_ars_v1", amountMinor: 24_900_000, executionUid: "exe_b" }), context({ hintedReference: REF_B, hintedExecutionUid: "exe_b" }));
  assert.equal(forB.kind === "fact" ? forB.ownerId : null, OWNER_B);
  // Una referencia desconocida jamás se atribuye a nadie.
  const unknown = reconcileOperation(operation({ subscriberReference: "tfs_" + "c".repeat(32) }), context({ hintedReference: "tfs_" + "c".repeat(32) }));
  assert.deepEqual(unknown, { kind: "anomaly", anomaly: "unknown_reference", ownerId: null, dedupeKey: "unknown_reference:pay_1" });
  assert.equal(reconcileOperation(operation({ subscriberReference: null }), context({ hintedReference: null })).kind, "anomaly");
});

test("ejecución ausente o que no coincide con la del aviso: anomalía", () => {
  assert.equal((reconcileOperation(operation({ executionUid: null }), context({ hintedExecutionUid: null })) as { anomaly?: string }).anomaly, "missing_execution");
  assert.equal((reconcileOperation(operation({ executionUid: "exe_x" }), context({ hintedExecutionUid: "exe_1" })) as { anomaly?: string }).anomaly, "missing_execution");
  assert.equal((reconcileOperation(operation({ dueAt: null }), context()) as { anomaly?: string }).anomaly, "missing_due_date");
});

test("estados no finales o desconocidos no cambian nada; un reembolso queda para revisión y nunca revoca por su cuenta", () => {
  assert.deepEqual(reconcileOperation(operation({ outcome: "pending", statusCode: "2" }), context()), { kind: "ignore", reason: "non_final_status" });
  assert.deepEqual(reconcileOperation(operation({ outcome: "other", statusCode: "603" }), context()), { kind: "ignore", reason: "unsupported_status" });
  const refund = reconcileOperation(operation({ outcome: "refunded", statusCode: "602" }), context());
  assert.equal(refund.kind === "anomaly" ? refund.anomaly : null, "refund_review");
});

test("una operación de prueba (moneda TEST) nunca activa nada cuando se esperan operaciones reales", () => {
  assert.deepEqual(reconcileOperation(operation({ livemode: false, currency: "TEST" }), context()), { kind: "ignore", reason: "test_operation" });
  assert.equal(reconcileOperation(operation({ livemode: false, currency: "ARS" }), context()).kind, "ignore");
});

test("un rechazo del cobro también se concilia (y se valida igual) para fijar la gracia", () => {
  const rejected = reconcileOperation(operation({ outcome: "rejected", statusCode: "410" }), context());
  assert.equal(rejected.kind === "fact" ? rejected.fact.outcome : null, "rejected");
  assert.equal(reconcileOperation(operation({ outcome: "rejected", statusCode: "410", amountMinor: 1 }), context()).kind, "anomaly");
});
