import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, createClient, judge, sqlFor } from "../../../scripts/rebill-verify.mjs";

const REF = `tfs_${"a".repeat(32)}`;

function fake({ payments = [], subs = [], plans = [{ id: "pln_m", metadata: { tfCode: "tf_monthly_ars_v2" } }] }: { payments?: unknown[]; subs?: unknown[]; plans?: unknown[] } = {}) {
  const log: string[] = [];
  const impl = (async (url: string, init: { method: string; body?: string }) => {
    const path = new URL(url).pathname;
    log.push(`${init.method} ${path}`);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 201 });
    if (path === "/v3/organizations/me") return new Response(JSON.stringify({ environment: "productive", status: "active" }), { status: 200 });
    if (path === "/v3/plans/search") return reply({ records: plans, pagination: { hasNextPage: false } });
    if (path === "/v3/payments/search") return reply({ records: payments, pagination: { hasNextPage: false } });
    if (path === "/v3/subscriptions/search") return reply({ records: subs, pagination: { hasNextPage: false } });
    if (path === "/v3/webhooks/search") return reply({ records: [{ url: "https://teacherflowapp.com/api/billing/webhooks/rebill", active: true, events: ["payment.created", "payment.updated", "subscription.created", "subscription.updated"] }] });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { call: createClient("sk_test_x", impl), log };
}

const goodPayment = { id: "pay_1234567890abcd", status: "approved", amount: 25900, currency: "ARS", type: "first_subscription_payment", createdAt: "2026-11-26T15:00:00.000Z", updatedAt: "2026-11-26T15:00:00.000Z", subscriptionId: "sub_1234567890abcd", metadata: { tf_ref: REF }, customer: { email: "x@y.z" } };
const goodSub = { id: "sub_1234567890abcd", status: "active", plan: { id: "pln_m" }, nextChargeDate: "2026-12-26T15:00:00.000Z", metadata: {} };

test("la verificación SÓLO lee: ninguna llamada de escritura (nada se cobra, cancela, reanuda ni devuelve)", async () => {
  const { call, log } = fake({ payments: [goodPayment], subs: [goodSub] });
  await collect(call);
  assert.ok(log.length >= 5);
  for (const line of log) assert.match(line, /^(GET \/v3\/organizations\/me|POST \/v3\/(plans|payments|subscriptions|webhooks)\/search)$/, line);
});

test("una compra mensual correcta pasa todas las comprobaciones, con el importe TOTAL del plan y sin datos personales en la salida", async () => {
  const { call } = fake({ payments: [goodPayment], subs: [goodSub] });
  const snapshot = await collect(call);
  assert.doesNotMatch(JSON.stringify(snapshot), /x@y\.z|tfs_a{32}/, "ni el correo ni la referencia completa");
  const verdict = judge(snapshot, "monthly");
  assert.equal(verdict.ok, true, JSON.stringify(verdict.checks.filter((c: { ok: boolean }) => !c.ok)));
  assert.match(sqlFor(verdict.tfRefFingerprint), /left\(encode\(sha256\(convert_to\(s\.provider_reference/);
  assert.doesNotMatch(sqlFor(verdict.tfRefFingerprint), /tfs_a/);
});

test("detecta duplicados, importes equivocados (el mensual comparativo), pagos sin tf_ref y suscripciones repetidas", async () => {
  const wrongAmount = judge(await collect(fake({ payments: [{ ...goodPayment, amount: 19900 }], subs: [goodSub] }).call), "annual");
  assert.equal(wrongAmount.ok, false);
  const twice = judge(await collect(fake({ payments: [goodPayment, { ...goodPayment, id: "pay_other_1234567" }], subs: [goodSub, { ...goodSub, id: "sub_other_1234567" }] }).call), "monthly");
  assert.equal(twice.ok, false);
  assert.ok(twice.checks.some((c: { ok: boolean; name: string }) => !c.ok && /UN pago/.test(c.name)) && twice.checks.some((c: { ok: boolean; name: string }) => !c.ok && /UNA suscripción/.test(c.name)));
  const noRef = judge(await collect(fake({ payments: [{ ...goodPayment, metadata: {} }], subs: [goodSub] }).call), "monthly");
  assert.ok(noRef.checks.some((c: { ok: boolean; name: string }) => !c.ok && /tf_ref/.test(c.name)));
  assert.equal(judge(await collect(fake().call), "monthly").ok, false);
});
