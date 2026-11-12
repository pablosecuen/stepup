import { test } from "node:test";
import assert from "node:assert/strict";
import { RebillAdapter, buildCardUpdateLinkRequest, buildPauseRequest, buildResumeRequest, buildSearchPaymentsRequest, createRebillAdapter, isRebillCheckoutUrl, parseSubscription, readRebillConfig, resumeInstantIso } from "../providers/rebill.ts";
import { isLiveId, mapPaymentStatus, mapSubscriptionStatus, operationFromPayment, parseRebillNotice, referenceFromMetadata, signNotice, verifyNoticeSignature } from "../providers/rebill-normalize.ts";
import { getPlan, CURRENT_PLAN_CODES } from "../plans.ts";
import { resolveProviderChoice } from "../provider-selection.ts";
import { expectsLiveOperations } from "../provider-selection.ts";

const KEY = "sk_test_unit-NOT-REAL";
const SECRET = "whsec_unit-NOT-REAL";
const REF = `tfs_${"a".repeat(32)}`;
const NOW = () => new Date("2026-11-12T15:00:00.000Z");
const ENV = {
  REBILL_API_KEY: KEY,
  REBILL_ENVIRONMENT: "sandbox",
  REBILL_WEBHOOK_SECRET: SECRET,
  REBILL_PLAN_ID_TF_MONTHLY_ARS_V2: "test_pln_monthly",
  REBILL_PLAN_ID_TF_ANNUAL_ARS_V2: "test_pln_annual",
  REBILL_CHECKOUT_URL_TF_MONTHLY_ARS_V2: "https://pay.rebill.com/test/monthly",
  REBILL_CHECKOUT_URL_TF_ANNUAL_ARS_V2: "https://pay.rebill.com/test/annual",
} as const;

interface Call {
  url: string;
  init: RequestInit;
}
function stub(respond: (call: Call) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const adapterWith = (env: Record<string, string | undefined>, fetchImpl: typeof fetch) => new RebillAdapter(readRebillConfig(env, { fetchImpl, now: NOW }));

test("el proveedor vigente es Rebill; Mobbex sólo si se pide explícitamente; el falso nunca en Production", () => {
  assert.equal(resolveProviderChoice({}), "rebill");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "mobbex" }), "mobbex");
  assert.equal(resolveProviderChoice({ BILLING_PROVIDER: "fake", VERCEL_ENV: "production" }), "rebill");
});

