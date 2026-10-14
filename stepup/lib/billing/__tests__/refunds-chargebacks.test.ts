import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFields, finalOutcomes, reduceSnapshot, projectStatus, type ExecutionFact } from "../ledger.ts";
import { resolveBillingAccess } from "../access.ts";
import { reconcileOperation, type ReconcileContext, type SubscriberRecord } from "../reconcile.ts";
import { mapStatusCode } from "../providers/mobbex-normalize.ts";
import type { ProviderOperation } from "../provider.ts";
import { OWNER_A, approved, ar, snap } from "./helpers.ts";

const at = (date: string, hour = 0) => new Date(Date.parse(ar(date, hour)));
const ON = { enabled: true, enforcement: true } as const;

/** Un cobro que el proveedor informó después como devuelto (total) o contracargado: mismo identificador de ejecución, resultado posterior. */
function later(base: ExecutionFact, outcome: "refunded" | "chargeback", date: string, hour = 12): ExecutionFact {
  return { ...base, outcome, occurredAt: ar(date, hour) };
}

const E1 = approved("e1", "2026-10-01");
const E2 = approved("e2", "2026-11-01");
const ACTIVE_OCT = snap({ status: "active", planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") });

test("devolución TOTAL del único período pagado: no extiende nada y la cuenta queda sin período (pending), con acceso limitado", () => {
  const result = reduceSnapshot(ACTIVE_OCT, [E1, later(E1, "refunded", "2026-10-10")], at("2026-10-12"));
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.next.status, "pending");
  assert.equal(result.next.currentPeriodEnd, null);
  assert.equal(result.changed, true);
  const access = resolveBillingAccess({ flags: ON, snapshot: result.next, now: at("2026-10-12") });
  assert.equal(access.level, "limited");
  assert.equal(access.capabilities.createOperationalData, false);
  assert.equal(access.capabilities.exportData, true, "nunca se borran ni se ocultan los datos");
});

test("devolución total de una renovación: el período devuelto no cuenta y el acceso termina al confirmarse la devolución (sin gracia)", () => {
  const paid2 = snap({ ...ACTIVE_OCT, currentPeriodStart: ar("2026-11-01"), currentPeriodEnd: ar("2026-12-01"), graceEndsAt: ar("2026-12-07"), version: 2 });
  const facts = [E1, E2, later(E2, "refunded", "2026-11-03")];
  // Antes de la devolución (3/11 a las 11:59) la cuenta todavía tenía el período que ya pagó… pero el cálculo se hace con TODOS los hechos conocidos.
  const derived = deriveFields(facts);
  assert.equal(derived.currentPeriodEnd, ar("2026-11-01"), "sólo cuenta el período 1");
  assert.equal(derived.graceEndsAt, ar("2026-11-03", 12), "la gracia termina cuando se confirmó la devolución, no cinco días después");
  assert.equal(reduceSnapshot(paid2, facts, at("2026-11-03", 11)).next.status, "past_due");
  assert.equal(reduceSnapshot(paid2, facts, at("2026-11-03", 13)).next.status, "limited");
  assert.equal(reduceSnapshot(paid2, facts, at("2026-11-20")).next.status, "limited");
});

test("una devolución confirmada DESPUÉS de la gracia normal no la alarga", () => {
  const derived = deriveFields([E1, E2, later(E2, "refunded", "2026-11-20")]);
  assert.equal(derived.graceEndsAt, ar("2026-11-07"));
});

test("devolución de un cobro viejo (ya hay un período posterior pagado): no cambia el acceso actual", () => {
  const facts = [E1, E2, later(E1, "refunded", "2026-11-10")];
  const derived = deriveFields(facts);
  assert.equal(derived.currentPeriodEnd, ar("2026-12-01"));
  assert.equal(derived.chargebackAt, null);
});

test("CONTRACARGO conciliado: modo limitado inmediato aunque quede período pagado por delante", () => {
  const snapshot = snap({ ...ACTIVE_OCT, currentPeriodStart: ar("2026-11-01"), currentPeriodEnd: ar("2026-12-01"), graceEndsAt: ar("2026-12-07") });
  const facts = [E1, E2, later(E1, "chargeback", "2026-11-10")];
  assert.equal(projectStatus({ ...snapshot, chargebackAt: null }, at("2026-11-15")), "active", "sin el contracargo seguiría activa");
  const result = reduceSnapshot(snapshot, facts, at("2026-11-15"));
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.next.status, "limited");
  assert.equal(result.next.chargebackAt, ar("2026-11-10", 12));
  assert.equal(result.next.currentPeriodEnd, ar("2026-12-01"), "no se borra ni se acorta lo que sigue pagado: sólo se limita el acceso");
  // Hasta el instante en que se confirmó el contracargo la cuenta no está limitada (el reloj manda sobre el instante del hecho).
  assert.equal(reduceSnapshot(snapshot, facts, at("2026-11-09")).next.status, "active");
  assert.equal(projectStatus({ ...snapshot, chargebackAt: ar("2026-11-10", 12) }, at("2026-11-09")), "active");
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: result.next, now: at("2026-11-15") }).reason, "subscription_unpaid");
});

