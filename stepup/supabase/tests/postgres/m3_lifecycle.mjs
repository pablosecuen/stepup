// M3 — CICLO DE VIDA COMPLETO con el adaptador falso y Postgres REAL (embedded-postgres 17, todas las migraciones reales + las tres de facturación).
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/m3_lifecycle.mjs
//
// Una cuenta recorre, con un reloj controlado y el código de aplicación TAL CUAL (comandos, recepción, procesador, sondeo, barrido del reloj y el
// resolutor de acceso), la historia completa: cuenta nueva → checkout → vuelta del proveedor (no activa) → primer pago → renovación con el trabajador
// caído → renovación cuyo aviso se pierde (la recupera el sondeo) → cobro rechazado → gracia → modo limitado → reintento aprobado → acceso completo.
// En paralelo: aviso duplicado, aviso ajeno, aviso con cuerpo mentiroso, cancelación idempotente con el proveedor caído, y otra propietaria que
// nunca cambia. Sin datos reales, sin Mobbex, sin red. El nombre y el DNI/CUIT de prueba se buscan en TODAS las tablas de facturación.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");

console.info = () => {};
console.warn = () => {};
console.error = () => {};
const plansLib = await importLib("billing/plans.ts");
const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { FakeProviderAdapter } = await importLib("billing/providers/fake.ts");
const { ingestNotice } = await importLib("billing/webhook-ingest.ts");
const { createNoticeLimiter } = await importLib("billing/rate-limit.ts");
const { drainEvents, runClockSweep, runSubscriberPoll } = await importLib("billing/processor.ts");
const { cancelSubscription, startCheckout, updatePaymentMethod } = await importLib("billing/commands.ts");
const { resolveBillingAccess } = await importLib("billing/access.ts");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");