test("la configuración se CIERRA (sin red) si falta la clave, el ambiente o si se mezclan ambientes o claves", async () => {
  assert.equal(readRebillConfig({}), null);
  assert.equal(readRebillConfig({ ...ENV, REBILL_API_KEY: "pk_test_publica" }), null, "una clave pública no sirve para operar");
  assert.equal(readRebillConfig({ ...ENV, REBILL_ENVIRONMENT: "otro" }), null);
  assert.equal(readRebillConfig({ ...ENV, REBILL_ENVIRONMENT: "production" }), null, "ids de plan de prueba con ambiente real");
  assert.equal(readRebillConfig({ ...ENV, REBILL_PLAN_ID_TF_ANNUAL_ARS_V2: "pln_real" }), null, "un id real con ambiente de prueba");
  assert.equal(readRebillConfig({ ...ENV, REBILL_CHECKOUT_URL_TF_ANNUAL_ARS_V2: "https://evil.example/pay" }), null, "destino de pago ajeno");
  const { fetchImpl, calls } = stub(() => json({}));
  const closed = adapterWith({}, fetchImpl);
  for (const result of [await closed.getOperation("test_pay_1"), await closed.listOperations({ updatedFromIso: "2026-11-01T00:00:00.000Z", page: 0, limit: 10 }), await closed.cancelSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" })]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "not_configured");
  }
  assert.equal(calls.length, 0, "cerrado: ninguna llamada de red");
  assert.equal(createRebillAdapter({}).environment, null);
});

test("los destinos de pago sólo son HTTPS de pay.rebill.com", () => {
  assert.equal(isRebillCheckoutUrl("https://pay.rebill.com/abc"), true);
  for (const bad of ["http://pay.rebill.com/abc", "https://pay.rebill.com.evil.example/", "https://evil.example/pay.rebill.com", "https://user@pay.rebill.com/x", "https://pay.rebill.com:8443/x", "javascript:alert(1)", "no es una url"]) assert.equal(isRebillCheckoutUrl(bad), false, bad);
});

test("checkout: dirección del plan + NUESTRA referencia + correo; sin nombre ni documento; sin red; rechaza referencias mal formadas y planes sin dirección", async () => {
  const { fetchImpl, calls } = stub(() => json({}));
  const adapter = adapterWith(ENV, fetchImpl);
  const plan = getPlan("tf_annual_ars_v2")!;
  const ok = await adapter.createCheckout({ subscriberReference: REF, plan, customer: { email: "qa@example.test" }, returnUrl: "https://app.example.test/facturacion/resultado", idempotencyKey: "k".repeat(12) });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const url = new URL(ok.data.redirectUrl);
  assert.equal(url.origin + url.pathname, "https://pay.rebill.com/test/annual");
  assert.equal(url.searchParams.get("tf_ref"), REF);
  assert.equal(url.searchParams.get("email"), "qa@example.test");
  assert.equal(ok.data.subscriberUid, null);
  assert.equal(calls.length, 0);
  const bad = await adapter.createCheckout({ subscriberReference: "otra-cosa", plan, customer: { email: "qa@example.test" }, returnUrl: "x", idempotencyKey: "k".repeat(12) });
  assert.equal(bad.ok, false);
  const missing = await adapter.createCheckout({ subscriberReference: REF, plan: getPlan("tf_quarterly_ars_v2")!, customer: { email: "qa@example.test" }, returnUrl: "x", idempotencyKey: "k".repeat(12) });
  assert.equal(missing.ok, false, "un plan sin dirección configurada no se puede abrir");
});

test("firma del aviso: HMAC-SHA256 hexadecimal del cuerpo CRUDO con el secreto completo; cualquier otra cosa se rechaza (tiempo constante)", () => {
  const body = JSON.stringify({ webhook: { event: "payment.updated" }, data: { id: "pay_1" } });
  const good = signNotice(body, SECRET);
  assert.match(good, /^[0-9a-f]{64}$/);
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: good, secret: SECRET }), true);
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: good.toUpperCase(), secret: SECRET }), true, "hexadecimal sin distinguir mayúsculas");
  assert.equal(verifyNoticeSignature({ rawBody: body + " ", signature: good, secret: SECRET }), false, "un byte distinto invalida");
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: good, secret: "whsec_otro" }), false);
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: undefined, secret: SECRET }), false);
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: good, secret: null }), false, "sin secreto configurado nada es auténtico");
  assert.equal(verifyNoticeSignature({ rawBody: body, signature: "corta", secret: SECRET }), false);
  const adapter = adapterWith(ENV, stub(() => json({})).fetchImpl);
  assert.equal(adapter.verifyNotice({ rawBody: body, signature: good }), true);
  assert.equal(adapterWith({ ...ENV, REBILL_WEBHOOK_SECRET: undefined }, stub(() => json({})).fetchImpl).verifyNotice({ rawBody: body, signature: good }), false);
});

test("avisos: sólo identificadores; payment.created (anidado) y payment.updated (plano) apuntan al pago; los pagos sueltos y los demás eventos se ignoran; el cuerpo nunca decide nada", () => {
  const now = new Date("2026-11-12T15:00:00.000Z");
  const created = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.created", logId: "l1" }, data: { payment: { id: "pay_1", status: "rejected", amount: 1, metadata: { tf_ref: REF } }, customer: { email: "persona@example.test" } } }), contentType: "application/json; charset=utf-8", now });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.notices.length, 1);
  assert.deepEqual(created.notices[0].hint, { providerPaymentId: "pay_1", executionUid: "pay_1", subscriberUid: null, subscriberReference: REF });
  assert.equal(created.notices[0].eventType, "subscription:execution");
  assert.ok(!JSON.stringify(created.notices[0]).includes("persona@example.test"), "ningún dato personal sale del aviso");
  const updated = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.updated", logId: "l2" }, data: { id: "pay_2", status: "approved", subscriptionId: "sub_9" } }), contentType: "application/json", now });
  assert.ok(updated.ok && updated.notices[0].hint.subscriberUid === "sub_9" && updated.notices[0].hint.providerPaymentId === "pay_2");
  const loose = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.created" }, data: { payment: { id: "pay_3", metadata: {} } } }), contentType: "application/json", now });
  assert.deepEqual(loose, { ok: true, notices: [] }, "un pago único (sin suscripción ni nuestra referencia) no es nuestro");
  const wrongRef = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.created" }, data: { payment: { id: "pay_4", metadata: { tf_ref: "no-tiene-la-forma" } } } }), contentType: "application/json", now });
  assert.deepEqual(wrongRef, { ok: true, notices: [] }, "una referencia con otra forma no cuenta");
  const subscription = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "subscription.updated", logId: "l3" }, data: { id: "sub_1", status: "paused" } }), contentType: "application/json", now });
  assert.ok(subscription.ok && subscription.notices[0].eventType === "subscription:subscriber:suspended");
  assert.deepEqual(parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "subscription.renewal_soon" }, data: { id: "sub_1" } }), contentType: "application/json", now }), { ok: true, notices: [] });
  assert.deepEqual(parseRebillNotice({ rawBody: "{", contentType: "application/json", now }), { ok: false, reason: "malformed" });
  assert.deepEqual(parseRebillNotice({ rawBody: "x=1", contentType: "application/x-www-form-urlencoded", now }), { ok: false, reason: "unsupported_content_type" });
  // Dos entregas distintas del mismo recurso con el mismo estado no se confunden (webhook.logId), pero la misma entrega repetida sí es idéntica.
  const a = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.updated", logId: "x1" }, data: { id: "pay_5", status: "approved", subscriptionId: "sub_1" } }), contentType: "application/json", now });
  const b = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.updated", logId: "x1" }, data: { id: "pay_5", status: "approved", subscriptionId: "sub_1" } }), contentType: "application/json", now });
  const c = parseRebillNotice({ rawBody: JSON.stringify({ webhook: { event: "payment.updated", logId: "x2" }, data: { id: "pay_5", status: "approved", subscriptionId: "sub_1" } }), contentType: "application/json", now });
  assert.ok(a.ok && b.ok && c.ok);
  if (a.ok && b.ok && c.ok) {
    assert.equal(a.notices[0].dedupKey, b.notices[0].dedupKey);
    assert.notEqual(a.notices[0].dedupKey, c.notices[0].dedupKey);
  }
});

