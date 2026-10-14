import { test } from "node:test";
import assert from "node:assert/strict";
import { MobbexAdapter, buildActivateSubscriberRequest, buildCreateSubscriberRequest, buildCreateSubscriptionRequest, buildMoveSubscriberRequest, buildStatusQueryRequest, buildSuspendSubscriberRequest, parseStatusQuery, parseSubscriberCreated, readMobbexConfig, createMobbexAdapter } from "../providers/mobbex.ts";
import { mapStatusCode } from "../providers/mobbex-normalize.ts";
import { PLAN_CODES, getPlan, listActivePlans, type PlanCode } from "../plans.ts";

const FAKE_KEY = "unit-test-api-key-NOT-REAL";
const FAKE_TOKEN = "unit-test-access-token-NOT-REAL";
const PLAN = getPlan("tf_monthly_ars_v1")!;
const CUSTOMER = { email: "qa@example.com", name: "QA Test", identification: "20111222" };

const VALIDATED_ENV = { MOBBEX_VALIDATED_CAPABILITIES: "changePlan,paymentMethodUpdate" } as const;

const ENV = {
  MOBBEX_API_KEY: FAKE_KEY,
  MOBBEX_ACCESS_TOKEN: FAKE_TOKEN,
  MOBBEX_SUBSCRIPTION_UID_TF_MONTHLY_ARS_V1: "uid_m",
  MOBBEX_SUBSCRIPTION_UID_TF_QUARTERLY_ARS_V1: "uid_q",
  MOBBEX_SUBSCRIPTION_UID_TF_SEMIANNUAL_ARS_V1: "uid_s",
  MOBBEX_SUBSCRIPTION_UID_TF_ANNUAL_ARS_V1: "uid_a",
} as const;

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: (call: Call) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOW = () => new Date("2026-10-13T23:30:00.000Z"); // 20:30 del 13/10 en Argentina

function configured(respond: (call: Call) => Response | Promise<Response>, extraEnv: Record<string, string> = {}) {
  const stub = stubFetch(respond);
  const config = readMobbexConfig({ ...ENV, ...extraEnv }, { fetchImpl: stub.fetchImpl, now: NOW });
  assert.ok(config);
  return { adapter: new MobbexAdapter(config), calls: stub.calls };
}

test("SIN credenciales el adaptador queda CERRADO: ningún método hace una llamada de red", async () => {
  const stub = stubFetch(() => json({ result: true }));
  // Ni siquiera con un `fetch` disponible: la configuración es null, así que no hay nada que enviar.
  const adapter = new MobbexAdapter(null);
  const results = await Promise.all([
    adapter.createCheckout({ subscriberReference: "tfs_" + "a".repeat(32), plan: PLAN, customer: CUSTOMER, returnUrl: "https://teacherflowapp.com/x", idempotencyKey: "k".repeat(10) }),
    adapter.getOperation("PAY1"),
    adapter.listOperations(),
    adapter.cancelSubscriber({ subscriberUid: "s", planCode: PLAN.code }),
    adapter.reactivateSubscriber({ subscriberUid: "s", planCode: PLAN.code }),
    adapter.changePlan({ subscriberUid: "s", fromPlanCode: PLAN.code, toPlanCode: "tf_annual_ars_v1" }),
    adapter.getSubscriber({ subscriberUid: "s", planCode: PLAN.code }),
    adapter.getPaymentMethodUpdateUrl({ subscriberUid: "s", planCode: PLAN.code }),
  ]);
  for (const result of results) assert.deepEqual(result, { ok: false, error: { kind: "not_configured", retryable: false } });
  assert.equal(stub.calls.length, 0);
  // También el último eslabón (el que arma y envía el pedido) está cerrado sin credenciales.
  const raw = await (adapter as unknown as { send(request: { method: "GET"; path: string }): Promise<unknown> }).send({ method: "GET", path: "/p/subscriptions/" });
  assert.deepEqual(raw, { ok: false, error: { kind: "not_configured", retryable: false } });
  assert.equal(readMobbexConfig({}), null);
  assert.equal(readMobbexConfig({ MOBBEX_API_KEY: FAKE_KEY }), null, "falta el token de acceso");
  assert.equal(readMobbexConfig({ MOBBEX_ACCESS_TOKEN: FAKE_TOKEN }), null, "falta la clave de la API");
  assert.equal(readMobbexConfig({ MOBBEX_API_KEY: "  ", MOBBEX_ACCESS_TOKEN: "  " }), null);
  assert.equal(await createMobbexAdapter({}).getOperation("x").then((r) => (r.ok ? "ok" : r.error.kind)), "not_configured");
});