const ar = (date, hour = 0, minute = 0) => localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" });
const MONTHLY = plansLib.getPlan("tf_monthly_ars_v1");
const FLAGS = { enabled: true, enforcement: false };
const ENFORCING = { enabled: true, enforcement: true }; // sólo para PREGUNTAR al resolutor de acceso; ninguna ruta lo usa

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.message ?? error).split("\n").slice(0, 4).join("\n        ")}`);
  }
};

const pg = await start({ port: 5871 + Math.floor(Math.random() * 300) });
const admin = pg.admin;
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const svcConn = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svcConn));
  const provider = new FakeProviderAdapter();
  const limiter = createNoticeLimiter();
  let clock = new Date(ar("2026-10-14", 9));
  const now = () => clock;
  const deps = (overrides = {}) => ({ store, provider, now, expectLive: true, worker: "m3-worker", ...overrides });
  const cmd = () => ({ store, provider, flags: FLAGS, now });
  const at = (date, h = 12, m = 0) => {
    clock = new Date(ar(date, h, m));
  };

  const A = uuidFor(100);
  const B = uuidFor(200);
  const C = uuidFor(300);
  for (const [id, tag] of [[A, "a"], [B, "b"], [C, "c"]]) await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now())", [id, `${tag}@example.test`]);

  const sub = async (owner) => (await admin.query("select * from public.billing_subscriptions where owner_id = $1", [owner])).rows[0];
  const count = async (sql, params) => (await admin.query(sql, params)).rows[0].n;
  const access = async (owner, date, h = 12, m = 0) => resolveBillingAccess({ flags: ENFORCING, snapshot: await store.ensureAccount(owner), now: new Date(ar(date, h, m)) });
  const iso = (value) => (value ? new Date(value).toISOString() : null);

  const webhookBody = (o) =>
    JSON.stringify({
      type: "subscription:execution",
      data: {
        payment: { id: o.providerPaymentId, status: { code: o.statusCode }, total: Number(o.amountMinor) / 100, currency: { code: "ARS" }, created: o.dueAt, updated: o.occurredAt },
        subscription: { uid: "T1", reference: o.planReference },
        subscriber: { uid: o.subscriberUid, reference: o.subscriberReference },
        execution: { uid: o.executionUid, date: o.dueAt, total: Number(o.amountMinor) / 100, currency: "ARS", test: false },
      },
    });
  const deliver = (o, raw = null) => {
    const body = raw ?? webhookBody(o);
    return ingestNotice({ adapter: provider, store, flags: FLAGS, now, limiter }, { method: "POST", contentType: "application/json", declaredLength: Buffer.byteLength(body), readBody: async () => body, clientKey: "m3" });
  };
  const ageNotices = () => admin.query("update public.billing_webhook_events set received_at = now() - interval '10 minutes'");
  const drain = () => drainEvents(deps(), 20);
  const op = (acct, n, dueDay, overrides = {}) => ({
    providerPaymentId: `pay_${acct.owner.slice(-4)}_${n}`,
    executionUid: `exe_${acct.owner.slice(-4)}_${n}`,
    subscriberUid: acct.subscriberUid,
    subscriberReference: acct.ref,
    planReference: "tf_monthly_ars_v1",
    outcome: "approved",
    statusCode: "200",
    amountMinor: MONTHLY.amountMinor,
    currency: "ARS",
    dueAt: ar(dueDay, 10),
    occurredAt: ar(dueDay, 10, 5),
    livemode: true,
    ...overrides,
  });

  // ============================================================================================== propietaria B: referencia que NO debe cambiar
  const checkoutFor = async (owner, key, planCode = "tf_monthly_ars_v1") => {
    const snapshot = await store.ensureAccount(owner);
    const result = await startCheckout(cmd(), { ownerId: owner, planCode, idempotencyKey: key, returnUrl: "https://app.example.test/facturacion/resultado", customer: { email: `${owner.slice(-3)}@example.test`, name: "Persona De Prueba", identification: "27345678901" } });
    return { result, ref: snapshot.providerReference };
  };

  console.log("\nHistoria de la propietaria A");
  let a;
  await step("1. cuenta nueva sin pago verificado: modo limitado (con control de acceso consultado, no activo) y sin suscripción", async () => {
    const snap = await store.ensureAccount(A);
    assert.equal(snap.status, "pending");
    const view = await access(A, "2026-10-14", 9);
    assert.equal(view.level, "limited");
    assert.equal(view.nextAction, "subscribe");
  });

  await step("2. checkout: el proveedor falso crea el suscriptor, la base guarda el intento y el enlace; el DNI/CUIT llegó al proveedor y NO quedó en ninguna tabla", async () => {
    const { result, ref } = await checkoutFor(A, "m3-key-a-000001");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.redirectUrl, /^https:\/\/fake-provider\.invalid\//);
    const subscriberUid = [...provider.subscribers.keys()].at(-1);
    a = { owner: A, ref, subscriberUid };
    assert.equal(provider.receivedCustomers.at(-1).identification, "27345678901", "el proveedor recibe el documento");
    const tables = (await admin.query("select tablename from pg_tables where schemaname = 'public' and tablename like 'billing\\_%'")).rows.map((r) => r.tablename);
    for (const table of tables) {
      assert.equal(await count(`select count(*)::int n from public.${table} x where to_jsonb(x)::text like '%27345678901%' or to_jsonb(x)::text like '%Persona De Prueba%'`), 0, `${table} no contiene el documento ni el nombre`);
    }
    assert.equal((await sub(A)).status, "pending");
  });

  await step("3. volver del proveedor (resultado) NO activa nada: sólo pide un sondeo prioritario; sin cobro confirmado sigue pendiente y limitado", async () => {
    provider.seedSubscriber(a.subscriberUid, { status: "active" });
    await store.prioritizePolls([A]);
    const poll = await runSubscriberPoll(deps());
    assert.equal(poll.subscriptionsWritten, 0);
    assert.equal((await sub(A)).status, "pending");
    assert.equal((await access(A, "2026-10-14", 9)).level, "limited");
  });

  let periodEnd1;
  await step("4. pago confirmado: aviso (no confiable) + consulta autenticada + conciliación → active, un período, acceso completo; el cuerpo no decide nada", async () => {
    const pay1 = op(a, 1, "2026-10-14");
    provider.seedOperation(pay1);
    const lookups = provider.calls.getOperation;
    const lying = { ...pay1, amountMinor: 1, statusCode: "400" }; // el cuerpo miente; el proveedor dice lo contrario
    assert.equal((await deliver(lying)).status, 200);
    await drain();
    assert.ok(provider.calls.getOperation > lookups, "se consultó al proveedor de forma autenticada");
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal(row.plan_code, "tf_monthly_ars_v1");
    periodEnd1 = iso(row.current_period_end);
    assert.equal(periodEnd1, ar("2026-11-14"));
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 1);
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1 and amount_minor = $2", [A, MONTHLY.amountMinor]), 1, "el importe es el del proveedor/catálogo, no el del cuerpo");
    assert.equal((await access(A, "2026-10-15")).level, "full");
  });

  await step("5. aviso DUPLICADO ×4 y aviso AJENO (referencia inexistente): sin cambios, un solo cobro y SIN consultar al proveedor por el ajeno", async () => {
    const version = (await sub(A)).version;
    const dup = op(a, 1, "2026-10-14");
    for (let i = 0; i < 4; i += 1) await deliver(dup);
    await drain();
    const lookups = provider.calls.getOperation;
    const stranger = op({ owner: A, ref: "tfs_" + "e".repeat(32), subscriberUid: "NADIE" }, 9, "2026-10-14", { subscriberReference: "tfs_" + "e".repeat(32), subscriberUid: "NADIE" });
    assert.equal((await deliver(stranger)).status, 200, "respuesta uniforme");
    assert.equal((await deliver(op(a, 1, "2026-10-14"), "{ no es json")).status, 400);
    await drain();
    assert.equal(provider.calls.getOperation, lookups, "el aviso ajeno no provoca ninguna consulta");
    assert.equal((await sub(A)).version, version);
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 1);
    assert.equal(await count("select count(*)::int n from public.billing_executions where owner_id = $1", [A]), 1);
  });

  await step("6. RENOVACIÓN con el TRABAJADOR CAÍDO: el aviso queda en la cola con su arrendamiento; al vencer, otro trabajador lo procesa UNA vez → active con el período siguiente", async () => {
    at("2026-11-14", 10, 30);
    const pay2 = op(a, 2, "2026-11-14");
    provider.seedOperation(pay2);
    await deliver(pay2);
    const claimed = await store.claimEvents({ limit: 100, leaseSeconds: 60, worker: "dying-worker", maxAttempts: 5 });
    assert.ok(claimed.length >= 1);
    assert.equal((await drain()).claimed, 0, "mientras el arrendamiento vive nadie más lo toma");
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 second' where locked_by = 'dying-worker'");
    at("2026-11-14", 12);
    await drain();
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal(iso(row.current_period_end), ar("2026-12-14"));
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 2);
  });

  await step("7. RESPUESTA PERDIDA: la renovación se cobró pero el aviso NUNCA llegó → al vencer pasa a past_due (renovación en proceso) y el SONDEO por suscriptor la recupera → active", async () => {
    at("2026-12-14", 10, 30);
    const pay3 = op(a, 3, "2026-12-14");
    provider.seedOperation(pay3); // el proveedor lo tiene; ningún aviso llegó
    at("2026-12-15", 12);
    const sweep = await runClockSweep(deps());
    assert.ok(sweep.evaluated >= 1);
    assert.equal((await sub(A)).status, "past_due");
    const processing = await access(A, "2026-12-15");
    assert.deepEqual([processing.level, processing.reason], ["full", "renewal_processing"], "mientras no se sepa el resultado el acceso sigue completo (renovación en proceso)");
    await store.prioritizePolls([A]);
    const poll = await runSubscriberPoll(deps());
    assert.ok(poll.facts >= 1, JSON.stringify(poll));
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 3);
    assert.equal((await access(A, "2026-12-15")).level, "full");
    // Repetir el sondeo no cambia nada.
    await store.prioritizePolls([A]);
    assert.equal((await runSubscriberPoll(deps())).subscriptionsWritten, 0);
  });

  let rejected;
  await step("8. COBRO RECHAZADO: gracia D+1..D+5 con acceso completo y aviso; limitado desde las 00:00 de D+6 (el resolutor y el barrido coinciden)", async () => {
    at("2027-01-14", 10, 30);
    rejected = op(a, 4, "2027-01-14", { outcome: "rejected", statusCode: "410" });
    provider.seedOperation(rejected);
    await deliver(rejected);
    at("2027-01-14", 12);
    await drain();
    assert.equal((await sub(A)).status, "grace_period");
    for (const [date, h, m] of [["2027-01-15", 0, 0], ["2027-01-17", 12, 0], ["2027-01-19", 23, 59]]) {
      assert.equal((await access(A, date, h, m)).level, "full_with_notice", `${date} ${h}:${m} sigue en gracia`);
    }
    assert.equal((await access(A, "2027-01-20", 0, 0)).level, "limited", "limitado desde las 00:00 de D+6");
    // El barrido del reloj lo persiste en esa misma frontera y no antes.
    at("2027-01-19", 23, 59);
    await runClockSweep(deps());
    assert.equal((await sub(A)).status, "grace_period");
    at("2027-01-20", 0, 1);
    await runClockSweep(deps());
    assert.equal((await sub(A)).status, "limited");
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 3, "el rechazo no crea período");
    const view = await access(A, "2027-01-20", 12);
    assert.equal(view.level, "limited");
    assert.equal(view.capabilities.exportData, true);
    assert.equal(view.capabilities.updatePaymentMethod, true);
    assert.equal(view.capabilities.cancelSubscription, true);
    assert.equal(view.capabilities.contactSupport, true);
    assert.equal(view.capabilities.modifyOperationalData, false);
    assert.equal(view.capabilities.createOperationalData, false);
  });

  await step("9. REINTENTO: actualizar el medio de pago no cambia el estado; el cobro reintentado aprobado vuelve a activar con acceso completo (y un aviso repetido no duplica)", async () => {
    at("2027-01-21", 9);
    const before = await sub(A);
    const pm = await updatePaymentMethod(cmd(), A);
    assert.equal(pm.ok, true, JSON.stringify(pm));
    assert.equal((await sub(A)).version, before.version, "cambiar el medio de pago no cambia el estado");
    const retry = op(a, 5, "2027-01-21");
    provider.seedOperation(retry);
    await deliver(retry);
    at("2027-01-21", 12);
    await drain();
    const row = await sub(A);
    assert.equal(row.status, "active");
    assert.equal((await access(A, "2027-01-21", 12)).level, "full");
    assert.equal(await count("select count(*)::int n from public.billing_periods where owner_id = $1", [A]), 4);
    const version = row.version;
    await ageNotices();
    await deliver(retry);
    await drain();
    assert.equal((await sub(A)).version, version, "aviso repetido tras el reintento: sin cambios");
  });

  // ============================================================================================== propietaria C: cancelación
  console.log("\nCancelación de la propietaria C (proveedor primero, idempotente, con el proveedor caído una vez)");
  let c;
  await step("10. C paga; cancelar con el proveedor CAÍDO no cambia nada; reintentar cancela allá y acá UNA vez; repetir es idempotente; conserva el acceso hasta el fin del período", async () => {
    at("2026-10-20", 9);
    const { result, ref } = await checkoutFor(C, "m3-key-c-000001");
    assert.equal(result.ok, true);
    c = { owner: C, ref, subscriberUid: [...provider.subscribers.keys()].at(-1) };
    provider.seedSubscriber(c.subscriberUid, { status: "active" });
    const pay = op(c, 1, "2026-10-20");
    provider.seedOperation(pay);
    await deliver(pay);
    at("2026-10-20", 12);
    await drain();
    assert.equal((await sub(C)).status, "active");
    provider.injectFailure("cancelSubscriber", "unavailable", 1);
    const failed = await cancelSubscription(cmd(), C);
    assert.equal(failed.ok, false);
    assert.equal((await sub(C)).status, "active", "si el proveedor no confirma, la base no cambia");
    assert.equal((await access(C, "2026-10-21")).level, "full");
    assert.deepEqual(await cancelSubscription(cmd(), C), { ok: true, changed: true });
    assert.equal((await sub(C)).status, "cancel_at_period_end");
    assert.ok(provider.canceled.has(c.subscriberUid));
    assert.deepEqual(await cancelSubscription(cmd(), C), { ok: true, changed: false });
    assert.equal(await count("select count(*)::int n from public.billing_plan_changes where owner_id = $1 and kind = 'cancel'", [C]), 1);
    const ending = await access(C, "2026-11-19", 23, 59);
    assert.deepEqual([ending.level, ending.reason], ["full_with_notice", "subscription_ending"], "conserva el acceso completo (con aviso de fin) hasta el final del período pagado");
  });

  await step("11. al terminar el período pagado la cuenta cancelada vence (expired → limitado) y NO se vuelve a cobrar; un aviso tardío de pago no la revive", async () => {
    at("2026-11-21", 12);
    await runClockSweep(deps());
    assert.ok(["expired", "canceled"].includes((await sub(C)).status), (await sub(C)).status);
    assert.equal((await access(C, "2026-11-21", 12)).level, "limited");
    const late = op(c, 2, "2026-11-20");
    provider.seedOperation(late);
    await deliver(late);
    await drain();
    assert.ok(["expired", "canceled"].includes((await sub(C)).status), "sigue sin acceso");
  });

  // ============================================================================================== aislamiento
  console.log("\nAislamiento entre propietarias");
  await step("12. la propietaria B (sin actividad) nunca cambió; el historial de A no contiene nada de C ni de B; el registro fiscal es seudonimizado", async () => {
    const b = await sub(B);
    assert.equal(b, undefined, "B nunca tocó el sistema: no tiene ni fila (se crea sólo al consultarla)");
    const snapB = await store.ensureAccount(B);
    assert.equal(snapB.status, "pending");
    assert.equal(snapB.version, 1);
    const history = await store.getHistory(A, 50);
    const text = JSON.stringify(history);
    assert.ok(!text.includes(c.subscriberUid) && !text.includes(C), "el historial de A no contiene datos de C");
    assert.ok(!/exe_|pay_|fake_sub_|fake_chk_/.test(text), "el historial no expone identificadores del proveedor");
    const fiscal = (await admin.query("select * from public.billing_fiscal_records")).rows;
    assert.ok(fiscal.length >= 5);
    assert.ok(fiscal.every((row) => !("owner_id" in row)), "sin propietaria");
    const fiscalText = JSON.stringify(fiscal);
    assert.ok(!fiscalText.includes(A) && !fiscalText.includes(C) && !fiscalText.includes("27345678901"));
  });

  await step("13. los avisos de A, C y los descartados quedan acotados: ninguno en proceso, ninguno perdido; las anomalías están abiertas y sin datos personales", async () => {
    assert.equal(await count("select count(*)::int n from public.billing_webhook_events where status in ('pending','processing')"), 0, "la cola quedó vacía");
    assert.equal(await count("select count(*)::int n from public.billing_webhook_events where status = 'dead'"), 0);
    const text = JSON.stringify((await admin.query("select * from public.billing_reconciliations")).rows);
    assert.ok(!text.includes("27345678901") && !text.includes("Persona De Prueba"));
  });

  await svcConn.end();
} finally {
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nCICLO COMPLETO: ${results.length}/${results.length} pasos ok` : `\nCICLO CON ${failed.length} FALLA(S) de ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