test("estados de Rebill → dominio: sólo aprobado cobra; lo no listado no se aplica solo; la mora (paused/defaulted) no es una cancelación pedida", () => {
  assert.deepEqual(mapPaymentStatus("approved"), { outcome: "approved", refundScope: null });
  assert.deepEqual(mapPaymentStatus("pending"), { outcome: "pending", refundScope: null });
  assert.deepEqual(mapPaymentStatus("rejected"), { outcome: "rejected", refundScope: null });
  assert.deepEqual(mapPaymentStatus("refunded"), { outcome: "refunded", refundScope: "full" });
  assert.deepEqual(mapPaymentStatus("partially_refunded"), { outcome: "refunded", refundScope: "partial" });
  assert.deepEqual(mapPaymentStatus("cancelled"), { outcome: "refunded", refundScope: "unknown" });
  assert.deepEqual(mapPaymentStatus("chargeback"), { outcome: "chargeback", refundScope: null });
  for (const odd of ["", "APPROVED", "paid", undefined, 5, null]) assert.equal(mapPaymentStatus(odd).outcome, "other", String(odd));
  assert.equal(mapSubscriptionStatus("active", null), "active");
  assert.equal(mapSubscriptionStatus("retrying", null), "active");
  assert.equal(mapSubscriptionStatus("paused", "defaulted"), "unknown");
  assert.equal(mapSubscriptionStatus("paused", null), "suspended");
  assert.equal(mapSubscriptionStatus("cancelled", null), "suspended");
  assert.equal(mapSubscriptionStatus("finished", null), "finished");
  assert.equal(mapSubscriptionStatus("rara", null), "unknown");
});

test("operación desde el pago: sin correo, nombre ni tarjeta; referencia sólo de metadata; moneda y ambiente; importe exacto en centavos", () => {
  const payment = { id: "test_pay_1", status: "approved", amount: 25900, currency: "ARS", subscriptionId: "test_sub_1", metadata: { tf_ref: REF }, createdAt: "2026-11-12T12:00:00.000Z", updatedAt: "2026-11-12T12:00:05.000Z", customer: { email: "persona@example.test", name: "Persona" }, card: { last4: "4242" } };
  const operation = operationFromPayment(payment, "tf_monthly_ars_v2", "2026-11-12T13:00:00.000Z")!;
  assert.equal(operation.amountMinor, 2_590_000);
  assert.equal(operation.subscriberReference, REF);
  assert.equal(operation.subscriberUid, "test_sub_1");
  assert.equal(operation.livemode, false, "un id `test_` es de prueba");
  assert.equal(operationFromPayment({ ...payment, id: "pay_real_1" }, "tf_monthly_ars_v2", "x")!.livemode, true);
  assert.equal(operationFromPayment({ ...payment, id: "pay_real_1", currency: "USD" }, "tf_monthly_ars_v2", "x")!.livemode, false, "otra moneda nunca es una operación válida");
  assert.ok(!/persona|4242/i.test(JSON.stringify(operation)));
  assert.equal(operationFromPayment({ ...payment, amount: "25900.50" }, null, "x")!.amountMinor, 2_590_050);
  assert.equal(operationFromPayment({ ...payment, amount: -1 }, null, "x")!.amountMinor, null);
  assert.equal(operationFromPayment({ status: "approved" }, null, "x"), null, "sin id no hay operación");
  assert.equal(referenceFromMetadata({ tf_ref: "tfs_corta" }), null);
  assert.equal(isLiveId("test_pay_1"), false);
});

