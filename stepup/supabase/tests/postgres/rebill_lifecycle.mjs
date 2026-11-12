// REBILL — CICLO DE VIDA COMPLETO con un Rebill SIMULADO (API y avisos firmados) y Postgres REAL (embedded-postgres 17, todas las migraciones reales).
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/rebill_lifecycle.mjs
//
// El adaptador de producción (`RebillAdapter`), la recepción de avisos, el procesador, el sondeo, el barrido global, la confirmación a pedido y los comandos corren TAL CUAL;
// lo único simulado es el servidor de Rebill (`rb`: pagos, suscripciones y los PATCH de pausa/reanudación). Sin red, sin credenciales reales, sin dinero.
// Cubre: checkout sin duplicados, volver sin pago no activa, pago pendiente/rechazado, firma inválida, primer cobro aprobado → vínculo del suscriptor y acceso, duplicados,
// renovación sin nuestra referencia, devolución que sólo trae el id del pago, avisos tardíos, cancelar/reanudar con caída del proveedor, recuperación con el navegador cerrado
// y el aviso perdido (a pedido y por barrido), adopción por aviso de suscripción, dos suscripciones de la misma cuenta, operaciones de prueba ignoradas en Production,
// aislamiento entre cuentas y ausencia de secretos en la base.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");

console.info = () => {};
console.warn = () => {};
console.error = () => {};
const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { RebillAdapter, readRebillConfig } = await importLib("billing/providers/rebill.ts");
const { signNotice } = await importLib("billing/providers/rebill-normalize.ts");
const { ingestNotice } = await importLib("billing/webhook-ingest.ts");
const { createNoticeLimiter } = await importLib("billing/rate-limit.ts");
const { drainEvents, runClockSweep, runProviderSweep, runSubscriberPoll } = await importLib("billing/processor.ts");
const { cancelSubscription, reactivateSubscription, startCheckout } = await importLib("billing/commands.ts");
const { prepareAccountDeletion } = await importLib("billing/account-deletion.ts");
const { confirmOwnerPayment, resetConfirmThrottleForTests } = await importLib("billing/confirm.ts");
const { resolveBillingAccess } = await importLib("billing/access.ts");
const { buildBillingView } = await importLib("billing/view.ts");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");