test("con credenciales pero sin la suscripción (plantilla) del plan configurada, tampoco se llama a la red", async () => {
  const stub = stubFetch(() => json({ result: true }));
  const config = readMobbexConfig({ MOBBEX_API_KEY: FAKE_KEY, MOBBEX_ACCESS_TOKEN: FAKE_TOKEN }, { fetchImpl: stub.fetchImpl, now: NOW });
  const adapter = new MobbexAdapter(config);
  const result = await adapter.createCheckout({ subscriberReference: "tfs_" + "a".repeat(32), plan: PLAN, customer: CUSTOMER, returnUrl: "https://teacherflowapp.com/x", idempotencyKey: "k".repeat(10) });
  assert.equal(result.ok, false);
  assert.equal(stub.calls.length, 0);
});

test("los pedidos llevan x-api-key y x-access-token (sólo del servidor), con redirecciones prohibidas y sin cookies", async () => {
  const { adapter, calls } = configured(() => json({ result: true, data: { transaction: null } }));
  await adapter.getOperation("PAY1");
  await adapter.cancelSubscriber({ subscriberUid: "SUBR", planCode: PLAN.code });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], FAKE_KEY);
    assert.equal(headers["x-access-token"], FAKE_TOKEN);
    assert.equal(call.init.redirect, "error");
    assert.ok(call.url.startsWith("https://api.mobbex.com/"), call.url);
    assert.equal(call.init.credentials, undefined);
  }
});

test("las tres formas de pedido documentadas: crear suscripción, crear suscriptor y consultar la operación", () => {
  const create = buildCreateSubscriptionRequest(PLAN, { returnUrl: "https://teacherflowapp.com/facturacion", webhookUrl: "https://teacherflowapp.com/api/billing/webhook", test: false });
  assert.deepEqual(create, {
    method: "POST",
    path: "/p/subscriptions/",
    json: {
      total: "24900.00",
      currency: "ARS",
      type: "dynamic",
      name: "TeacherFlow Mensual",
      description: "Suscripción mensual a TeacherFlow",
      interval: "1m",
      limit: 0,
      trial: 0,
      setupFee: 0,
      reference: "tf_monthly_ars_v1",
      return_url: "https://teacherflowapp.com/facturacion",
      webhook: "https://teacherflowapp.com/api/billing/webhook",
      test: false,
    },
  });
  const subscriber = buildCreateSubscriberRequest({ subscriptionUid: "uid_m", reference: "tfs_" + "a".repeat(32), customer: CUSTOMER, startDateKey: "2026-10-14", test: true });
  assert.equal(subscriber.path, "/p/subscriptions/uid_m/subscriber");
  assert.deepEqual((subscriber.json as { startDate: unknown }).startDate, { day: 14, month: 10, year: 2026 });
  assert.equal((subscriber.json as { reference: string }).reference, "tfs_" + "a".repeat(32));
  assert.equal((subscriber.json as { test: boolean }).test, true);
  assert.deepEqual(buildStatusQueryRequest("PAY1"), { method: "POST", path: "/2.0/transactions/status", form: { id: "PAY1" } });
  assert.equal(buildSuspendSubscriberRequest("uid_m", "S1").path, "/p/subscriptions/uid_m/subscriber/S1/action/suspend");
  assert.equal(buildActivateSubscriberRequest("uid_m", "S1").path, "/p/subscriptions/uid_m/subscriber/S1/action/activate");
  assert.deepEqual(buildMoveSubscriberRequest("uid_m", "S1", "uid_a"), { method: "POST", path: "/p/subscriptions/uid_m/subscriber/S1/action/move", json: { sid: "uid_a" } });
});