test("consulta autenticada: GET del pago con la clave; el plan sale de la SUSCRIPCIÓN (no del aviso); errores se clasifican; sin cuerpo válido es respuesta inválida", async () => {
  const { fetchImpl, calls } = stub((call) => {
    if (call.url.endsWith("/v3/payments/test_pay_1")) return json({ id: "test_pay_1", status: "approved", amount: 238800, currency: "ARS", subscriptionId: "test_sub_1", metadata: { tf_ref: REF }, createdAt: "2026-11-12T12:00:00.000Z" });
    if (call.url.endsWith("/v3/subscriptions/test_sub_1")) return json({ id: "test_sub_1", status: "active", plan: { id: "test_pln_annual" } });
    if (call.url.endsWith("/v3/payments/denegado")) return json({}, 401);
    if (call.url.endsWith("/v3/payments/limite")) return json({}, 429);
    if (call.url.endsWith("/v3/payments/caido")) return json({}, 503);
    if (call.url.endsWith("/v3/payments/inexistente")) return json({}, 404);
    return new Response("<html>", { status: 200 });
  });
  const adapter = adapterWith(ENV, fetchImpl);
  const result = await adapter.getOperation("test_pay_1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.planReference, "tf_annual_ars_v2");
    assert.equal(result.data.amountMinor, 23_880_000);
    assert.equal(result.data.outcome, "approved");
  }
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], KEY);
  assert.equal(calls[0].init.method, "GET");
  const kinds: Array<[string, string]> = [["denegado", "unauthorized"], ["limite", "unavailable"], ["caido", "unavailable"], ["inexistente", "rejected"], ["basura", "invalid_response"]];
  for (const [id, kind] of kinds) {
    const failed = await adapter.getOperation(id);
    assert.equal(failed.ok, false, id);
    if (!failed.ok) assert.equal(failed.error.kind, kind, id);
  }
});

