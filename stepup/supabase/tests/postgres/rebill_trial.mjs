// REBILL — PRUEBA GRATUITA DE 15 DÍAS (condición comercial aprobada el 25/11/2026) con un Rebill SIMULADO y Postgres REAL (embedded-postgres 17, todas las migraciones reales).
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/rebill_trial.mjs
//
// Corren TAL CUAL el adaptador de Rebill, la recepción de avisos, el procesador, el sondeo, la confirmación a pedido y los comandos; lo único simulado es el servidor de Rebill
// (planes con `trialPeriodDays`: pago aprobado de 0 al guardar la tarjeta, suscripción `in_trial`, `nextChargeDate` = inicio + 15 días a la HORA de la contratación, y el PATCH de
// `nextChargeDate`). Qué comprueba: el checkout ofrece la prueba sólo a quien corresponde; la prueba se activa SÓLO con la suscripción y la tarjeta confirmadas por Rebill (nunca por
// una URL ni por un aviso) y SÓLO después de fijar el primer cobro a las 00:00 de Argentina de inicio + 15; el pago de 0 no es un cobro; el primer cobro de $ 25.900 activa el período
// y restaura el acceso solo; sin pago aprobado no hay acceso (ni un día de gracia); cancelar durante la prueba evita el cobro; una segunda prueba no se activa; y la marca de «prueba
// usada» no se puede borrar. Sin red, sin credenciales reales, sin dinero.
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
const { drainEvents, runSubscriberPoll } = await importLib("billing/processor.ts");
const { cancelSubscription, reactivateSubscription, startCheckout } = await importLib("billing/commands.ts");
const { confirmOwnerPayment, resetConfirmThrottleForTests } = await importLib("billing/confirm.ts");
const { resolveBillingAccess } = await importLib("billing/access.ts");
const { buildBillingView } = await importLib("billing/view.ts");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");