test("cada plan se crea en el proveedor con SU intervalo (1m, 3m, 6m, 1y), el precio completo, sin prueba ni costo de alta y sin cuotas", () => {
  const expected: Record<PlanCode, [string, string]> = {
    tf_monthly_ars_v1: ["1m", "24900.00"],
    tf_quarterly_ars_v1: ["3m", "69900.00"],
    tf_semiannual_ars_v1: ["6m", "133900.00"],
    tf_annual_ars_v1: ["1y", "249000.00"],
  };
  for (const plan of listActivePlans()) {
    const body = buildCreateSubscriptionRequest(plan, { returnUrl: "https://teacherflowapp.com/x", webhookUrl: null, test: false }).json as Record<string, unknown>;
    assert.deepEqual([body.interval, body.total], expected[plan.code]);
    assert.equal(body.currency, "ARS");
    assert.equal(body.type, "dynamic");
    assert.equal(body.trial, 0);
    assert.equal(body.setupFee, 0);
    assert.equal(body.limit, 0);
    assert.equal(body.reference, plan.code);
    assert.equal("webhook" in body, false);
    assert.equal("installments" in body, false);
  }
  assert.equal(PLAN_CODES.length, 4);
});

test("crear el checkout: el suscriptor arranca MAÑANA (fecha civil de Argentina) y la redirección sólo se acepta si es HTTPS de mobbex.com", async () => {
  const { adapter, calls } = configured(() => json({ result: true, data: { uid: "SUBR1", sourceUrl: "https://mobbex.com/p/subscriptions/uid_m/subscriber/SUBR1/source" } }));
  const result = await adapter.createCheckout({ subscriberReference: "tfs_" + "a".repeat(32), plan: PLAN, customer: CUSTOMER, returnUrl: "https://teacherflowapp.com/x", idempotencyKey: "k".repeat(10) });
  assert.deepEqual(result, { ok: true, data: { checkoutUid: "SUBR1", subscriberUid: "SUBR1", redirectUrl: "https://mobbex.com/p/subscriptions/uid_m/subscriber/SUBR1/source" } });
  // 23:30 UTC = 20:30 del 13/10 en Argentina → arranca el 14/10 (nunca la fecha UTC ni el mismo día).
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).startDate, { day: 14, month: 10, year: 2026 });
  for (const evil of ["http://mobbex.com/x", "https://evil.example/x", "https://mobbex.com.evil.example/x", "javascript:alert(1)", "//evil.example", "https://notmobbex.com/x"]) {
    assert.equal(parseSubscriberCreated({ result: true, data: { uid: "S", sourceUrl: evil } }), null, evil);
  }
  assert.notEqual(parseSubscriberCreated({ result: true, data: { uid: "S", sourceUrl: "https://checkout.mobbex.com/x" } }), null);
});

test("errores del proveedor: sólo la categoría; nunca el cuerpo, los encabezados ni las claves", async () => {
  const cases: Array<[() => Response | Promise<Response>, string, boolean]> = [
    [() => new Response("secret internal body " + FAKE_KEY, { status: 401 }), "unauthorized", false],
    [() => new Response("x", { status: 403 }), "unauthorized", false],
    [() => new Response("<html>" + FAKE_TOKEN + "</html>", { status: 500 }), "unavailable", true],
    [() => new Response("x", { status: 503 }), "unavailable", true],
    [() => new Response("x", { status: 400 }), "rejected", false],
    [() => new Response("x", { status: 404 }), "rejected", false],
    [() => new Response("not json", { status: 200 }), "invalid_response", false],
    [() => json({ result: false }), "invalid_response", false],
    [() => json({ result: true, data: { unexpected: true } }), "invalid_response", false],
  ];
  for (const [respond, kind, retryable] of cases) {
    const { adapter } = configured(respond);
    const result = await adapter.getOperation("PAY1");
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.deepEqual(result.error, { kind, retryable });
    const text = JSON.stringify(result);
    for (const secret of [FAKE_KEY, FAKE_TOKEN, "secret internal body", "<html>"]) assert.equal(text.includes(secret), false);
  }
});