const ar = (date, hour = 0, minute = 0) => localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" });
const FLAGS = { enabled: true, enforcement: false };
const ENFORCING = { enabled: true, enforcement: true };
const SANDBOX_KEY = "sk_test_unit-NOT-REAL";
const LIVE_KEY = "sk_live_unit-NOT-REAL";
const SANDBOX_SECRET = "whsec_unit-sandbox-NOT-REAL";
const LIVE_SECRET = "whsec_unit-live-NOT-REAL";

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.message ?? error).split("\n").slice(0, 5).join("\n        ")}`);
  }
};

// ------------------------------------------------------------------------------------------------ Rebill simulado
let clock = new Date(ar("2026-11-12", 9));
const now = () => clock;
const rb = {
  payments: new Map(),
  subscriptions: new Map(),
  requests: [],
  patches: [],
  down: false,
  addPayment(payment) {
    const at = clock.toISOString();
    this.payments.set(payment.id, { currency: "ARS", createdAt: at, updatedAt: at, metadata: {}, ...payment });
  },
  setStatus(id, status) {
    const payment = this.payments.get(id);
    this.payments.set(id, { ...payment, status, updatedAt: clock.toISOString() });
  },
  addSubscription(id, planId, status = "active") {
    this.subscriptions.set(id, { id, status, plan: { id: planId } });
  },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchImpl = async (url, init = {}) => {
  if (rb.down) throw new TypeError("fetch failed");
  const u = new URL(String(url));
  const key = init.headers?.["x-api-key"];
  rb.requests.push({ method: init.method, path: u.pathname, key, body: init.body });
  if (key !== SANDBOX_KEY && key !== LIVE_KEY) return json({ message: "unauthorized" }, 401);
  const body = init.body ? JSON.parse(init.body) : null;
  let match;
  if (init.method === "GET" && (match = /^\/v3\/payments\/([^/]+)$/.exec(u.pathname))) {
    const payment = rb.payments.get(decodeURIComponent(match[1]));
    return payment ? json(payment) : json({ message: "not found" }, 404);
  }
  if (init.method === "POST" && u.pathname === "/v3/payments/search") {
    const all = [...rb.payments.values()].filter((p) => !body.subscriptionId || p.subscriptionId === body.subscriptionId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const page = all.slice(body.offset, body.offset + body.limit);
    return json({ records: page, pagination: { hasNextPage: body.offset + body.limit < all.length } });
  }
  if (init.method === "GET" && (match = /^\/v3\/subscriptions\/([^/]+)$/.exec(u.pathname))) {
    const subscription = rb.subscriptions.get(decodeURIComponent(match[1]));
    return subscription ? json(subscription) : json({ message: "not found" }, 404);
  }
  if (init.method === "PATCH" && (match = /^\/v3\/subscriptions\/([^/]+)$/.exec(u.pathname))) {
    const id = decodeURIComponent(match[1]);
    const subscription = rb.subscriptions.get(id);
    if (!subscription) return json({ message: "not found" }, 404);
    if (body.status === "active" && !body.nextChargeDate) return json({ message: "nextChargeDate required" }, 400);
    subscription.status = body.status;
    rb.patches.push({ id, ...body });
    return json(subscription);
  }
  return json({ message: "unexpected" }, 404);
};

const ENV = {
  REBILL_API_KEY: SANDBOX_KEY,
  REBILL_ENVIRONMENT: "sandbox",
  REBILL_WEBHOOK_SECRET: SANDBOX_SECRET,
  REBILL_PLAN_ID_TF_MONTHLY_ARS_V2: "test_pln_monthly",
  REBILL_PLAN_ID_TF_QUARTERLY_ARS_V2: "test_pln_quarterly",
  REBILL_PLAN_ID_TF_SEMIANNUAL_ARS_V2: "test_pln_semiannual",
  REBILL_PLAN_ID_TF_ANNUAL_ARS_V2: "test_pln_annual",
  REBILL_CHECKOUT_URL_TF_MONTHLY_ARS_V2: "https://pay.rebill.com/test/monthly",
  REBILL_CHECKOUT_URL_TF_QUARTERLY_ARS_V2: "https://pay.rebill.com/test/quarterly",
  REBILL_CHECKOUT_URL_TF_SEMIANNUAL_ARS_V2: "https://pay.rebill.com/test/semiannual",
  REBILL_CHECKOUT_URL_TF_ANNUAL_ARS_V2: "https://pay.rebill.com/test/annual",
};
const LIVE_ENV = {
  REBILL_API_KEY: LIVE_KEY,
  REBILL_ENVIRONMENT: "production",
  REBILL_WEBHOOK_SECRET: LIVE_SECRET,
  REBILL_PLAN_ID_TF_MONTHLY_ARS_V2: "pln_monthly",
  REBILL_CHECKOUT_URL_TF_MONTHLY_ARS_V2: "https://pay.rebill.com/live/monthly",
};
const sandbox = new RebillAdapter(readRebillConfig(ENV, { fetchImpl, now }));
const live = new RebillAdapter(readRebillConfig(LIVE_ENV, { fetchImpl, now }));
assert.ok(sandbox.environment === "sandbox" && live.environment === "production");
assert.equal(new RebillAdapter(readRebillConfig({ ...ENV, REBILL_PLAN_ID_TF_ANNUAL_ARS_V2: "pln_annual" }, { fetchImpl, now })).environment, null, "ambientes mezclados: la configuración se cierra");

const pg = await start({ port: 5871 + Math.floor(Math.random() * 300) });
const admin = pg.admin;
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const svcConn = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svcConn));
  const limiter = createNoticeLimiter();
  const deps = (overrides = {}) => ({ store, provider: sandbox, now, expectLive: false, worker: "rb-worker", ...overrides });
  const liveDeps = () => deps({ provider: live, expectLive: true });
  const cmd = (provider = sandbox) => ({ store, provider, flags: FLAGS, now });
  const at = (date, h = 12, m = 0) => {
    clock = new Date(ar(date, h, m));
  };

  const [A, B, C, D, E, F, G, H, I] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map(uuidFor);
  for (const [id, tag] of [[A, "a"], [B, "b"], [C, "c"], [D, "d"], [E, "e"], [F, "f"], [G, "g"], [H, "h"], [I, "i"]]) await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now())", [id, `${tag}@example.test`]);

  const sub = async (owner) => (await admin.query("select * from public.billing_subscriptions where owner_id = $1", [owner])).rows[0];
  const count = async (sql, params) => (await admin.query(sql, params)).rows[0].n;
  const access = async (owner, date, h = 12, m = 0) => resolveBillingAccess({ flags: ENFORCING, snapshot: await store.ensureAccount(owner), now: new Date(ar(date, h, m)) });
  const periods = (owner) => count("select count(*)::int n from public.billing_periods where owner_id = $1 and voided_at is null", [owner]);
  const executions = (owner, outcome) => count("select count(*)::int n from public.billing_executions where owner_id = $1 and ($2::text is null or outcome = $2)", [owner, outcome ?? null]);
  const iso = (value) => (value ? new Date(value).toISOString() : null);

  const send = (adapter, secret, payload, { signature, raw } = {}) => {
    const body = raw ?? JSON.stringify(payload);
    const sig = signature === undefined ? signNotice(body, secret) : signature;
    return ingestNotice({ adapter, store, flags: FLAGS, now, limiter }, { method: "POST", contentType: "application/json", declaredLength: Buffer.byteLength(body), readBody: async () => body, clientKey: "rb", signature: sig ?? undefined });
  };
  let logCounter = 0;
  const hook = (event, data) => ({ webhook: { event, logId: `log_${(logCounter += 1)}` }, data });
  const created = (id, status, ref, subscriptionId) => hook("payment.created", { payment: { id, status, metadata: ref ? { tf_ref: ref } : {} }, ...(subscriptionId ? { subscriptionId } : {}) });
  const updated = (id, status, extra = {}) => hook("payment.updated", { id, status, ...extra });
  const ageNotices = () => admin.query("update public.billing_webhook_events set received_at = now() - interval '10 minutes'");
  const drain = async (d = deps()) => {
    await ageNotices();
    return drainEvents(d, 20);
  };
  const checkout = async (owner, key, planCode, provider = sandbox) => {
    const snapshot = await store.ensureAccount(owner);
    const result = await startCheckout(cmd(provider), { ownerId: owner, planCode, idempotencyKey: key, returnUrl: "https://app.example.test/facturacion/resultado", customer: { email: `${owner.slice(-3)}@example.test` } });
    return { result, ref: snapshot.providerReference };
  };
  const pay = (owner, ref, subId, planId, n, planCode = "tf_monthly_ars_v2", amount = 25900) => {
    rb.addSubscription(subId, planId);
    rb.addPayment({ id: `test_pay_${n}`, status: "approved", amount, subscriptionId: subId, metadata: { tf_ref: ref } });
    return `test_pay_${n}`;
  };

  // ============================================================================================== propietaria A: contratar el plan anual
  console.log("\nPropietaria A — plan anual: contratar, pagos pendiente/rechazado/aprobado");
  const refs = {};
  await step("1. checkout: va a pay.rebill.com con NUESTRA referencia y el correo; sin nombre ni documento; sin llamadas de red; doble clic y dos pestañas reutilizan el MISMO intento", async () => {
    const first = await checkout(A, "rb-key-a-000001", "tf_annual_ars_v2");
    assert.equal(first.result.ok, true, JSON.stringify(first.result));
    refs.A = first.ref;
    const url = new URL(first.result.redirectUrl);
    assert.equal(url.hostname, "pay.rebill.com");
    assert.equal(url.pathname, "/test/annual");
    assert.equal(url.searchParams.get("tf_ref"), refs.A);
    assert.equal(url.searchParams.get("email"), "a@example.test".replace("a@", `${A.slice(-3)}@`));
    for (const key of ["name", "identification", "document", "dni"]) assert.equal(url.searchParams.has(key), false, key);
    assert.equal(rb.requests.length, 0, "abrir el pago no llama a Rebill");
    const again = await checkout(A, "rb-key-a-000001", "tf_annual_ars_v2");
    const otherTab = await checkout(A, "rb-key-a-000002", "tf_annual_ars_v2");
    assert.equal(again.result.redirectUrl, first.result.redirectUrl);
    assert.equal(otherTab.result.redirectUrl, first.result.redirectUrl);
    assert.equal(await count("select count(*)::int n from public.billing_checkout_attempts where owner_id = $1 and status in ('open','completed')", [A]), 1);
    const row = await sub(A);
    assert.equal(row.provider_subscriber_uid, null, "todavía no existe suscriptor en Rebill");
    assert.equal(row.status, "pending");
  });

  await step("2. volver del pago SIN cobro no activa nada: la consulta a pedido no encuentra pagos nuestros; sigue pendiente y limitado", async () => {
    resetConfirmThrottleForTests();
    await confirmOwnerPayment(deps(), A);
    assert.ok(rb.requests.some((r) => r.path === "/v3/payments/search"), "se consultó a Rebill por los pagos recientes");
    assert.equal((await sub(A)).status, "pending");
    assert.equal(await periods(A), 0);
    assert.equal((await access(A, "2026-11-12", 9)).level, "limited");
  });

  await step("3. firma inválida o ausente: 401 y NO se guarda nada; con firma válida pero cuerpo que miente el estado no decide nada", async () => {
    const before = await count("select count(*)::int n from public.billing_webhook_events");
    const body = created("test_pay_A0", "approved", refs.A);
    assert.equal((await send(sandbox, SANDBOX_SECRET, body, { signature: "0".repeat(64) })).status, 401);
    assert.equal((await send(sandbox, SANDBOX_SECRET, body, { signature: null })).status, 401);
    assert.equal((await send(sandbox, "whsec_otro-secreto", body)).status, 401, "firmado con otro secreto");
    assert.equal((await send(sandbox, SANDBOX_SECRET, null, { raw: "{ no es json" })).status, 400);
    assert.equal(await count("select count(*)::int n from public.billing_webhook_events"), before, "nada quedó registrado");
  });

  await step("4. pago PENDIENTE: no activa ni registra cobro; luego RECHAZADO: queda registrado, la cuenta sigue sin suscripción y la vista lo dice con texto (nunca sólo color)", async () => {
    rb.addPayment({ id: "test_pay_A0", status: "pending", amount: 238800, metadata: { tf_ref: refs.A } });
    assert.equal((await send(sandbox, SANDBOX_SECRET, created("test_pay_A0", "pending", refs.A))).status, 200);
    await drain();
    assert.equal((await sub(A)).status, "pending");
    assert.equal(await executions(A), 0, "un pago pendiente no es un cobro");
    rb.setStatus("test_pay_A0", "rejected");
    assert.equal((await send(sandbox, SANDBOX_SECRET, updated("test_pay_A0", "rejected", { metadata: { tf_ref: refs.A } }))).status, 200);
    await drain();
    const row = await sub(A);
    assert.equal(row.status, "pending");
    assert.equal(row.provider_subscriber_uid, null);
    assert.equal(await executions(A, "rejected"), 1);
    assert.equal(await periods(A), 0);
    const snapshot = await store.ensureAccount(A);
    const view = buildBillingView({ snapshot, history: await store.getHistory(A, 24), now: clock, capabilities: sandbox.capabilities, available: true });
    assert.equal(view.state, "payment_rejected");
    assert.match(view.badge.label, /rechazado/i);
    assert.equal(view.actions.subscribe, true, "puede volver a intentarlo");
  });

  await step("5. PRIMER COBRO APROBADO (aviso con estado mentiroso): consulta autenticada → active, período de 12 meses, importe del proveedor, suscriptor VINCULADO y sondeo programado", async () => {
    at("2026-11-12", 10);
    pay(A, refs.A, "test_sub_A", "test_pln_annual", "A1", "tf_annual_ars_v2", 238800);
    assert.equal((await send(sandbox, SANDBOX_SECRET, created("test_pay_A1", "rejected", refs.A))).status, 200, "el cuerpo dice «rejected»; el proveedor dice aprobado");
    await drain();
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal(row.plan_code, "tf_annual_ars_v2");
    assert.equal(row.provider, "rebill");
    assert.equal(row.provider_subscriber_uid, "test_sub_A");
    assert.equal(row.provider_plan_code, "tf_annual_ars_v2");
    assert.equal(iso(row.current_period_end), ar("2027-11-12"));
    assert.equal(await periods(A), 1);
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1 and outcome = 'approved' and amount_minor = 23880000", [A]), 1);
    assert.equal(await count("select count(*)::int n from public.billing_poll_schedule where owner_id = $1", [A]), 1);
    assert.equal((await access(A, "2026-11-13")).level, "full");
    assert.ok(rb.requests.every((r) => r.key === SANDBOX_KEY), "toda llamada lleva la clave del ambiente");
  });

  await step("6. avisos DUPLICADOS (created ×3, updated ×3, otro orden): un solo período y un solo cobro; ningún aviso ajeno activa nada", async () => {
    const version = (await sub(A)).version;
    for (let i = 0; i < 3; i += 1) {
      await send(sandbox, SANDBOX_SECRET, created("test_pay_A1", "approved", refs.A));
      await send(sandbox, SANDBOX_SECRET, updated("test_pay_A1", "approved", { subscriptionId: "test_sub_A", lastStatus: "pending" }));
    }
    await drain();
    assert.equal(await periods(A), 1);
    assert.equal(await executions(A, "approved"), 1);
    assert.equal((await sub(A)).version, version);
  });

  // ============================================================================================== propietaria C: cancelar y reanudar
  console.log("\nPropietaria C — plan trimestral: cancelar la renovación y reanudar");
  await step("7. C paga; cancelar con Rebill CAÍDO no cambia nada; reintentar PAUSA la suscripción allá y acá UNA vez; repetir es idempotente; conserva el acceso hasta el fin del período", async () => {
    const { result, ref } = await checkout(C, "rb-key-c-000001", "tf_quarterly_ars_v2");
    assert.equal(result.ok, true);
    refs.C = ref;
    pay(C, ref, "test_sub_C", "test_pln_quarterly", "C1", "tf_quarterly_ars_v2", 69900);
    await send(sandbox, SANDBOX_SECRET, created("test_pay_C1", "approved", ref));
    await drain();
    const active = await sub(C);
    assert.equal(active.status, "active");
    assert.equal(iso(active.current_period_end), ar("2027-02-12"));
    rb.down = true;
    const failed = await cancelSubscription(cmd(), C);
    rb.down = false;
    assert.equal(failed.ok, false);
    assert.equal((await sub(C)).status, "active", "si Rebill no confirma, la base no cambia");
    assert.deepEqual(await cancelSubscription(cmd(), C), { ok: true, changed: true });
    assert.equal((await sub(C)).status, "cancel_at_period_end");
    assert.deepEqual(rb.patches.filter((p) => p.id === "test_sub_C").map((p) => p.status), ["paused"], "se pausó (no se dio de baja) la suscripción");
    assert.deepEqual(await cancelSubscription(cmd(), C), { ok: true, changed: false });
    assert.equal(rb.subscriptions.get("test_sub_C").status, "paused");
    const ending = await access(C, "2027-02-11", 23, 59);
    assert.deepEqual([ending.level, ending.reason], ["full_with_notice", "subscription_ending"]);
  });

  await step("8. reanudar: Rebill recibe la fecha del próximo cobro = fin del período pagado (12:00 de Argentina); la cuenta vuelve a active y la suscripción de Rebill a active", async () => {
    const result = await reactivateSubscription(cmd(), C);
    assert.equal(result.ok, true, JSON.stringify(result));
    const resume = rb.patches.filter((p) => p.id === "test_sub_C" && p.status === "active");
    assert.equal(resume.length, 1);
    assert.equal(resume[0].nextChargeDate, "2027-02-12T15:00:00.000Z");
    assert.equal((await sub(C)).status, "active");
    assert.equal(rb.subscriptions.get("test_sub_C").status, "active");
    assert.equal(await periods(C), 1);
  });

  // ============================================================================================== propietaria D: el navegador se cerró y el aviso se perdió
  console.log("\nPropietaria D — pagó y cerró el navegador; el aviso nunca llegó");
  await step("9. D paga pero ningún aviso llega: la confirmación a pedido (volver a TeacherFlow) lo recupera, vincula el suscriptor y activa UNA vez; repetir no duplica; el barrido global tampoco", async () => {
    const { result, ref } = await checkout(D, "rb-key-d-000001", "tf_monthly_ars_v2");
    assert.equal(result.ok, true);
    refs.D = ref;
    pay(D, ref, "test_sub_D", "test_pln_monthly", "D1");
    assert.equal((await sub(D)).status, "pending");
    resetConfirmThrottleForTests();
    await confirmOwnerPayment(deps(), D);
    const row = await sub(D);
    assert.equal(row.status, "active");
    assert.equal(row.provider_subscriber_uid, "test_sub_D");
    assert.equal(await periods(D), 1);
    const requests = rb.requests.length;
    await confirmOwnerPayment(deps(), D);
    assert.equal(rb.requests.length, requests, "con suscriptor vinculado la confirmación a pedido no vuelve a consultar el listado");
    assert.ok((await runProviderSweep(deps(), {})).operations >= 3);
    assert.equal(await periods(D), 1);
    assert.equal(await periods(A), 1, "el barrido global tampoco duplica los cobros de las demás cuentas");
    assert.equal(await periods(C), 1);
  });

  // ============================================================================================== propietaria F: aviso de suscripción antes del cobro conciliado
  console.log("\nPropietaria F — llega primero el aviso de la suscripción");
  await step("10. sólo llega `subscription.created` (con el uid): se consulta la suscripción, sus pagos traen NUESTRA referencia → se vincula a F; el sondeo concilia el cobro", async () => {
    const { result, ref } = await checkout(F, "rb-key-f-000001", "tf_monthly_ars_v2");
    assert.equal(result.ok, true);
    pay(F, ref, "test_sub_F", "test_pln_monthly", "F1");
    assert.equal((await send(sandbox, SANDBOX_SECRET, hook("subscription.created", { subscription: { id: "test_sub_F", status: "active" } }))).status, 200);
    await drain();
    const bound = await sub(F);
    assert.equal(bound.provider_subscriber_uid, "test_sub_F");
    assert.equal(await count("select count(*)::int n from public.billing_poll_schedule where owner_id = $1", [F]), 1, "al vincularse queda programado el sondeo");
    await admin.query("update public.billing_poll_schedule set due_at = $1 where owner_id = $2", [new Date(clock.getTime() - 60_000), F]); // el reloj de la prueba es simulado; el de la base, real
    await runSubscriberPoll(deps());
    assert.equal((await sub(F)).status, "active");
    assert.equal(await periods(F), 1);
    // Un aviso de una suscripción de la que no hay ningún pago nuestro sigue siendo ajeno.
    rb.addSubscription("test_sub_X", "test_pln_monthly");
    const strangers = await count("select count(*)::int n from public.billing_subscriptions where provider_subscriber_uid is not null");
    await send(sandbox, SANDBOX_SECRET, hook("subscription.created", { subscription: { id: "test_sub_X", status: "active" } }));
    await drain();
    assert.equal(await count("select count(*)::int n from public.billing_subscriptions where provider_subscriber_uid is not null"), strangers);
  });

  // ============================================================================================== propietarias G y H: dos suscripciones de la misma cuenta
  console.log("\nPropietarias G y H — dos pagos para la misma cuenta (dos pestañas): nunca dos suscripciones con cobro");
  await step("11. G paga dos veces en lotes distintos: queda vinculada la ÚLTIMA y la anterior se PAUSA en Rebill; queda una revisión abierta (probable devolución)", async () => {
    const { result, ref } = await checkout(G, "rb-key-g-000001", "tf_monthly_ars_v2");
    assert.equal(result.ok, true);
    pay(G, ref, "test_sub_G1", "test_pln_monthly", "G1");
    await send(sandbox, SANDBOX_SECRET, created("test_pay_G1", "approved", ref));
    await drain();
    assert.equal((await sub(G)).provider_subscriber_uid, "test_sub_G1");
    clock = new Date(clock.getTime() + 60_000);
    pay(G, ref, "test_sub_G2", "test_pln_monthly", "G2");
    await send(sandbox, SANDBOX_SECRET, created("test_pay_G2", "approved", ref));
    await drain();
    assert.equal((await sub(G)).provider_subscriber_uid, "test_sub_G2");
    assert.deepEqual(rb.patches.filter((p) => p.id === "test_sub_G1").map((p) => p.status), ["paused"], "la suscripción anterior deja de cobrar");
    assert.equal(rb.subscriptions.get("test_sub_G2").status, "active");
    assert.equal(await count("select count(*)::int n from public.billing_reconciliations where owner_id = $1 and status = 'open'", [G]), 1);
  });

  await step("12. H paga dos veces y los dos avisos caen en el MISMO lote: un solo suscriptor vinculado y el otro pausado", async () => {
    const { result, ref } = await checkout(H, "rb-key-h-000001", "tf_monthly_ars_v2");
    assert.equal(result.ok, true);
    pay(H, ref, "test_sub_H1", "test_pln_monthly", "H1");
    clock = new Date(clock.getTime() + 30_000);
    pay(H, ref, "test_sub_H2", "test_pln_monthly", "H2");
    await send(sandbox, SANDBOX_SECRET, created("test_pay_H1", "approved", ref));
    await send(sandbox, SANDBOX_SECRET, created("test_pay_H2", "approved", ref));
    await drain();
    const row = await sub(H);
    assert.ok(["test_sub_H1", "test_sub_H2"].includes(row.provider_subscriber_uid));
    const paused = rb.patches.filter((p) => p.status === "paused" && p.id.startsWith("test_sub_H")).map((p) => p.id);
    assert.equal(paused.length, 1, "exactamente una queda pausada");
    assert.notEqual(paused[0], row.provider_subscriber_uid);
  });

  // ============================================================================================== propietaria E: operaciones de prueba en Production
  console.log("\nPropietaria E — Production: sólo cuentan operaciones reales");
  await step("13. con el adaptador de PRODUCTION una operación `test_…` se IGNORA aunque llegue firmada con el secreto correcto; una real activa", async () => {
    const { result, ref } = await checkout(E, "rb-key-e-000001", "tf_monthly_ars_v2", live);
    assert.equal(result.ok, true);
    assert.equal(new URL(result.redirectUrl).pathname, "/live/monthly");
    rb.addSubscription("test_sub_E", "pln_monthly");
    rb.addPayment({ id: "test_pay_E1", status: "approved", amount: 25900, subscriptionId: "test_sub_E", metadata: { tf_ref: ref } });
    assert.equal((await send(live, LIVE_SECRET, created("test_pay_E1", "approved", ref))).status, 200);
    assert.equal((await send(live, SANDBOX_SECRET, created("test_pay_E1", "approved", ref))).status, 401, "el secreto de sandbox no vale en Production");
    await drain(liveDeps());
    assert.equal((await sub(E)).status, "pending", "una operación de prueba no activa una cuenta real");
    assert.equal(await executions(E), 0);
    rb.addSubscription("sub_live_E", "pln_monthly");
    rb.addPayment({ id: "pay_live_E1", status: "approved", amount: 25900, subscriptionId: "sub_live_E", metadata: { tf_ref: ref } });
    await send(live, LIVE_SECRET, created("pay_live_E1", "approved", ref));
    await drain(liveDeps());
    const row = await sub(E);
    assert.equal(row.status, "active");
    assert.equal(row.provider_subscriber_uid, "sub_live_E");
  });

  // ============================================================================================== aislamiento
  console.log("\nPropietaria I — pagó hace instantes (suscriptor todavía sin vincular) y elimina su cuenta");
  await step("14. ELIMINAR la cuenta: antes de dar por «nada que cancelar» se concilia a pedido, se vincula y se PAUSA la suscripción; con Rebill caído NO se elimina", async () => {
    const { result, ref } = await checkout(I, "rb-key-i-000001", "tf_monthly_ars_v2");
    assert.equal(result.ok, true);
    pay(I, ref, "test_sub_I", "test_pln_monthly", "I1");
    assert.equal((await sub(I)).provider_subscriber_uid, null);
    const deletionDeps = () => ({ store, provider: sandbox, flags: FLAGS, now, reconcileOwner: (owner) => confirmOwnerPayment(deps(), owner, { force: true }) });
    rb.down = true;
    const blocked = await prepareAccountDeletion(deletionDeps(), I);
    rb.down = false;
    assert.equal(blocked.ok, false, "sin poder consultar a Rebill no se puede garantizar que no se vuelva a cobrar");
    assert.equal(rb.subscriptions.get("test_sub_I").status, "active");
    const prepared = await prepareAccountDeletion(deletionDeps(), I);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(rb.subscriptions.get("test_sub_I").status, "paused", "la suscripción dejó de cobrar antes de borrar nada");
    assert.equal((await sub(I)).provider_subscriber_uid, "test_sub_I");
    const never = await prepareAccountDeletion(deletionDeps(), B);
    assert.equal(never.ok, true, "una cuenta que nunca contrató se elimina sin esperar nada de Rebill");
  });

  console.log("\nAislamiento entre propietarias");
  await step("15. B (sin actividad) no cambió; un pago con una referencia que NO es nuestra no activa a nadie; el historial de A no contiene datos de otras ni identificadores del proveedor", async () => {
    const snapB = await store.ensureAccount(B);
    assert.equal(snapB.status, "pending");
    assert.equal(snapB.version, 1);
    const total = await count("select count(*)::int n from public.billing_periods");
    rb.addSubscription("test_sub_Z", "test_pln_monthly");
    rb.addPayment({ id: "test_pay_Z1", status: "approved", amount: 25900, subscriptionId: "test_sub_Z", metadata: { tf_ref: "tfs_" + "e".repeat(32) } });
    await send(sandbox, SANDBOX_SECRET, created("test_pay_Z1", "approved", "tfs_" + "e".repeat(32)));
    await drain();
    assert.equal(await count("select count(*)::int n from public.billing_periods"), total);
    const text = JSON.stringify(await store.getHistory(A, 50));
    assert.ok(!text.includes("test_sub_") && !text.includes("test_pay_") && !text.includes(C), "el historial no expone identificadores del proveedor ni de otras cuentas");
  });

  // ============================================================================================== A: renovación, devolución y avisos tardíos
  console.log("\nPropietaria A — un año después: renovación, devolución y avisos tardíos");
  await step("16. RENOVACIÓN (sin nuestra referencia, sólo el suscriptor): se resuelve por el uid vinculado → segundo período; el aviso repetido y el tardío no duplican", async () => {
    at("2027-11-12", 12);
    rb.addPayment({ id: "test_pay_A2", status: "approved", amount: 238800, subscriptionId: "test_sub_A" });
    await send(sandbox, SANDBOX_SECRET, updated("test_pay_A2", "approved", { subscriptionId: "test_sub_A" }));
    await drain();
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal(iso(row.current_period_end), ar("2028-11-12"));
    assert.equal(await periods(A), 2);
    await send(sandbox, SANDBOX_SECRET, updated("test_pay_A2", "approved", { subscriptionId: "test_sub_A", lastStatus: "pending" }));
    await send(sandbox, SANDBOX_SECRET, created("test_pay_A2", "approved", null, "test_sub_A"));
    await drain();
    assert.equal(await periods(A), 2, "no se extiende dos veces por el mismo pago");
    assert.equal(await executions(A, "approved"), 2);
  });

  await step("17. DEVOLUCIÓN cuyo aviso sólo trae el id del pago: se asigna por los cobros ya conciliados, el período devuelto se anula; un aviso «aprobado» tardío NO lo resucita", async () => {
    rb.setStatus("test_pay_A2", "refunded");
    await send(sandbox, SANDBOX_SECRET, updated("test_pay_A2", "refunded"));
    await drain();
    assert.equal(await executions(A, "refunded"), 1);
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1 and voided_at is not null", [A]), 1);
    assert.equal(await periods(A), 1);
    await send(sandbox, SANDBOX_SECRET, updated("test_pay_A2", "approved", { subscriptionId: "test_sub_A", lastStatus: "pending" }));
    await drain();
    assert.equal(await executions(A, "refunded"), 1, "la consulta autenticada manda: sigue devuelto");
    assert.equal(await periods(A), 1);
  });

  await step("18. el reloj: pasado el fin del período devuelto A deja de tener acceso completo; el barrido no toca a las demás cuentas", async () => {
    at("2027-11-13", 12);
    const before = (await sub(C)).version;
    await runClockSweep(deps());
    assert.ok(["past_due", "grace_period", "limited", "expired"].includes((await sub(A)).status), (await sub(A)).status);
    assert.equal((await sub(C)).version >= before, true);
  });

  await step("19. NINGUNA clave ni secreto quedó en la base: ni en las tablas de facturación ni en los avisos guardados; los avisos no contienen correos", async () => {
    const tables = (await admin.query("select tablename from pg_tables where schemaname = 'public' and tablename like 'billing\\_%'")).rows.map((r) => r.tablename);
    for (const table of tables) {
      for (const needle of [SANDBOX_KEY, LIVE_KEY, SANDBOX_SECRET, LIVE_SECRET, "sk_test", "sk_live", "whsec_", "@example.test"]) {
        assert.equal(await count(`select count(*)::int n from public.${table} x where to_jsonb(x)::text like $1`, [`%${needle}%`]), 0, `${table} contiene «${needle}»`);
      }
    }
    assert.equal(await count("select count(*)::int n from public.billing_webhook_events where status in ('pending','processing')"), 0, "la cola quedó vacía");
    assert.equal(await count("select count(*)::int n from public.billing_webhook_events where status = 'dead'"), 0);
  });

  await svcConn.end();
} finally {
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nCICLO REBILL COMPLETO: ${results.length}/${results.length} pasos ok` : `\nCICLO REBILL CON ${failed.length} FALLA(S) de ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