test("contracargo: un cobro aprobado POSTERIOR lo supera (la persona volvió a pagar) y la cuenta vuelve a activa", () => {
  const snapshot = snap({ ...ACTIVE_OCT, currentPeriodStart: ar("2026-11-01"), currentPeriodEnd: ar("2026-12-01"), graceEndsAt: ar("2026-12-07"), chargebackAt: ar("2026-11-10", 12), status: "limited" });
  const e3 = approved("e3", "2026-11-20");
  const facts = [E1, E2, later(E1, "chargeback", "2026-11-10"), e3];
  const result = reduceSnapshot(snapshot, facts, at("2026-11-21"));
  assert.equal(result.next.chargebackAt, null);
  assert.equal(result.next.status, "active");
});

test("el contracargo no cambia a una cuenta ya cancelada o vencida (no inventa un estado)", () => {
  assert.equal(projectStatus({ grandfathered: false, currentPeriodEnd: ar("2026-10-01"), renewalRejectedDueAt: null, graceEndsAt: ar("2026-10-07"), cancelRequestedAt: ar("2026-09-20"), providerEndedAt: null, chargebackAt: ar("2026-10-02") }, at("2026-10-20")), "canceled");
});

test("cuenta que canceló y recibe un contracargo: pasa a limitada de inmediato (sin esperar al fin del período)", () => {
  const snapshot = snap({ ...ACTIVE_OCT, status: "cancel_at_period_end", cancelRequestedAt: ar("2026-10-10") });
  const result = reduceSnapshot(snapshot, [E1, later(E1, "chargeback", "2026-10-15")], at("2026-10-16"));
  assert.equal(result.anomalies.length, 0);
  assert.notEqual(result.next.status, "active");
});

test("ORDEN: devoluciones y contracargos llegan en cualquier orden y el resultado es el mismo (todas las permutaciones)", () => {
  const facts = [E1, E2, later(E1, "refunded", "2026-10-05"), approved("e3", "2026-12-01"), later(E2, "chargeback", "2026-11-12")];
  const reference = deriveFields(facts);
  const permute = (items: ExecutionFact[]): ExecutionFact[][] => (items.length <= 1 ? [items] : items.flatMap((item, index) => permute([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])));
  for (const order of permute(facts)) assert.deepEqual(deriveFields(order), reference);
});

test("IDEMPOTENCIA: repetir los mismos hechos (con devolución y contracargo) no cambia el resultado", () => {
  const facts = [E1, later(E1, "refunded", "2026-10-10"), later(E1, "refunded", "2026-10-10"), E1];
  const once = reduceSnapshot(ACTIVE_OCT, facts, at("2026-10-12"));
  const twice = reduceSnapshot(once.next, [...facts, ...facts], at("2026-10-12"));
  assert.deepEqual(twice.next, once.next);
  assert.equal(twice.changed, false);
});

test("a igual instante gana la devolución sobre el cobro, y el cobro sobre el rechazo; un resultado más viejo nunca pisa a uno más nuevo", () => {
  const same = ar("2026-10-10", 12);
  const refunded = { ...E1, outcome: "refunded" as const, occurredAt: same };
  const approvedSame = { ...E1, occurredAt: same };
  const rejectedSame = { ...E1, outcome: "rejected" as const, occurredAt: same };
  const chargeback = { ...E1, outcome: "chargeback" as const, occurredAt: same };
  assert.equal(finalOutcomes([approvedSame, refunded])[0].outcome, "refunded");
  assert.equal(finalOutcomes([refunded, approvedSame])[0].outcome, "refunded");
  assert.equal(finalOutcomes([rejectedSame, approvedSame])[0].outcome, "approved");
  assert.equal(finalOutcomes([refunded, chargeback])[0].outcome, "chargeback");
  const older = { ...E1, outcome: "refunded" as const, occurredAt: ar("2026-10-02") };
  assert.equal(finalOutcomes([{ ...E1, occurredAt: ar("2026-10-03") }, older])[0].outcome, "approved");
});

// --- Conciliación de la operación consultada ------------------------------------------------------------------------------------

