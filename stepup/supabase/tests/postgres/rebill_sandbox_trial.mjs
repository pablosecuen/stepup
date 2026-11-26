// PRUEBA GRATUITA contra el SANDBOX REAL de Rebill (sin dinero real) con TeacherFlow corriendo en una base LOCAL aislada (Postgres 17 con las migraciones reales).
//
//   node supabase/tests/postgres/rebill_sandbox_trial.mjs --env-file <.env.rebill.local del sandbox> --ref tfs_<hex32>
//
// Se corre DESPUÉS de que una persona pagó en el checkout de sandbox con el enlace de prueba (que lleva `?tf_ref=<ref>`). Qué hace y qué informa:
//   1. Lee de Rebill el pago de 0 con esa referencia y su suscripción: estado, `statusDetail`, fecha de creación y `nextChargeDate` TAL COMO la agendó Rebill (antes de tocar nada).
//   2. Corre el procesamiento REAL de TeacherFlow (adaptador, conciliación, activación): fija `nextChargeDate` a las 00:00 de Argentina de inicio + 15 con PATCH y lo vuelve a leer.
//   3. Compara fecha programada vs. fecha pedida; informa la diferencia exacta (la HORA de procesamiento efectivo no se puede observar sin esperar 15 días: sólo se informa lo programado).
//   4. Cancela durante la prueba (pausa), y con `POST /v3/subscriptions/:id/sandbox/advance` ejecuta el «próximo cobro» para comprobar que NO se genera ningún cobro mientras está pausada.
// Nada de esto toca Production ni su base. Imprime ids acortados, estados, importes y fechas; nunca claves ni datos de la persona.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const argv = process.argv.slice(2);
const flag = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const envFile = flag("--env-file");
const REF = flag("--ref");
if (!envFile || !/^tfs_[0-9a-f]{32}$/.test(REF ?? "")) {
  console.log("Uso: node supabase/tests/postgres/rebill_sandbox_trial.mjs --env-file <sandbox> --ref tfs_<32 hex>");
  process.exit(2);
}
const KEY = /^\s*REBILL_API_KEY\s*=\s*(.*?)\s*$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.replace(/^["']|["']$/g, "");
assert.ok(KEY?.startsWith("sk_"), "el archivo no trae una clave secreta");

const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { RebillAdapter, readRebillConfig } = await importLib("billing/providers/rebill.ts");
const { confirmOwnerPayment, resetConfirmThrottleForTests } = await importLib("billing/confirm.ts");
const { cancelSubscription, startCheckout } = await importLib("billing/commands.ts");
const { trialEndsAtFor } = await importLib("billing/periods.ts");

const api = async (method, path, body) => {
  const response = await fetch(`https://api.rebill.com${path}`, { method, headers: { "x-api-key": KEY, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
};
const org = await api("GET", "/v3/organizations/me");
assert.equal(org.json?.environment ?? org.json?.organization?.environment, "sandbox", "esta clave NO es del sandbox: no se hace nada");

// Configuración del adaptador a partir de lo que HAY en el sandbox (planes y links normales y con prueba).
const plans = (await api("POST", "/v3/plans/search", { pagination: { limit: 100, offset: 0, order: "DESC" } })).json?.records ?? [];
const links = (await api("POST", "/v3/payment-links/search", { pagination: { limit: 100, offset: 0, order: "DESC" } })).json?.records ?? [];
const ENV = { REBILL_API_KEY: KEY, REBILL_ENVIRONMENT: "sandbox", REBILL_WEBHOOK_SECRET: "whsec_local-NOT-REAL" };
for (const code of ["tf_monthly_ars_v2", "tf_quarterly_ars_v2", "tf_semiannual_ars_v2", "tf_annual_ars_v2"]) {
  const upper = code.toUpperCase();
  for (const trial of [false, true]) {
    const plan = plans.find((p) => p.metadata?.tfCode === code && Boolean(p.metadata?.tfTrial) === trial && p.status !== "archived");
    const link = links.find((l) => l.metadata?.tfCode === code && Boolean(l.metadata?.tfTrial) === trial && l.status !== "archived");
    if (plan) ENV[`REBILL_${trial ? "TRIAL_" : ""}PLAN_ID_${upper}`] = plan.id;
    if (link?.url) ENV[`REBILL_${trial ? "TRIAL_" : ""}CHECKOUT_URL_${upper}`] = link.url;
  }
}
const adapter = new RebillAdapter(readRebillConfig(ENV));
assert.equal(adapter.environment, "sandbox");
assert.equal(adapter.offersTrial(), true, "el sandbox tiene los 4 planes y links con prueba");

// 1. Lo que Rebill tiene, antes de tocar nada.
const found = (await api("POST", "/v3/payments/search", { pagination: { limit: 100, offset: 0, sort: "created_at", order: "DESC" } })).json?.records?.filter((p) => p.metadata?.tf_ref === REF) ?? [];
console.log(`\n1. Pagos del sandbox con esa referencia: ${found.length}`);
if (found.length === 0) {
  console.log("   Todavía no hay ningún pago con esa referencia: falta completar el checkout de sandbox.");
  process.exit(3);
}
const zero = found.find((p) => Number(p.amount) === 0) ?? found[0];
console.log(`   pago ${zero.id.slice(0, 12)}… · estado ${zero.status} · monto ${zero.amount} ${zero.currency} · creado ${zero.createdAt} · suscripción ${zero.subscriptionId ? zero.subscriptionId.slice(0, 12) + "…" : "(ninguna)"}`);
assert.ok(zero.subscriptionId, "el pago de 0 debe traer subscriptionId");
const before = (await api("GET", `/v3/subscriptions/${zero.subscriptionId}`)).json;
console.log(`   suscripción: estado ${before.status} / detalle ${before.statusDetail} · plan ${String(before.plan?.id).slice(0, 14)}… · creada ${before.createdAt} · nextChargeDate que AGENDÓ Rebill ${before.nextChargeDate}`);
const startedAt = new Date(zero.createdAt).toISOString();
const target = trialEndsAtFor(startedAt);
console.log(`   inicio de la prueba ${startedAt} → primer cobro pedido: ${target} (00:00 de Argentina)`);
console.log(`   Rebill agendó el primer cobro a ${((Date.parse(before.nextChargeDate) - Date.parse(startedAt)) / 3_600_000).toFixed(2)} h del inicio (15 días = 360 h)`);

// 2. El procesamiento REAL de TeacherFlow en una base local.
const pg = await start({ port: 7600 + Math.floor(Math.random() * 300) });
try {
  assert.deepEqual(pg.failures, []);
  const svc = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svc));
  const owner = uuidFor(777);
  await pg.admin.query("insert into auth.users (id, email, created_at) values ($1, 'sandbox@example.test', now() + interval '1 hour')", [owner]);
  await store.ensureAccount(owner);
  await pg.admin.query("update public.billing_subscriptions set provider_reference = $2 where owner_id = $1", [owner, REF]);
  const deps = { store, provider: adapter, now: () => new Date(), expectLive: false, worker: "sandbox-trial" };
  const opened = await startCheckout({ store, provider: adapter, flags: { enabled: true, enforcement: false }, now: () => new Date() }, { ownerId: owner, planCode: "tf_monthly_ars_v2", idempotencyKey: "sandbox-trial-0001", returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer: { email: "sandbox@example.test" } });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  console.log(`\n2. Checkout de TeacherFlow para esa cuenta: va al link CON prueba → ${new URL(opened.redirectUrl).pathname.split("/").pop()?.slice(0, 18)}…`);
  resetConfirmThrottleForTests();
  await confirmOwnerPayment(deps, owner, { force: true });
  const row = (await pg.admin.query("select status, plan_code, provider_subscriber_uid, trial_started_at, trial_ends_at, current_period_end from public.billing_subscriptions where owner_id = $1", [owner])).rows[0];
  console.log(`   estado en TeacherFlow: ${row.status} · prueba ${row.trial_started_at ? "ACTIVADA" : "NO activada"} · vence ${row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : "—"}`);
  const reviews = (await pg.admin.query("select kind from public.billing_reconciliations where owner_id = $1 and status = 'open'", [owner])).rows.map((r) => r.kind);
  console.log(`   revisiones abiertas: ${reviews.length ? reviews.join(", ") : "ninguna"}`);
  const after = (await api("GET", `/v3/subscriptions/${zero.subscriptionId}`)).json;
  console.log(`\n3. nextChargeDate en Rebill DESPUÉS del ajuste: ${after.nextChargeDate} (pedido ${target}) → diferencia ${Math.abs(Date.parse(after.nextChargeDate) - Date.parse(target))} ms`);
  console.log(`   estado de la suscripción: ${after.status} / ${after.statusDetail}`);
  const kept = Math.abs(Date.parse(after.nextChargeDate) - Date.parse(target)) < 1000;
  console.log(`   ${kept ? "✔ Rebill acepta ajustar nextChargeDate durante la prueba y conserva el instante pedido" : "✖ Rebill NO conservó el instante pedido"}`);
  const again = (await api("GET", `/v3/subscriptions/${zero.subscriptionId}`)).json;
  console.log(`   releído de nuevo: ${again.nextChargeDate} (${again.nextChargeDate === after.nextChargeDate ? "estable" : "CAMBIÓ"})`);

  // 4. Cancelar durante la prueba y comprobar que no se cobra.
  const paymentsBefore = (await api("POST", "/v3/payments/search", { pagination: { limit: 100, offset: 0, order: "DESC" }, filters: { subscriptionId: zero.subscriptionId } })).json?.records?.length ?? 0;
  const canceled = await cancelSubscription({ store, provider: adapter, flags: { enabled: true, enforcement: false }, now: () => new Date() }, owner);
  const paused = (await api("GET", `/v3/subscriptions/${zero.subscriptionId}`)).json;
  console.log(`\n4. Cancelar durante la prueba: ${canceled.ok ? "aceptado" : "RECHAZADO"} · Rebill: ${paused.status} / ${paused.statusDetail} · TeacherFlow: ${(await pg.admin.query("select status from public.billing_subscriptions where owner_id = $1", [owner])).rows[0].status}`);
  const advance = await api("POST", `/v3/subscriptions/${zero.subscriptionId}/sandbox/advance`, {});
  const paymentsAfter = (await api("POST", "/v3/payments/search", { pagination: { limit: 100, offset: 0, order: "DESC" }, filters: { subscriptionId: zero.subscriptionId } })).json?.records ?? [];
  console.log(`   forzar el próximo cobro (sandbox/advance) con la suscripción pausada: HTTP ${advance.status} · pagos antes ${paymentsBefore}, después ${paymentsAfter.length} · cobros de ${"25900"}: ${paymentsAfter.filter((p) => Number(p.amount) > 0).length}`);
  console.log(`   ${paymentsAfter.filter((p) => Number(p.amount) > 0).length === 0 ? "✔ cancelar durante la prueba evita el cobro" : "✖ SE GENERÓ UN COBRO a pesar de cancelar"}`);
} finally {
  await pg.stop();
}