test("timeout y caída de red: categorías reintentables y sin detalles", async () => {
  const stub = stubFetch(() => {
    throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 key=" + FAKE_KEY), { name: "TypeError" });
  });
  const config = readMobbexConfig({ ...ENV }, { fetchImpl: stub.fetchImpl, now: NOW });
  const down = await new MobbexAdapter(config).getOperation("PAY1");
  assert.deepEqual(down, { ok: false, error: { kind: "unavailable", retryable: true } });
  assert.equal(JSON.stringify(down).includes(FAKE_KEY), false);
  const slow = stubFetch(async (call) => {
    await new Promise((_, reject) => (call.init.signal as AbortSignal).addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return json({});
  });
  const base = readMobbexConfig(ENV, { fetchImpl: slow.fetchImpl, now: NOW })!;
  const adapter = new MobbexAdapter({ ...base, timeoutMs: 20 });
  assert.deepEqual(await adapter.getOperation("PAY1"), { ok: false, error: { kind: "timeout", retryable: true } });
});

test("la consulta de una operación sigue la forma documentada y no extrae datos personales", () => {
  const operation = parseStatusQuery(
    { result: true, data: { transaction: { payment: { id: "zP5_3fqSt", status: { code: "200", text: "Aprobado" }, total: 100.5, currency: { code: "TEST" }, created: "2020-07-13T17:20:54.308Z", updated: "2020-07-13T17:20:54.977Z", source: { number: "450799******0010" } }, user: { name: "Cliente Demo", email: "demo@mobbex.com" } } } },
    "2026-10-13T00:00:00.000Z",
  );
  assert.ok(operation);
  assert.equal(operation.providerPaymentId, "zP5_3fqSt");
  assert.equal(operation.outcome, "approved");
  assert.equal(operation.amountMinor, 10050);
  assert.equal(operation.currency, "TEST");
  assert.equal(operation.livemode, false, "moneda de prueba: nunca es una operación real");
  assert.equal(JSON.stringify(operation).includes("demo@mobbex.com"), false);
  assert.equal(JSON.stringify(operation).includes("450799"), false);
  assert.equal(parseStatusQuery({ result: true, data: {} }, "x"), null);
  assert.equal(parseStatusQuery({ result: false }, "x"), null);
});

test("la tabla de estados de Mobbex se traduce de forma conservadora (sólo 200 y su liquidación cuentan como cobro aprobado)", () => {
  for (const code of ["200", "299", "300", "301", "302", "303"]) assert.deepEqual(mapStatusCode(code), { outcome: "approved", refundScope: null }, code);
  for (const code of ["0", "1", "2", "3", "100", "210", "600"]) assert.deepEqual(mapStatusCode(code), { outcome: "pending", refundScope: null }, code);
  for (const code of ["400", "401", "402", "403", "410", "411", "412", "413", "414", "415", "416", "417", "418", "419", "500", "604"]) assert.deepEqual(mapStatusCode(code), { outcome: "rejected", refundScope: null }, code);
  // Devoluciones: sólo «602 Devuelta» es total; «605 Parcialmente devuelta» es parcial; «601 Cancelada» y «610 Cancelada por operatoria inválida» no definen alcance.
  assert.deepEqual(mapStatusCode("602"), { outcome: "refunded", refundScope: "full" });
  assert.deepEqual(mapStatusCode("605"), { outcome: "refunded", refundScope: "partial" });
  for (const code of ["601", "610"]) assert.deepEqual(mapStatusCode(code), { outcome: "refunded", refundScope: "unknown" }, code);
  for (const code of ["201", "4000", "800", "603", "abc", "", "-1", "2e2"]) assert.deepEqual(mapStatusCode(code), { outcome: "other", refundScope: null }, code);
});

test("el listado global de operaciones no tiene forma documentada: «unsupported»; los avisos se reducen a una pista y NO se autentican", async () => {
  const { adapter } = configured(() => json({}));
  assert.deepEqual(await adapter.listOperations(), { ok: false, error: { kind: "unsupported", retryable: false } });
  assert.equal((adapter as unknown as Record<string, unknown>).verifyWebhook, undefined, "no existe un «verificar»: ningún aviso gana autoridad");
  const notice = adapter.parseNotice({ rawBody: JSON.stringify({ type: "subscription:execution", data: { payment: { id: "P1", status: { code: "200" } }, subscriber: { uid: "S1" } } }), contentType: "application/json", now: new Date(0) });
  assert.equal(notice.ok, true);
  assert.deepEqual(notice.ok ? Object.keys(notice.notices[0].hint).sort() : [], ["executionUid", "providerPaymentId", "subscriberReference", "subscriberUid"]);
});

test("cancelar suspende al suscriptor y cambiar de plan lo mueve a la suscripción del otro plan (rutas documentadas) — el cambio sólo con la capacidad declarada VALIDADA", async () => {
  const closed = configured(() => json({ result: true }));
  assert.deepEqual(closed.adapter.capabilities, { changePlan: false, paymentMethodUpdate: false });
  assert.deepEqual(await closed.adapter.changePlan({ subscriberUid: "S1", fromPlanCode: "tf_monthly_ars_v1", toPlanCode: "tf_annual_ars_v1" }), { ok: false, error: { kind: "unsupported", retryable: false } });
  assert.equal(closed.calls.length, 0, "sin validar en sandbox no sale ningún pedido de cambio de plan");
  const { adapter, calls } = configured(() => json({ result: true }), VALIDATED_ENV);
  assert.deepEqual(adapter.capabilities, { changePlan: true, paymentMethodUpdate: true });
  assert.deepEqual(await adapter.cancelSubscriber({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: true, data: { canceled: true } });
  assert.deepEqual(await adapter.reactivateSubscriber({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: true, data: { reactivated: true } });
  assert.deepEqual(await adapter.changePlan({ subscriberUid: "S1", fromPlanCode: "tf_monthly_ars_v1", toPlanCode: "tf_annual_ars_v1" }), { ok: true, data: { changed: true } });
  assert.deepEqual(calls.map((call) => [call.init.method, new URL(call.url).pathname]), [
    ["POST", "/p/subscriptions/uid_m/subscriber/S1/action/suspend"],
    ["POST", "/p/subscriptions/uid_m/subscriber/S1/action/activate"],
    ["POST", "/p/subscriptions/uid_m/subscriber/S1/action/move"],
  ]);
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { sid: "uid_a" });
});

test("sondeo de un suscriptor (GET …/subscriber/{sid}): sólo se interpretan las formas que la documentación MUESTRA; todo lo demás es «unknown» o ilegible, nunca se inventa", async () => {
  const { parseSubscriberState, buildGetSubscriberRequest } = await import("../providers/mobbex.ts");
  assert.deepEqual(buildGetSubscriberRequest("uid_m", "S1"), { method: "GET", path: "/p/subscriptions/uid_m/subscriber/S1" });
  const shown = parseSubscriberState({ result: true, data: { subscriber: { uid: "S1", status: "active", executions: [] }, url: "https://mobbex.com/p/subscriptions/uid_m/subscriber/S1" } });
  assert.deepEqual(shown?.state, { status: "active", operations: [], executionsReadable: true });
  assert.equal(shown?.controlUrl, "https://mobbex.com/p/subscriptions/uid_m/subscriber/S1");
  assert.equal(parseSubscriberState({ result: true, data: { subscriber: { status: "finished", executions: [] } } })?.state.status, "finished");
  // El valor de un suscriptor suspendido NO está documentado: no se adivina.
  for (const status of ["suspended", "paused", "cancelled", "ACTIVE", "", undefined, 1]) assert.equal(parseSubscriberState({ result: true, data: { subscriber: { status, executions: [] } } })?.state.status, "unknown", String(status));
  // Ejecuciones con contenido: forma no documentada → ilegibles (y NO significa «sin cobros»).
  assert.equal(parseSubscriberState({ result: true, data: { subscriber: { status: "active", executions: [{ uid: "E1", status: "paid" }] } } })?.state.executionsReadable, false);
  assert.equal(parseSubscriberState({ result: true, data: { subscriber: { status: "active" } } })?.state.executionsReadable, false);
  // Destinos de control: sólo HTTPS de mobbex.com.
  for (const evil of ["http://mobbex.com/x", "https://mobbex.com.evil.example/x", "https://evil.example/x", "javascript:alert(1)", "//evil.example", 5, null]) {
    assert.equal(parseSubscriberState({ result: true, data: { subscriber: { status: "active", executions: [] }, url: evil } })?.controlUrl, null, String(evil));
  }
  for (const bad of [null, {}, { result: false }, { result: true }, { result: true, data: {} }, { result: true, data: { subscriber: "x" } }]) assert.equal(parseSubscriberState(bad), null, JSON.stringify(bad));
});

test("getSubscriber y el cambio de medio de pago contra el adaptador: con capacidad validada devuelven sólo el destino HTTPS de mobbex.com; sin validar, «unsupported» y NINGÚN pedido", async () => {
  const good = { result: true, data: { subscriber: { uid: "S1", status: "active", executions: [] }, url: "https://mobbex.com/p/subscriptions/uid_m/subscriber/S1" } };
  const closed = configured(() => json(good));
  const state = await closed.adapter.getSubscriber({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" });
  assert.deepEqual(state, { ok: true, data: { status: "active", operations: [], executionsReadable: true } });
  assert.deepEqual(await closed.adapter.getPaymentMethodUpdateUrl({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: false, error: { kind: "unsupported", retryable: false } });
  assert.equal(closed.calls.length, 1, "sólo la consulta del estado: el cambio de medio de pago sin validar no sale a la red");
  const open = configured(() => json(good), VALIDATED_ENV);
  assert.deepEqual(await open.adapter.getPaymentMethodUpdateUrl({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: true, data: { redirectUrl: "https://mobbex.com/p/subscriptions/uid_m/subscriber/S1" } });
  const evil = configured(() => json({ ...good, data: { ...good.data, url: "https://evil.example/x" } }), VALIDATED_ENV);
  assert.deepEqual(await evil.adapter.getPaymentMethodUpdateUrl({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: false, error: { kind: "invalid_response", retryable: false } }, "un destino fuera de mobbex.com se descarta");
  const garbage = configured(() => json({ result: true, data: { nothing: 1 } }));
  assert.deepEqual(await garbage.adapter.getSubscriber({ subscriberUid: "S1", planCode: "tf_monthly_ars_v1" }), { ok: false, error: { kind: "invalid_response", retryable: false } });
});

test("el vencimiento del enlace de carga del medio de pago (expiresAt) viaja al crear el suscriptor: 24 horas", async () => {
  const { adapter, calls } = configured(() => json({ result: true, data: { uid: "SUBR1", sourceUrl: "https://mobbex.com/p/subscriptions/uid_m/subscriber/SUBR1/source" } }));
  await adapter.createCheckout({ subscriberReference: "tfs_" + "a".repeat(32), plan: PLAN, customer: CUSTOMER, returnUrl: "https://teacherflowapp.com/x", idempotencyKey: "k".repeat(10) });
  assert.equal(JSON.parse(String(calls[0].init.body)).expiresAt, NOW().getTime() + 24 * 3_600_000);
});