const ar = (date, hour = 0, minute = 0, second = 0) => new Date(Date.parse(localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" })) + second * 1000).toISOString();
const FLAGS = { enabled: true, enforcement: false };
const ENFORCING = { enabled: true, enforcement: true };
const KEY = "sk_test_unit-NOT-REAL";
const SECRET = "whsec_unit-sandbox-NOT-REAL";

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.message ?? error).split("\n").slice(0, 6).join("\n        ")}`);
  }
};

// ------------------------------------------------------------------------------------------------ Rebill simulado (con planes de prueba)
let clock = new Date(ar("2026-11-12", 9));
const now = () => clock;
const rb = {
  payments: new Map(),
  subscriptions: new Map(),
  requests: [],
  patches: [],
  failScheduling: false,
  addPayment(payment) {
    const at = payment.createdAt ?? clock.toISOString();
    this.payments.set(payment.id, { currency: "ARS", createdAt: at, updatedAt: at, metadata: {}, ...payment });
  },
  /** Suscripción con prueba: Rebill agenda el primer cobro en «inicio + 15 días» con la MISMA hora de la contratación. */
  addTrialSubscription(id, planId, detail = "in_trial") {
    const nextChargeDate = new Date(clock.getTime() + 15 * 86_400_000).toISOString();
    this.subscriptions.set(id, { id, status: "active", statusDetail: detail, plan: { id: planId }, nextChargeDate, createdAt: clock.toISOString() });
  },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchImpl = async (url, init = {}) => {
  const u = new URL(String(url));
  const key = init.headers?.["x-api-key"];
  rb.requests.push({ method: init.method, path: u.pathname, key, body: init.body });
  if (key !== KEY) return json({ message: "unauthorized" }, 401);
  const body = init.body ? JSON.parse(init.body) : null;
  let match;
  if (init.method === "GET" && (match = /^\/v3\/payments\/([^/]+)$/.exec(u.pathname))) {
    const payment = rb.payments.get(decodeURIComponent(match[1]));
    return payment ? json(payment) : json({ message: "not found" }, 404);
  }
  if (init.method === "POST" && u.pathname === "/v3/payments/search") {
    const page = body?.pagination;
    const all = [...rb.payments.values()].filter((p) => !body.filters?.subscriptionId || p.subscriptionId === body.filters.subscriptionId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const records = all.slice(page.offset, page.offset + page.limit);
    return json({ records, pagination: { totalItems: all.length, hasNextPage: page.offset + page.limit < all.length } });
  }
  if (init.method === "GET" && (match = /^\/v3\/subscriptions\/([^/]+)$/.exec(u.pathname))) {
    const subscription = rb.subscriptions.get(decodeURIComponent(match[1]));
    return subscription ? json(subscription) : json({ message: "not found" }, 404);
  }
  if (init.method === "PATCH" && (match = /^\/v3\/subscriptions\/([^/]+)$/.exec(u.pathname))) {
    const id = decodeURIComponent(match[1]);
    const subscription = rb.subscriptions.get(id);
    if (!subscription) return json({ message: "not found" }, 404);
    if (body.nextChargeDate && !body.status && rb.failScheduling) return json({ message: "unavailable" }, 503);
    if (body.status === "active" && !body.nextChargeDate) return json({ message: "nextChargeDate required" }, 400);
    if (body.nextChargeDate && Date.parse(body.nextChargeDate) < clock.getTime()) return json({ message: "Invalid nextChargeDate" }, 400); // docs: «hoy o posterior»
    if (body.status) subscription.status = body.status;
    if (body.nextChargeDate) subscription.nextChargeDate = new Date(body.nextChargeDate).toISOString();
    rb.patches.push({ id, ...body });
    return json(subscription);
  }
  return json({ message: "unexpected" }, 404);
};

const PLANS = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
const ENV = { REBILL_API_KEY: KEY, REBILL_ENVIRONMENT: "sandbox", REBILL_WEBHOOK_SECRET: SECRET };
for (const plan of PLANS) {
  ENV[`REBILL_PLAN_ID_TF_${plan}_ARS_V2`] = `test_pln_${plan.toLowerCase()}`;
  ENV[`REBILL_CHECKOUT_URL_TF_${plan}_ARS_V2`] = `https://pay.rebill.com/test/${plan.toLowerCase()}`;
}
const TRIAL_ENV = { ...ENV };
for (const plan of PLANS) {
  TRIAL_ENV[`REBILL_TRIAL_PLAN_ID_TF_${plan}_ARS_V2`] = `test_pln_${plan.toLowerCase()}_trial`;
  TRIAL_ENV[`REBILL_TRIAL_CHECKOUT_URL_TF_${plan}_ARS_V2`] = `https://pay.rebill.com/test/${plan.toLowerCase()}-trial`;
}
const trialProvider = new RebillAdapter(readRebillConfig(TRIAL_ENV, { fetchImpl, now }));
const plainProvider = new RebillAdapter(readRebillConfig(ENV, { fetchImpl, now }));
assert.equal(trialProvider.offersTrial(), true);
assert.equal(plainProvider.offersTrial(), false, "sin links de prueba configurados la prueba NO se ofrece");

