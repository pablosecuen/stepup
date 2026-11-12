import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileOperation, type SubscriberRecord } from "../reconcile.ts";
import type { ProviderOperation } from "../provider.ts";
import { buildBillingView } from "../view.ts";
import { DEMO_NOW, DEMO_SCENARIOS } from "../demo-scenarios.ts";
import { parseEmailOnlyCustomer } from "../customer.ts";
import { safeProviderRedirect } from "../redirect.ts";
import { PLAN_INTENT_COOKIE, parsePlanIntent, planIntentDestination } from "../../plan-intent.ts";
import { CURRENT_PLAN_CODES } from "../plans.ts";

const REF = `tfs_${"b".repeat(32)}`;
const RECORD: SubscriberRecord = { ownerId: "00000000-0000-4000-8000-000000000001", subscriberReference: REF, subscriberUid: null, acceptablePlans: ["tf_annual_ars_v2"] };
const CONTEXT = { hintedReference: REF, hintedExecutionUid: null, records: new Map([[REF, RECORD]]), expectLive: false, allowRebind: true } as const;
const OPERATION: ProviderOperation = {
  providerPaymentId: "test_pay_1",
  executionUid: "test_pay_1",
  subscriberUid: null,
  subscriberReference: REF,
  planReference: null,
  outcome: "approved",
  statusCode: "approved",
  refundScope: null,
  amountMinor: 23_880_000,
  currency: "ARS",
  dueAt: "2026-11-12T12:00:00.000Z",
  occurredAt: "2026-11-12T12:00:05.000Z",
  livemode: false,
};

test("un primer cobro SIN suscripción todavía se asigna a su plan por el importe sólo si trae nuestra referencia y coincide con exactamente un plan de la cuenta", () => {
  const fact = reconcileOperation(OPERATION, CONTEXT);
  assert.equal(fact.kind, "fact");
  if (fact.kind === "fact") {
    assert.equal(fact.fact.planCode, "tf_annual_ars_v2");
    assert.equal(fact.fact.amountMinor, 23_880_000);
  }
  // Sin nuestra referencia en el pago no se infiere nada.
  const noRef = reconcileOperation({ ...OPERATION, subscriberReference: null }, CONTEXT);
  assert.equal(noRef.kind, "anomaly", "sin nuestra referencia en el pago no se infiere el plan");
  // Un importe que no es el de ningún plan aceptable es una anomalía, no un cobro.
  const wrongAmount = reconcileOperation({ ...OPERATION, amountMinor: 2_590_000 }, CONTEXT);
  assert.equal(wrongAmount.kind, "anomaly");
  // Un proveedor que no crea el suscriptor con el primer cobro (sin `allowRebind`) nunca infiere: el plan debe venir de la operación.
  const strict = reconcileOperation(OPERATION, { ...CONTEXT, allowRebind: false });
  assert.equal(strict.kind, "anomaly");
  // Ambigüedad: dos planes aceptables con el mismo importe → no se adivina.
  const ambiguous = reconcileOperation(OPERATION, { ...CONTEXT, records: new Map([[REF, { ...RECORD, acceptablePlans: ["tf_annual_ars_v2", "tf_annual_ars_v1"] }]]) });
  assert.equal(ambiguous.kind === "fact" ? ambiguous.fact.planCode : "anomalía", "tf_annual_ars_v2", "el v1 tiene otro importe: sigue habiendo una sola coincidencia");
  // Un pago pendiente nunca es un cobro.
  assert.deepEqual(reconcileOperation({ ...OPERATION, outcome: "pending" }, CONTEXT), { kind: "ignore", reason: "non_final_status" });
  // En producción una operación de prueba se ignora.
  assert.deepEqual(reconcileOperation(OPERATION, { ...CONTEXT, expectLive: true }), { kind: "ignore", reason: "test_operation" });
});

test("la vista dice con texto que el pago fue rechazado sólo si no hay suscriptor y el rechazo es reciente (24 h); con suscriptor o un rechazo viejo no cambia", () => {
  const rejected = DEMO_SCENARIOS.rejected;
  const capabilities = { changePlan: false, paymentMethodUpdate: false };
  const view = buildBillingView({ snapshot: rejected.snapshot, history: rejected.history, now: DEMO_NOW, capabilities, available: true });
  assert.equal(view.state, "payment_rejected");
  assert.match(view.badge.label, /rechazado/i);
  assert.match(view.headline, /No se aprobó tu pago/);
  assert.equal(view.actions.subscribe, true);
  assert.equal(view.actions.cancel, false);
  const old = buildBillingView({ snapshot: rejected.snapshot, history: rejected.history, now: new Date(DEMO_NOW.getTime() + 3 * 24 * 3_600_000), capabilities, available: true });
  assert.equal(old.state, "none", "un rechazo de hace días ya no se muestra como el estado de la contratación");
  const withSubscriber = buildBillingView({ snapshot: { ...rejected.snapshot!, providerSubscriberUid: "sub_1" }, history: rejected.history, now: DEMO_NOW, capabilities, available: true });
  assert.equal(withSubscriber.state, "processing");
  const processing = buildBillingView({ snapshot: DEMO_SCENARIOS.none.snapshot, history: DEMO_SCENARIOS.none.history, now: DEMO_NOW, capabilities, available: true });
  assert.equal(processing.state, "none");
});

test("sin nombre ni documento: sólo el correo de la sesión, y sin correo válido no se abre el pago", () => {
  const ok = parseEmailOnlyCustomer("profe@example.test");
  assert.deepEqual(ok, { ok: true, customer: { email: "profe@example.test" } });
  for (const bad of [null, undefined, "", "   ", "sin-arroba", "a".repeat(260) + "@x.test"]) assert.equal(parseEmailOnlyCustomer(bad).ok, false, String(bad));
});

test("la redirección al pago sólo sigue a pay.rebill.com (HTTPS, sin puerto ni credenciales) o a una ruta interna", () => {
  const origin = "https://teacherflowapp.com";
  assert.equal(safeProviderRedirect("https://pay.rebill.com/abc?tf_ref=x", origin), "https://pay.rebill.com/abc?tf_ref=x");
  for (const bad of ["http://pay.rebill.com/abc", "https://pay.rebill.com.evil.example/abc", "https://evilpay.rebill.com/abc", "https://evil.example/?u=https://pay.rebill.com", "https://pay.rebill.com:444/abc", "https://u:p@pay.rebill.com/abc", "//pay.rebill.com/abc", "javascript:alert(1)"]) assert.equal(safeProviderRedirect(bad, origin), null, bad);
});

test("intención de plan: sólo el código con forma de plan; el destino lo codifica; el nombre de la cookie no revela nada personal", () => {
  assert.equal(PLAN_INTENT_COOKIE, "tf_plan_intent");
  for (const code of CURRENT_PLAN_CODES) assert.equal(parsePlanIntent(code), code);
  for (const bad of [null, undefined, "", "tf_annual_ars_v2\r\nSet-Cookie: x=1", "../../etc/passwd", "TF_ANNUAL_ARS_V2", "tf_annual_ars_v", "tf_annual_usd_v2", "x".repeat(200)]) assert.equal(parsePlanIntent(bad as string | null | undefined), null, String(bad));
  assert.equal(planIntentDestination("tf_annual_ars_v2"), "/facturacion/planes?plan=tf_annual_ars_v2");
});