test("cancelar = PAUSAR (no dar de baja); reanudar manda la fecha del próximo cobro futura; repetir lo ya cumplido no es un error", async () => {
  assert.deepEqual(buildPauseRequest("sub_1"), { method: "PATCH", path: "/v3/subscriptions/sub_1", json: { status: "paused" } });
  assert.deepEqual(buildResumeRequest("sub_1", "2026-12-01T15:00:00.000Z").json, { status: "active", nextChargeDate: "2026-12-01T15:00:00.000Z" });
  assert.equal(buildCardUpdateLinkRequest("sub_1").path, "/v3/subscriptions/sub_1/card/update-link");
  assert.equal(buildSearchPaymentsRequest({ limit: 500, offset: -4, subscriptionId: "sub_1" }).json && (buildSearchPaymentsRequest({ limit: 500, offset: -4 }).json as { limit: number; offset: number }).limit, 100);
  assert.equal(resumeInstantIso("2027-02-12"), "2027-02-12T15:00:00.000Z");
  assert.equal(resumeInstantIso("12/02/2027"), null);

  const state = { status: "active" };
  const { fetchImpl, calls } = stub((call) => {
    if (call.init.method === "PATCH") {
      const body = JSON.parse(String(call.init.body));
      if (body.status === "active" && !body.nextChargeDate) return json({}, 400);
      state.status = body.status;
      return json({ id: "sub_1", status: body.status });
    }
    return json({ id: "sub_1", status: state.status, plan: { id: "test_pln_monthly" } });
  });
  const adapter = adapterWith(ENV, fetchImpl);
  assert.equal((await adapter.cancelSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" })).ok, true);
  assert.equal((await adapter.cancelSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" })).ok, true, "pausar lo ya pausado es idempotente");
  assert.equal((await adapter.reactivateSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2", resumeAt: "2026-12-01T03:00:00.000Z" })).ok, true);
  const resume = calls.filter((call) => call.init.method === "PATCH").map((call) => JSON.parse(String(call.init.body))).at(-1);
  assert.deepEqual(resume, { status: "active", nextChargeDate: "2026-12-01T15:00:00.000Z" });
  // Si el fin del período ya pasó o es hoy, el primer día posterior (Rebill exige una fecha futura).
  await adapter.cancelSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" });
  await adapter.reactivateSubscriber({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2", resumeAt: "2026-11-01T03:00:00.000Z" });
  assert.equal(JSON.parse(String(calls.filter((call) => call.init.method === "PATCH").at(-1)!.init.body)).nextChargeDate, "2026-11-13T15:00:00.000Z");
});

test("cambiar de plan y actualizar el medio de pago sólo existen si se DECLARAN validados en sandbox; mientras no, no se ofrece ni sale ningún pedido", async () => {
  const { fetchImpl, calls } = stub(() => json({ url: "https://pay.rebill.com/card/xyz" }));
  const off = adapterWith(ENV, fetchImpl);
  assert.deepEqual(off.capabilities, { changePlan: false, paymentMethodUpdate: false });
  for (const result of [await off.changePlan({ subscriberUid: "sub_1", fromPlanCode: "tf_monthly_ars_v2", toPlanCode: "tf_annual_ars_v2" }), await off.getPaymentMethodUpdateUrl({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" })]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unsupported");
  }
  assert.equal(calls.length, 0);
  const on = adapterWith({ ...ENV, REBILL_VALIDATED_CAPABILITIES: "paymentMethodUpdate" }, fetchImpl);
  assert.deepEqual(on.capabilities, { changePlan: false, paymentMethodUpdate: true });
  const link = await on.getPaymentMethodUpdateUrl({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" });
  assert.equal(link.ok, true);
  const evil = adapterWith({ ...ENV, REBILL_VALIDATED_CAPABILITIES: "paymentMethodUpdate" }, stub(() => json({ url: "https://evil.example/steal" })).fetchImpl);
  const rejected = await evil.getPaymentMethodUpdateUrl({ subscriberUid: "sub_1", planCode: "tf_monthly_ars_v2" });
  assert.equal(rejected.ok, false, "un destino que no es pay.rebill.com se descarta");
});

test("barrido global: sólo pagos de suscripción o con nuestra referencia, los más recientes primero, hasta la fecha pedida; un pago ajeno no entra", async () => {
  const { fetchImpl } = stub((call) => {
    if (call.url.endsWith("/v3/payments/search")) {
      return json({
        records: [
          { id: "test_pay_3", status: "approved", amount: 25900, currency: "ARS", subscriptionId: "test_sub_1", updatedAt: "2026-11-12T14:00:00.000Z", createdAt: "2026-11-12T14:00:00.000Z" },
          { id: "test_pay_unico", status: "approved", amount: 100, currency: "ARS", updatedAt: "2026-11-12T13:00:00.000Z", createdAt: "2026-11-12T13:00:00.000Z" },
          { id: "test_pay_viejo", status: "approved", amount: 25900, currency: "ARS", subscriptionId: "test_sub_1", updatedAt: "2026-10-01T13:00:00.000Z", createdAt: "2026-10-01T13:00:00.000Z" },
        ],
        pagination: { hasNextPage: true },
      });
    }
    return json({ id: "test_sub_1", status: "active", plan: { id: "test_pln_monthly" } });
  });
  const adapter = adapterWith(ENV, fetchImpl);
  const result = await adapter.listOperations({ updatedFromIso: "2026-11-01T00:00:00.000Z", page: 0, limit: 50 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.operations.map((operation) => operation.providerPaymentId), ["test_pay_3"]);
    assert.equal(result.data.nextPage, null, "al llegar a lo anterior a la fecha pedida, el barrido termina");
  }
});

test("producción: sólo cuentan operaciones reales; sandbox: todo es de prueba", () => {
  assert.equal(expectsLiveOperations("rebill", { REBILL_ENVIRONMENT: "production" }), true);
  assert.equal(expectsLiveOperations("rebill", { REBILL_ENVIRONMENT: "sandbox" }), false);
  assert.equal(expectsLiveOperations("rebill", {}), true, "sin declarar, lo más estricto");
  assert.equal(expectsLiveOperations("fake", {}), false);
  assert.equal(expectsLiveOperations("mobbex", { MOBBEX_SANDBOX: "true" }), false);
  assert.equal(parseSubscription({ id: "sub_1", status: "active", plan: { id: "test_pln_monthly" } }, new Map([["test_pln_monthly", "tf_monthly_ars_v2" as const]]))?.planCode, "tf_monthly_ars_v2");
  assert.equal(CURRENT_PLAN_CODES.length, 4);
});