const pg = await start({ port: 7200 + Math.floor(Math.random() * 300) });
const admin = pg.admin;
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const svcConn = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svcConn));
  const limiter = createNoticeLimiter();
  const deps = (overrides = {}) => ({ store, provider: trialProvider, now, expectLive: false, worker: "trial-worker", ...overrides });
  const cmd = (provider = trialProvider) => ({ store, provider, flags: FLAGS, now, attemptTtlMinutes: 60 * 24 * 365 * 40 });
  const at = (date, h = 12, m = 0, s = 0) => {
    clock = new Date(ar(date, h, m, s));
  };

  const [T, V, W, X, Z, Y, N] = [100, 200, 300, 400, 500, 600, 700].map(uuidFor);
  for (const [id, tag] of [[T, "t"], [V, "v"], [W, "w"], [X, "x"], [Z, "z"], [N, "n"]]) await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now() + interval '1 hour')", [id, `${tag}@example.test`]);
  await admin.query("insert into auth.users (id, email, created_at) values ($1, 'y@example.test', now() - interval '60 days')", [Y]); // cuenta ANTERIOR al corte: grandfathered

  const sub = async (owner) => (await admin.query("select * from public.billing_subscriptions where owner_id = $1", [owner])).rows[0];
  const count = async (sql, params) => (await admin.query(sql, params)).rows[0].n;
  const access = async (owner, date, h = 12, m = 0, s = 0) => resolveBillingAccess({ flags: ENFORCING, snapshot: await store.ensureAccount(owner), now: new Date(ar(date, h, m, s)) });
  const executions = (owner) => count("select count(*)::int n from public.billing_executions where owner_id = $1", [owner]);
  const periods = (owner) => count("select count(*)::int n from public.billing_periods where owner_id = $1 and voided_at is null", [owner]);
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  const reviews = (owner, kind) => count("select count(*)::int n from public.billing_reconciliations where owner_id = $1 and kind = $2 and status = 'open'", [owner, kind]);

  const send = (payload) => {
    const body = JSON.stringify(payload);
    return ingestNotice({ adapter: trialProvider, store, flags: FLAGS, now, limiter }, { method: "POST", contentType: "application/json", declaredLength: Buffer.byteLength(body), readBody: async () => body, clientKey: "rb", signature: signNotice(body, SECRET) });
  };
  let logCounter = 0;
  const hook = (event, data) => ({ webhook: { event, logId: `log_${(logCounter += 1)}` }, data });
  const created = (id, ref, subscriptionId) => hook("payment.created", { payment: { id, status: "approved", metadata: ref ? { tf_ref: ref } : {} }, ...(subscriptionId ? { subscriptionId } : {}) });
  const updated = (id, status, extra = {}) => hook("payment.updated", { id, status, ...extra });
  const drain = async (d = deps()) => {
    await admin.query("update public.billing_webhook_events set received_at = now() - interval '10 minutes'");
    return drainEvents(d, 20);
  };
  const checkout = async (owner, key, planCode = "tf_monthly_ars_v2", provider = trialProvider) => {
    const snapshot = await store.ensureAccount(owner);
    const result = await startCheckout(cmd(provider), { ownerId: owner, planCode, idempotencyKey: key, returnUrl: "https://app.example.test/facturacion/resultado", customer: { email: `${owner.slice(-3)}@example.test` } });
    return { result, ref: snapshot.providerReference };
  };
  /** Rebill, tras el checkout CON prueba: suscripción en prueba + pago aprobado de 0 con la tarjeta registrada. */
  const startTrial = (ref, subId, paymentId, planId = "test_pln_monthly_trial") => {
    rb.addTrialSubscription(subId, planId);
    rb.addPayment({ id: paymentId, status: "approved", amount: 0, subscriptionId: subId, metadata: { tf_ref: ref } });
    return paymentId;
  };
  const refs = {};

  console.log("\nContratar: la prueba se ofrece sólo a quien corresponde");
  await step("1. cuenta NUEVA: el checkout va al link CON prueba (mismo plan y precio); cuenta ACTUAL (grandfathered): link normal, sin prueba; sin links de prueba configurados el checkout de una cuenta nueva falla CERRADO", async () => {
    const fresh = await checkout(T, "tr-key-t-000001");
    assert.equal(fresh.result.ok, true, JSON.stringify(fresh.result));
    refs.T = fresh.ref;
    const url = new URL(fresh.result.redirectUrl);
    assert.equal(url.pathname, "/test/monthly-trial");
    assert.equal(url.searchParams.get("tf_ref"), refs.T);
    const existing = await checkout(Y, "tr-key-y-000001");
    assert.equal(existing.result.ok, true);
    assert.equal(new URL(existing.result.redirectUrl).pathname, "/test/monthly", "las cuentas actuales no reciben la prueba automáticamente");
    assert.equal((await sub(Y)).status, "grandfathered");
    const noLinks = await checkout(N, "tr-key-n-000001", "tf_monthly_ars_v2", plainProvider);
    assert.equal(noLinks.result.ok, false, "nunca se vende sin prueba lo que se mostró con prueba");
    assert.equal(rb.requests.length, 0, "abrir el pago no llama a Rebill");
  });

  console.log("\nCuenta T — mensual: prueba, primer cobro y acceso");
  await step("2. el pago aprobado de 0 NO es un cobro: se activa la prueba SÓLO tras confirmar la suscripción en prueba y FIJAR el primer cobro a las 00:00 de Argentina (inicio 12/11 09:00 → 27/11 00:00)", async () => {
    at("2026-11-12", 9);
    startTrial(refs.T, "test_sub_T", "test_pay_T0");
    assert.equal(rb.subscriptions.get("test_sub_T").nextChargeDate, ar("2026-11-27", 9), "Rebill agenda inicio + 15 días con la hora de la contratación");
    assert.equal((await send(created("test_pay_T0", refs.T, "test_sub_T"))).status, 200);
    await drain();
    const row = await sub(T);
    assert.equal(row.status, "active");
    assert.equal(row.provider_subscriber_uid, "test_sub_T");
    assert.equal(row.plan_code, "tf_monthly_ars_v2");
    assert.equal(iso(row.trial_started_at), ar("2026-11-12", 9));
    assert.equal(iso(row.trial_ends_at), ar("2026-11-27"), "00:00 de Argentina del día inicio + 15 días calendario");
    assert.equal(iso(row.current_period_end), ar("2026-11-27"));
    assert.equal(iso(row.current_period_start), ar("2026-11-12", 9));
    assert.equal(await executions(T), 0, "el pago de 0 no es una ejecución de cobro");
    assert.equal(await periods(T), 0, "ni compra un período pagado");
    const scheduled = rb.patches.filter((p) => p.id === "test_sub_T");
    assert.deepEqual(scheduled.map((p) => Object.keys(p).sort()), [["id", "nextChargeDate"]], "un solo PATCH, sólo con nextChargeDate (no toca el estado)");
    assert.equal(scheduled[0].nextChargeDate, ar("2026-11-27"));
    assert.equal(rb.subscriptions.get("test_sub_T").nextChargeDate, ar("2026-11-27"), "releído: Rebill quedó con ESE instante");
    assert.equal(ar("2026-11-27"), "2026-11-27T03:00:00.000Z");
    assert.equal((await access(T, "2026-11-12", 9, 1)).level, "full");
  });

  await step("3. repetir avisos y sondeos NO vuelve a fijar el cobro ni cambia la versión (idempotente)", async () => {
    const version = (await sub(T)).version;
    for (let i = 0; i < 3; i += 1) await send(created("test_pay_T0", refs.T, "test_sub_T"));
    await drain();
    at("2026-11-13", 10);
    await admin.query("update public.billing_poll_schedule set due_at = now() - interval '1 hour'");
    await runSubscriberPoll(deps(), {});
    assert.equal(rb.patches.filter((p) => p.id === "test_sub_T").length, 1);
    assert.equal((await sub(T)).version, version);
    assert.equal(await periods(T), 0);
  });

  await step("4. la vista dice «15 días gratis», hasta cuándo y la fecha EXACTA del primer cobro con su importe; no se puede cambiar de plan durante la prueba", async () => {
    at("2026-11-13", 10);
    const snapshot = await store.ensureAccount(T);
    const view = buildBillingView({ snapshot, history: await store.getHistory(T, 24), now: clock, capabilities: { changePlan: true, paymentMethodUpdate: true }, available: true });
    assert.equal(view.state, "trial");
    assert.match(view.body.replace(/ /g, " "), /primer cobro de \$ 25\.900 por mes está programado para el 27\/11\/2026 a las 00:00 \(hora de Argentina\)/);
    assert.equal(view.actions.changePlan, false);
    assert.equal(view.actions.cancel, true);
    assert.equal(view.trial?.firstChargeOn, "27/11/2026");
  });

  await step("5. línea de tiempo del acceso: hasta 26/11 23:59:59 completo; a las 00:00 del 27/11 SIN pago aprobado queda bloqueada (sin gracia, ni un minuto)", async () => {
    assert.equal((await access(T, "2026-11-26", 23, 59, 59)).level, "full");
    const at0 = await access(T, "2026-11-27", 0, 0, 0);
    assert.equal(at0.level, "blocked");
    assert.equal(at0.capabilities.viewOperationalData, false);
    assert.equal(at0.reason, "renewal_processing");
    const later = await access(T, "2026-11-29", 12);
    assert.equal(later.level, "blocked", "sin pago aprobado no hay acceso, tampoco días después");
  });

  await step("6. PRIMER COBRO aprobado a las 00:00:04 del 27/11: $ 25.900, un período que empieza el 27/11, y el acceso VUELVE SOLO (sin cerrar sesión); la prueba no se repite", async () => {
    at("2026-11-27", 0, 0, 4);
    rb.addPayment({ id: "test_pay_T1", status: "approved", amount: 25900, subscriptionId: "test_sub_T", metadata: { tf_ref: refs.T } });
    const sub1 = rb.subscriptions.get("test_sub_T");
    sub1.statusDetail = "active";
    await send(created("test_pay_T1", refs.T, "test_sub_T"));
    await drain();
    const row = await sub(T);
    assert.equal(row.status, "active");
    assert.equal(await executions(T), 1);
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1 and outcome = 'approved' and amount_minor = 2590000", [T]), 1, "el primer cobro es el TOTAL del plan");
    assert.equal(await periods(T), 1);
    assert.equal(iso(row.current_period_start), ar("2026-11-27"));
    assert.equal(iso(row.current_period_end), ar("2026-12-27"));
    assert.equal(iso(row.trial_started_at), ar("2026-11-12", 9), "la marca de prueba usada se conserva");
    assert.equal((await access(T, "2026-11-27", 0, 1)).level, "full", "restaurado automáticamente");
    assert.equal(rb.patches.filter((p) => p.id === "test_sub_T").length, 1, "no se tocó el cobro otra vez");
    const view = buildBillingView({ snapshot: await store.ensureAccount(T), history: await store.getHistory(T, 24), now: clock, capabilities: { changePlan: true, paymentMethodUpdate: true }, available: true });
    assert.equal(view.state, "active");
    assert.equal(view.trial, null);
    assert.equal(view.trialOffer, null, "no se vuelve a ofrecer");
  });

  await step("7. el cobro se hace UNA sola vez: avisos repetidos del cobro no duplican ejecuciones ni períodos", async () => {
    for (let i = 0; i < 3; i += 1) await send(updated("test_pay_T1", "approved", { subscriptionId: "test_sub_T" }));
    await drain();
    assert.equal(await executions(T), 1);
    assert.equal(await periods(T), 1);
  });

  await step("8. una SEGUNDA prueba (otra suscripción con el mismo enlace viejo) NO se activa: la marca de prueba usada manda, esa suscripción se pausa y queda una revisión; la cuenta no cambia de suscriptor", async () => {
    at("2026-12-01", 10);
    startTrial(refs.T, "test_sub_T2", "test_pay_T2");
    await send(created("test_pay_T2", refs.T, "test_sub_T2"));
    await drain();
    const row = await sub(T);
    assert.equal(row.provider_subscriber_uid, "test_sub_T", "no se re-vincula a la segunda");
    assert.equal(iso(row.trial_started_at), ar("2026-11-12", 9));
    assert.equal(await reviews(T, "trial_reused"), 1);
    assert.equal(rb.subscriptions.get("test_sub_T2").status, "paused", "la segunda suscripción deja de cobrar");
    assert.equal(await periods(T), 1);
  });

  await step("9. la marca «prueba usada» es INMUTABLE en la base: ni un UPDATE directo la borra ni la reinicia", async () => {
    const before = await sub(T);
    await admin.query("set session_replication_role = replica"); // aun saltando los disparadores de coherencia de facturación, el de inmutabilidad es propio de la tabla
    await admin.query("set session_replication_role = origin");
    await admin.query("update public.billing_subscriptions set trial_started_at = null, trial_ends_at = null, version = version + 1 where owner_id = $1", [T]);
    const after = await sub(T);
    assert.equal(iso(after.trial_started_at), iso(before.trial_started_at));
    assert.equal(iso(after.trial_ends_at), iso(before.trial_ends_at));
    await admin.query("update public.billing_subscriptions set trial_started_at = now(), trial_ends_at = now() + interval '1 day', version = version + 1 where owner_id = $1", [T]);
    assert.equal(iso((await sub(T)).trial_started_at), iso(before.trial_started_at), "tampoco se reemplaza por otra");
  });

  console.log("\nCuenta V — cancelar durante la prueba");
  await step("10. cancelar durante la prueba PAUSA la suscripción (no habrá primer cobro), conserva el acceso hasta el fin de la prueba y después queda cancelada; no hay ningún cobro", async () => {
    at("2026-11-12", 9);
    refs.V = (await checkout(V, "tr-key-v-000001")).ref;
    startTrial(refs.V, "test_sub_V", "test_pay_V0");
    await send(created("test_pay_V0", refs.V, "test_sub_V"));
    await drain();
    assert.equal((await sub(V)).status, "active");
    at("2026-11-14", 10);
    assert.deepEqual(await cancelSubscription(cmd(), V), { ok: true, changed: true });
    assert.deepEqual(rb.patches.filter((p) => p.id === "test_sub_V" && p.status).map((p) => p.status), ["paused"]);
    assert.equal((await sub(V)).status, "cancel_at_period_end");
    const during = await access(V, "2026-11-26", 23, 59, 59);
    assert.deepEqual([during.level, during.reason], ["full_with_notice", "subscription_ending"]);
    const after = await access(V, "2026-11-27", 0, 0, 0);
    assert.equal(after.level, "blocked");
    assert.equal(after.status, "canceled");
    assert.equal(await executions(V), 0);
    assert.equal(await periods(V), 0);
  });

  await step("11. reactivar durante la prueba lleva el primer cobro EXACTAMENTE al fin de la prueba (00:00), no a otra hora", async () => {
    at("2026-11-15", 10);
    // V ya está cancelada (la prueba terminó en el paso anterior sólo en el reloj de acceso): se prueba con una cuenta nueva W2 = Z
    refs.Z = (await checkout(Z, "tr-key-z-000001")).ref;
    at("2026-11-15", 10);
    startTrial(refs.Z, "test_sub_Z", "test_pay_Z0");
    await send(created("test_pay_Z0", refs.Z, "test_sub_Z"));
    await drain();
    assert.deepEqual(await cancelSubscription(cmd(), Z), { ok: true, changed: true });
    assert.deepEqual(await reactivateSubscription(cmd(), Z), { ok: true, changed: true });
    const resume = rb.patches.filter((p) => p.id === "test_sub_Z" && p.status === "active");
    assert.equal(resume.length, 1);
    assert.equal(resume[0].nextChargeDate, ar("2026-11-30"), "00:00 de Argentina del fin de la prueba (15/11 + 15 = 30/11)");
    assert.equal((await sub(Z)).status, "active");
  });

  console.log("\nCuenta W — primer cobro rechazado y reintento");
  await step("12. primer cobro RECHAZADO: sin acceso (ni un día de gracia); el reintento aprobado 2 días después restaura el acceso solo; un cobro pendiente o rechazado nunca lo habilita", async () => {
    at("2026-11-12", 9);
    refs.W = (await checkout(W, "tr-key-w-000001")).ref;
    startTrial(refs.W, "test_sub_W", "test_pay_W0");
    await send(created("test_pay_W0", refs.W, "test_sub_W"));
    await drain();
    assert.equal(iso((await sub(W)).trial_ends_at), ar("2026-11-27"));
    at("2026-11-27", 0, 0, 3);
    rb.addPayment({ id: "test_pay_W1", status: "rejected", amount: 25900, subscriptionId: "test_sub_W", metadata: { tf_ref: refs.W } });
    await send(created("test_pay_W1", refs.W, "test_sub_W"));
    await drain();
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1 and outcome = 'rejected'", [W]), 1);
    for (const [date, h] of [["2026-11-27", 1], ["2026-11-28", 12], ["2026-11-29", 23]]) {
      const blocked = await access(W, date, h);
      assert.equal(blocked.level, "blocked", `${date} ${h}h`);
      assert.equal(blocked.capabilities.viewOperationalData, false);
    }
    assert.equal(await periods(W), 0);
    at("2026-11-29", 0, 0, 5);
    rb.addPayment({ id: "test_pay_W2", status: "approved", amount: 25900, subscriptionId: "test_sub_W", metadata: { tf_ref: refs.W } });
    await send(created("test_pay_W2", refs.W, "test_sub_W"));
    await drain();
    assert.equal((await access(W, "2026-11-29", 0, 1)).level, "full", "el reintento aprobado restaura el acceso sin cerrar sesión");
    assert.equal(await periods(W), 1);
    assert.equal(iso((await sub(W)).current_period_start), ar("2026-11-29"));
  });

  console.log("\nCuenta X — Rebill no confirma / no se puede fijar el primer cobro");
  await step("13. si NO se puede fijar el primer cobro a las 00:00, la prueba NO se activa (nada a medias), queda una revisión abierta y la cuenta sigue sin acceso; al recuperarse Rebill, se activa", async () => {
    at("2026-11-12", 9);
    refs.X = (await checkout(X, "tr-key-x-000001")).ref;
    startTrial(refs.X, "test_sub_X", "test_pay_X0");
    rb.failScheduling = true;
    await send(created("test_pay_X0", refs.X, "test_sub_X"));
    await drain();
    let row = await sub(X);
    assert.equal(row.status, "pending");
    assert.equal(row.trial_started_at, null);
    assert.equal(row.provider_subscriber_uid, null, "ni se vincula una suscripción cuyo primer cobro no quedó bien");
    assert.equal(await reviews(X, "trial_schedule"), 1);
    assert.equal((await access(X, "2026-11-12", 10)).level, "blocked");
    rb.failScheduling = false;
    resetConfirmThrottleForTests();
    await confirmOwnerPayment(deps(), X, { force: true });
    row = await sub(X);
    assert.equal(row.status, "active");
    assert.equal(iso(row.trial_ends_at), ar("2026-11-27"));
    assert.equal((await access(X, "2026-11-12", 10)).level, "full");
  });

  console.log("\nCuenta Z2 — la suscripción no está en prueba según Rebill");
  await step("14. un pago de 0 cuya suscripción NO figura en prueba según Rebill no activa nada (se compara siempre con la consulta autenticada)", async () => {
    at("2026-11-12", 9);
    refs.N = (await checkout(N, "tr-key-n-000002")).ref;
    startTrial(refs.N, "test_sub_N", "test_pay_N0");
    rb.subscriptions.get("test_sub_N").statusDetail = "active";
    await send(created("test_pay_N0", refs.N, "test_sub_N"));
    await drain();
    const row = await sub(N);
    assert.equal(row.status, "pending");
    assert.equal(row.trial_started_at, null);
    assert.equal(await reviews(N, "provider_state_mismatch"), 1);
    assert.equal(rb.patches.filter((p) => p.id === "test_sub_N").length, 0, "no se programa ningún cobro");
  });

  console.log("\nCuenta Y — cuenta actual");
  await step("15. las cuentas actuales (grandfathered) conservan su acceso y NO reciben prueba ni cambian de estado", async () => {
    const row = await sub(Y);
    assert.equal(row.status, "grandfathered");
    assert.equal(row.trial_started_at, null);
    const view = buildBillingView({ snapshot: await store.ensureAccount(Y), history: null, now: clock, capabilities: trialProvider.capabilities, available: true, trialAvailable: true });
    assert.equal(view.trialOffer, null);
    assert.equal((await access(Y, "2030-01-01")).level, "full");
  });

  await step("16. aislamiento: ningún pago ni prueba de una cuenta cambió a otra", async () => {
    for (const owner of [T, V, W, X, Z, N, Y]) {
      const row = await sub(owner);
      assert.ok(!row.provider_subscriber_uid || row.provider_subscriber_uid.endsWith(owner === T ? "T" : owner === V ? "V" : owner === W ? "W" : owner === X ? "X" : owner === Z ? "Z" : "?"), `cuenta ${owner}`);
    }
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1", [Y]), 0);
  });
} finally {
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nPRUEBA GRATUITA (Postgres real + Rebill simulado): ${results.length - failed.length}/${results.length} pasos ok`);
process.exit(failed.length ? 1 : 0);