const REF = "tfs_" + "a".repeat(32);
const record: SubscriberRecord = { ownerId: OWNER_A, subscriberReference: REF, subscriberUid: "sub_a", acceptablePlans: ["tf_annual_ars_v1"] };

function operation(overrides: Partial<ProviderOperation> = {}): ProviderOperation {
  return {
    providerPaymentId: "pay_1",
    executionUid: "exe_1",
    subscriberUid: "sub_a",
    subscriberReference: REF,
    planReference: "tf_monthly_ars_v1",
    outcome: "refunded",
    statusCode: "602",
    refundScope: "full",
    amountMinor: 2_490_000,
    currency: "ARS",
    dueAt: ar("2026-10-01", 10),
    occurredAt: ar("2026-10-10", 10),
    livemode: true,
    ...overrides,
  };
}

const context = (overrides: Partial<ReconcileContext> = {}): ReconcileContext => ({ hintedReference: REF, hintedExecutionUid: "exe_1", records: new Map([[REF, record]]), expectLive: true, ...overrides });

test("reembolso TOTAL confirmado por la consulta autenticada: se convierte en un hecho auditado, aunque el plan ya no sea el vigente", () => {
  const result = reconcileOperation(operation(), context());
  assert.equal(result.kind, "fact");
  if (result.kind !== "fact") return;
  assert.equal(result.fact.outcome, "refunded");
  assert.equal(result.audit, "refund_applied");
  assert.equal(result.ownerId, OWNER_A);
});

test("reembolso PARCIAL o AMBIGUO: revisión manual, nunca un hecho (el estado no cambia solo)", () => {
  for (const refundScope of ["partial", "unknown", null] as const) {
    const result = reconcileOperation(operation({ refundScope }), context());
    assert.equal(result.kind, "anomaly", String(refundScope));
    assert.equal(result.kind === "anomaly" ? result.anomaly : null, "refund_review");
  }
});

test("un reembolso con importe o moneda que no cierran con el catálogo se rechaza igual que un cobro", () => {
  assert.equal((reconcileOperation(operation({ amountMinor: 1 }), context()) as { anomaly?: string }).anomaly, "amount_mismatch");
  assert.equal((reconcileOperation(operation({ currency: "USD" }), context()) as { anomaly?: string }).anomaly, "currency_mismatch");
  assert.equal((reconcileOperation(operation({ planReference: "tf_otro_v9" }), context()) as { anomaly?: string }).anomaly, "unknown_plan");
});

test("un reembolso o contracargo de otra propietaria o de una referencia desconocida nunca se atribuye a nadie", () => {
  assert.equal((reconcileOperation(operation({ subscriberReference: "tfs_" + "b".repeat(32) }), context()) as { anomaly?: string }).anomaly, "owner_mismatch");
  const unknown = reconcileOperation(operation({ subscriberReference: "tfs_" + "c".repeat(32) }), context({ hintedReference: "tfs_" + "c".repeat(32) }));
  assert.equal(unknown.kind === "anomaly" ? unknown.anomaly : null, "unknown_reference");
});

test("contracargo informado por el adaptador: hecho con auditoría de revisión; el plan vigente no se exige", () => {
  const result = reconcileOperation(operation({ outcome: "chargeback", statusCode: "cb", refundScope: null }), context());
  assert.equal(result.kind, "fact");
  if (result.kind !== "fact") return;
  assert.equal(result.fact.outcome, "chargeback");
  assert.equal(result.audit, "chargeback_review");
});

test("un cobro aprobado sigue exigiendo que el plan sea uno de los que la cuenta puede cobrar (no se relajó nada)", () => {
  const result = reconcileOperation(operation({ outcome: "approved", statusCode: "200", refundScope: null }), context());
  assert.equal(result.kind === "anomaly" ? result.anomaly : null, "plan_not_expected");
});

test("tabla de Mobbex: «602 Devuelta» es total, «605 Parcialmente devuelta» parcial, «601/610 Cancelada» sin alcance, y NO existe un código de contracargo", () => {
  assert.deepEqual(mapStatusCode("602"), { outcome: "refunded", refundScope: "full" });
  assert.deepEqual(mapStatusCode("605"), { outcome: "refunded", refundScope: "partial" });
  assert.deepEqual(mapStatusCode("601"), { outcome: "refunded", refundScope: "unknown" });
  assert.deepEqual(mapStatusCode("610"), { outcome: "refunded", refundScope: "unknown" });
  assert.equal(mapStatusCode("600").outcome, "pending", "cancelación en proceso: todavía no es final");
  for (let code = 0; code < 1000; code += 1) assert.notEqual(mapStatusCode(String(code)).outcome, "chargeback", String(code));
});
