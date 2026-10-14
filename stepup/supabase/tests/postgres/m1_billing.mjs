// M1 + M2 — Facturación sobre Postgres REAL (embedded-postgres 17, TODAS las migraciones reales + las de facturación, varias conexiones simultáneas).
//
//   mkdir %TEMP%\epg && cd %TEMP%\epg && npm i embedded-postgres@17.10.0-beta.17 pg
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/m1_billing.mjs               (batería completa: esquema, seguridad, RLS, integridad, flujos y concurrencia)
//   node supabase/tests/postgres/m1_billing.mjs --mutations   (rompe a propósito cada garantía de las migraciones; todas deben detectarse)
//
// El código de aplicación (lib/billing/*.ts) se ejecuta TAL CUAL contra las funciones SQL reales: el almacén (`RpcBillingStore`) es el
// mismo que usa producción, sólo cambia cómo se llama a la base (conexión directa como `service_role` en lugar de PostgREST).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { importLib, makeRpcCaller, REPO, sleep, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");

const PRE_M1 = "20261012100000_r8_retire_legacy_student_claims_and_enddate.sql";
const M1_FILES = ["20261014100000_m1_billing_core.sql", "20261014110000_m1_billing_functions.sql", "20261014120000_m2_billing_ops.sql"];

console.info = () => {}; // el registro seguro de la facturación no ensucia la salida de la batería
console.warn = () => {};
console.error = () => {};
const plansLib = await importLib("billing/plans.ts");
const smLib = await importLib("billing/state-machine.ts");
const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { FakeProviderAdapter } = await importLib("billing/providers/fake.ts");
const { ingestNotice } = await importLib("billing/webhook-ingest.ts");
const { createNoticeLimiter } = await importLib("billing/rate-limit.ts");
const { processEventBatch, drainEvents, runClockSweep, runProviderSweep, runSubscriberPoll } = await importLib("billing/processor.ts");
const { cancelSubscription, reactivateSubscription, changePlan, startCheckout, updatePaymentMethod } = await importLib("billing/commands.ts");
const { prepareAccountDeletion } = await importLib("billing/account-deletion.ts");
const { runProcessJob, runReconcileJob } = await importLib("billing/jobs.ts");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");

const ar = (date, hour = 0, minute = 0) => localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" });
const MONTHLY = plansLib.getPlan("tf_monthly_ars_v1");
const ANNUAL = plansLib.getPlan("tf_annual_ars_v1");

export async function runChecks({ migrationsDir = null, label = "", failFast = false } = {}) {
  const results = [];
  const check = async (name, fn) => {
    if (failFast && results.some((r) => !r.ok)) return; // en el modo de mutaciones alcanza con la primera detección
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      const detail = process.env.M1_DEBUG ? `${error?.message}\n${JSON.stringify({ actual: error?.actual, expected: error?.expected })}` : String(error?.message ?? error).split("\n").slice(0, 3).join(" | ").slice(0, 300);
      results.push({ name, ok: false, error: detail });
    }
  };

  // --- Parte 0: backfill sobre cuentas EXISTENTES + idempotencia (se cargan las migraciones hasta antes de M1 y luego M1 a mano) ---
  const pg0 = await start({ port: 5461 + Math.floor(Math.random() * 400), upTo: PRE_M1, migrationsDir });
  const migDir = migrationsDir ?? path.join(REPO, "supabase", "migrations");
  const legacyIds = [uuidFor(9001), uuidFor(9002), uuidFor(9003)];
  try {
    await check("0.1 las migraciones previas cargan sin errores", async () => assert.deepEqual(pg0.failures, []));
    for (const id of legacyIds) await pg0.admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now() - interval '30 days')", [id, `legacy-${id.slice(-4)}@example.test`]);
    const before = await pg0.admin.query("select count(*)::int n from pg_tables where schemaname = 'public'");
    for (const file of M1_FILES) await pg0.admin.query(fs.readFileSync(path.join(migDir, file), "utf8"));
    await check("0.2 M1 se aplica sobre una base con cuentas existentes: todas quedan grandfathered (sólo se escribe en tablas nuevas)", async () => {
      const rows = (await pg0.admin.query("select owner_id, status, grandfathered, provider_reference from public.billing_subscriptions order by owner_id")).rows;
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(row.status, "grandfathered");
        assert.equal(row.grandfathered, true);
        assert.match(row.provider_reference, /^tfs_[0-9a-f]{32}$/);
      }
      assert.equal(new Set(rows.map((row) => row.provider_reference)).size, 3, "referencias únicas");
      const after = await pg0.admin.query("select count(*)::int n from pg_tables where schemaname = 'public'");
      assert.equal(after.rows[0].n - before.rows[0].n, 12, "sólo se crearon las 12 tablas billing_*");
    });
    await check("0.3 aplicar M1 DOS veces es idempotente (sin errores, sin duplicar el catálogo ni las cuentas)", async () => {
      const snapshot = JSON.stringify((await pg0.admin.query("select owner_id, status, provider_reference from public.billing_subscriptions order by owner_id")).rows);
      for (const file of M1_FILES) await pg0.admin.query(fs.readFileSync(path.join(migDir, file), "utf8"));
      assert.equal(JSON.stringify((await pg0.admin.query("select owner_id, status, provider_reference from public.billing_subscriptions order by owner_id")).rows), snapshot);
      assert.equal((await pg0.admin.query("select count(*)::int n from public.billing_plans")).rows[0].n, 4);
      assert.equal((await pg0.admin.query("select count(*)::int n from public.billing_settings")).rows[0].n, 1);
    });
    await check("0.4 una cuenta creada DESPUÉS del corte nace pending; una anterior sin fila se crea grandfathered", async () => {
      const late = uuidFor(9101);
      await pg0.admin.query("insert into auth.users (id, email) values ($1, 'late@example.test')", [late]);
      const row = (await pg0.admin.query("select * from public.billing_ensure_account($1)", [late])).rows[0];
      assert.equal(row.status, "pending");
      assert.equal(row.grandfathered, false);
      const missing = uuidFor(9102);
      await pg0.admin.query("insert into auth.users (id, email, created_at) values ($1, 'old@example.test', now() - interval '400 days')", [missing]);
      assert.equal((await pg0.admin.query("select * from public.billing_ensure_account($1)", [missing])).rows[0].status, "grandfathered");
      assert.equal((await pg0.admin.query("select (public.billing_ensure_account($1)).provider_reference r", [late])).rows[0].r, row.provider_reference, "ensure es idempotente");
      await assert.rejects(pg0.admin.query("select * from public.billing_ensure_account($1)", [uuidFor(9999)]), /billing_unknown_owner/);
    });
  } finally {
    await pg0.stop();
  }

  // --- Mundo principal: TODAS las migraciones ---
  const pg = await start({ port: 5461 + Math.floor(Math.random() * 400) + 400, migrationsDir });
  const admin = pg.admin;
  await check("1.0 todas las migraciones (reales + M1) cargan sin errores", async () => assert.deepEqual(pg.failures, []));

  let nextUser = 1;
  const newUser = async (createdAt = null) => {
    const id = uuidFor(nextUser++);
    await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, coalesce($3::timestamptz, now()))", [id, `u${nextUser}@example.test`, createdAt]);
    return id;
  };
  const sub = async (owner) => (await admin.query("select * from public.billing_subscriptions where owner_id = $1", [owner])).rows[0];
  const iso = (value) => (value ? new Date(value).toISOString() : null);

  const svcConn = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svcConn));
  const provider = new FakeProviderAdapter();
  const limiter = createNoticeLimiter();
  const NOW = new Date(ar("2026-10-20", 12));
  const deps = (overrides = {}) => ({ store, provider, now: () => NOW, expectLive: true, worker: "test-worker", ...overrides });

  /** Cuenta con suscriptor en el proveedor (checkout completado). */
  const accountWithSubscriber = async (planCode = "tf_monthly_ars_v1") => {
    const owner = await newUser();
    const snapshot = await store.ensureAccount(owner);
    const plan = plansLib.getPlan(planCode);
    const opened = await store.openCheckoutAttempt({ ownerId: owner, plan, provider: "fake", idempotencyKey: `key-${owner.slice(-6)}-aaaaaaaa`, expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    assert.equal(opened.ok, true);
    await store.completeCheckoutAttempt({ attemptId: opened.attempt.id, providerCheckoutUid: `chk_${owner.slice(-6)}`, providerSubscriberUid: `sub_${owner.slice(-6)}`, redirectUrl: `https://mobbex.com/p/${owner.slice(-6)}` });
    return { owner, ref: snapshot.providerReference, subscriberUid: `sub_${owner.slice(-6)}` };
  };

  const op = (acct, n, overrides = {}) => ({
    providerPaymentId: `pay_${acct.owner.slice(-6)}_${n}`,
    executionUid: `exe_${acct.owner.slice(-6)}_${n}`,
    subscriberUid: acct.subscriberUid,
    subscriberReference: acct.ref,
    planReference: "tf_monthly_ars_v1",
    outcome: "approved",
    statusCode: "200",
    amountMinor: MONTHLY.amountMinor,
    currency: "ARS",
    dueAt: ar("2026-10-01", 10),
    occurredAt: ar("2026-10-01", 10, 5),
    livemode: true,
    ...overrides,
  });

  const webhookBody = (o, extra = {}) =>
    JSON.stringify({
      type: "subscription:execution",
      data: {
        payment: { id: o.providerPaymentId, status: { code: o.statusCode }, total: Number(o.amountMinor ?? 0) / 100, currency: { code: o.currency ?? "ARS" }, created: o.dueAt, updated: o.occurredAt },
        subscription: { uid: "T1", reference: o.planReference },
        subscriber: { uid: o.subscriberUid, reference: o.subscriberReference },
        execution: { uid: o.executionUid, date: o.dueAt, total: Number(o.amountMinor ?? 0) / 100, currency: o.currency ?? "ARS", test: !o.livemode },
        ...extra,
      },
    });

  /** Entrega un aviso por la recepción real (sin autenticación: es una señal no confiable). `raw` permite mandar un cuerpo cualquiera. */
  const deliver = async (o, { raw = null, flags = { enabled: true, enforcement: false }, contentType = "application/json" } = {}) => {
    const body = raw ?? webhookBody(o);
    return ingestNotice(
      { adapter: provider, store, flags, now: () => NOW, limiter },
      { method: "POST", contentType, declaredLength: Buffer.byteLength(body), readBody: async () => body, clientKey: "db-test" },
    );
  };
  /** Los avisos repetidos dentro de los 60 s de enfriamiento se descartan: las pruebas que quieren un aviso NUEVO del mismo pago "envejecen" el anterior. */
  const ageNotices = () => admin.query("update public.billing_webhook_events set received_at = now() - interval '10 minutes'");

  const drain = async (overrides = {}) => drainEvents(deps(overrides), 20);

  // =============================================================== Parte 1: esquema, RLS y privilegios
  await check("1.1 las doce tablas billing_* existen con RLS habilitada", async () => {
    const rows = (await admin.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'billing\\_%' order by 1")).rows;
    assert.equal(rows.length, 12, rows.map((r) => r.relname).join());
    for (const row of rows) assert.equal(row.relrowsecurity, true, row.relname);
  });

  const TABLES = (await admin.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'billing\\_%' order by 1")).rows.map((r) => r.relname);
  const FUNCTIONS = (await admin.query("select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'billing\\_%' order by 2")).rows;
  const TRIGGER_FUNCTIONS = new Set(["billing_check_amount_vs_catalog", "billing_check_subscription_backed_by_payment", "billing_enforce_version_bump", "billing_forbid_owner_change", "billing_capture_fiscal_record"]);

  await check("1.2 `anon` no puede leer, escribir ni ejecutar NADA de facturación (ni tablas ni funciones)", async () => {
    const anon = await pg.session("", "anon");
    try {
      for (const table of TABLES) {
        await assert.rejects(anon.query(`select 1 from public.${table} limit 1`), /permission denied/, `select ${table}`);
        await assert.rejects(anon.query(`insert into public.${table} default values`), /permission denied/, `insert ${table}`);
      }
      for (const fn of FUNCTIONS) assert.equal((await admin.query("select has_function_privilege('anon', $1, 'execute') ok", [fn.oid])).rows[0].ok, false, fn.proname);
    } finally {
      await anon.end();
    }
  });

  await check("1.3 `authenticated` no puede ejecutar ninguna función de facturación ni escribir en ninguna tabla", async () => {
    for (const fn of FUNCTIONS) assert.equal((await admin.query("select has_function_privilege('authenticated', $1, 'execute') ok", [fn.oid])).rows[0].ok, false, fn.proname);
    const owner = await newUser();
    await store.ensureAccount(owner);
    const auth = await pg.session(owner, "authenticated");
    try {
      for (const table of TABLES) {
        await assert.rejects(auth.query(`insert into public.${table} default values`), /permission denied|violates/, `insert ${table}`);
        await assert.rejects(auth.query(`update public.${table} set created_at = now()`), /permission denied|does not exist/, `update ${table}`);
        await assert.rejects(auth.query(`delete from public.${table}`), /permission denied/, `delete ${table}`);
      }
      await assert.rejects(auth.query("select public.billing_ensure_account($1)", [owner]), /permission denied/);
    } finally {
      await auth.end();
    }
  });

  await check("1.4 el navegador NO puede activar, pagar ni editar su suscripción (UPDATE directo rechazado), ni siquiera la propia", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    const auth = await pg.session(owner, "authenticated");
    try {
      for (const sql of ["update public.billing_subscriptions set status = 'active'", "update public.billing_subscriptions set plan_code = 'tf_annual_ars_v1'", "update public.billing_subscriptions set current_period_end = now() + interval '5 years'", "update public.billing_subscriptions set grandfathered = true", "delete from public.billing_subscriptions"]) {
        await assert.rejects(auth.query(sql), /permission denied/, sql);
      }
    } finally {
      await auth.end();
    }
    assert.equal((await sub(owner)).status, "pending");
  });

  await check("1.5 la propietaria lee SU estado y SUS períodos y nada más: aislamiento entre dos propietarias (RLS)", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await store.ensureAccount(a);
    await store.ensureAccount(b);
    for (const [owner, uid] of [[a, "exe_iso_a"], [b, "exe_iso_b"]]) {
      await admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', $2, 'tf_monthly_ars_v1', 1, 2490000, 'ARS', $3, $4)", [owner, uid, ar("2026-10-01"), ar("2026-11-01")]);
    }
    const asA = await pg.session(a, "authenticated");
    try {
      const own = await asA.query("select owner_id, status, plan_code, current_period_end from public.billing_subscriptions");
      assert.deepEqual(own.rows.map((r) => r.owner_id), [a], "sólo ve su fila");
      const periods = await asA.query("select owner_id, amount_minor from public.billing_periods");
      assert.deepEqual(periods.rows.map((r) => r.owner_id), [a], "sólo ve sus períodos");
      assert.equal((await asA.query("select * from (select owner_id from public.billing_subscriptions where owner_id = $1) x", [b])).rows.length, 0, "no ve la de otra");
      assert.equal((await asA.query("select owner_id from public.billing_periods where owner_id = $1", [b])).rows.length, 0);
      // Columnas del proveedor y de control: sin acceso.
      for (const column of ["provider_reference", "provider_subscriber_uid", "next_check_at", "version", "renewal_rejected_due_at", "restarted_at"]) await assert.rejects(asA.query(`select ${column} from public.billing_subscriptions`), /permission denied/, column);
      await assert.rejects(asA.query("select * from public.billing_subscriptions"), /permission denied/, "select * está cerrado: se piden columnas explícitas");
      for (const table of TABLES.filter((t) => !["billing_subscriptions", "billing_periods"].includes(t))) await assert.rejects(asA.query(`select 1 from public.${table} limit 1`), /permission denied/, table);
    } finally {
      await asA.end();
    }
  });

  await check("1.6 `service_role` ejecuta todas las funciones de servidor; las funciones son INVOKER con search_path vacío", async () => {
    for (const fn of FUNCTIONS) {
      assert.equal(fn.prosecdef, fn.proname === "billing_ensure_account", `${fn.proname}: SECURITY DEFINER sólo la que lee auth.users`);
      assert.ok((fn.proconfig ?? []).some((c) => /^search_path=("")?$/.test(c) || c === 'search_path=""'), `${fn.proname}: search_path vacío (${JSON.stringify(fn.proconfig)})`);
      if (!TRIGGER_FUNCTIONS.has(fn.proname)) assert.equal((await admin.query("select has_function_privilege('service_role', $1, 'execute') ok", [fn.oid])).rows[0].ok, true, fn.proname);
    }
    assert.ok(FUNCTIONS.length >= 25, String(FUNCTIONS.length));
  });

  await check("1.7 el espejo SQL del catálogo coincide EXACTAMENTE con el catálogo del servidor (lib/billing/plans.ts)", async () => {
    const rows = (await admin.query("select * from public.billing_plans order by code")).rows;
    assert.equal(rows.length, plansLib.PLAN_CODES.length);
    for (const row of rows) {
      const plan = plansLib.getPlan(row.code);
      assert.ok(plan, row.code);
      assert.equal(Number(row.amount_minor), plan.amountMinor);
      assert.equal(row.currency, plan.currency);
      assert.equal(row.interval_months, plan.interval.count);
      assert.equal(row.months_of_access, plan.monthsOfAccess);
      assert.equal(row.provider_interval, plan.providerInterval);
      assert.equal(row.price_version, plan.priceVersion);
      assert.equal(row.active, plan.active);
    }
  });

  await check("1.8 eliminar la cuenta (delete_own_account) elimina TODO lo de facturación; los avisos y anomalías quedan sin referencia a la cuenta", async () => {
    const acct = await accountWithSubscriber();
    await admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', 'exe_del', 'tf_monthly_ars_v1', 1, 2490000, 'ARS', $2, $3)", [acct.owner, ar("2026-10-01"), ar("2026-11-01")]);
    await admin.query("insert into public.billing_reconciliations (kind, owner_id, dedupe_key) values ('refund_review', $1, 'del:1')", [acct.owner]);
    await admin.query("insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized, owner_id) values ($1, 'fake', 'other', $1, '{}', $2)", ["d".repeat(64), acct.owner]);
    await admin.query("delete from auth.users where id = $1", [acct.owner]);
    for (const table of ["billing_subscriptions", "billing_periods", "billing_executions", "billing_checkout_attempts", "billing_plan_changes"]) assert.equal((await admin.query(`select count(*)::int n from public.${table} where owner_id = $1`, [acct.owner])).rows[0].n, 0, table);
    assert.equal((await admin.query("select owner_id from public.billing_reconciliations where dedupe_key = 'del:1'")).rows[0].owner_id, null);
    assert.equal((await admin.query("select owner_id from public.billing_webhook_events where dedup_key = $1", ["d".repeat(64)])).rows[0].owner_id, null);
  });

  // =============================================================== Parte 2: integridad en la base
  const insertExecution = (owner, uid, over = {}) =>
    admin.query("insert into public.billing_executions (owner_id, provider, execution_uid, outcome, plan_code, amount_minor, currency, due_at, occurred_at) values ($1, 'fake', $2, $3, $4, $5, $6, $7, $8)", [owner, uid, over.outcome ?? "approved", over.plan ?? "tf_monthly_ars_v1", over.amount ?? 2490000, over.currency ?? "ARS", ar("2026-10-01"), ar("2026-10-01", 1)]);

  await check("2.1 importe, moneda y plan se validan SIEMPRE contra el catálogo de la base (cobros, períodos e intentos)", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    await assert.rejects(insertExecution(owner, "e_bad_amount", { amount: 2489999 }), /billing_amount_mismatch/);
    await assert.rejects(insertExecution(owner, "e_other_plan_amount", { amount: 24900000 }), /billing_amount_mismatch/);
    await assert.rejects(insertExecution(owner, "e_bad_currency", { currency: "USD" }), /check|violates|billing_amount_mismatch/);
    await assert.rejects(insertExecution(owner, "e_unknown_plan", { plan: "tf_free_ars_v1" }), /foreign key|violates|billing_amount_mismatch/);
    await assert.rejects(insertExecution(owner, "e_zero", { amount: 0 }), /check|violates|billing_amount_mismatch/);
    await assert.rejects(admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', 'p_bad', 'tf_annual_ars_v1', 1, 100, 'ARS', $2, $3)", [owner, ar("2026-10-01"), ar("2027-10-01")]), /billing_amount_mismatch/);
    await assert.rejects(admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', 'p_ver', 'tf_annual_ars_v1', 2, 24900000, 'ARS', $2, $3)", [owner, ar("2026-10-01"), ar("2027-10-01")]), /billing_price_version_mismatch/);
    await assert.rejects(admin.query("insert into public.billing_checkout_attempts (owner_id, plan_code, price_version, amount_minor, currency, provider, idempotency_key, expires_at) values ($1, 'tf_monthly_ars_v1', 1, 1, 'ARS', 'fake', 'key-12345678', now())", [owner]), /billing_amount_mismatch/);
    await insertExecution(owner, "e_ok");
  });

  await check("2.2 una cuenta en un estado pago NO puede existir sin un período registrado que la respalde", async () => {
    const owner = await newUser();
    const row = await store.ensureAccount(owner);
    await assert.rejects(admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v1', current_period_start = $2, current_period_end = $3, version = version + 1 where owner_id = $1", [owner, ar("2026-10-01"), ar("2026-11-01")]), /billing_period_not_backed_by_payment/);
    await assert.rejects(admin.query("update public.billing_subscriptions set status = 'active', version = version + 1 where owner_id = $1", [owner]), /check|violates|billing_period_not_backed_by_payment/, "sin período ni plan");
    await admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', 'p_backed', 'tf_monthly_ars_v1', 1, 2490000, 'ARS', $2, $3)", [owner, ar("2026-10-01"), ar("2026-11-01")]);
    await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v1', current_period_start = $2, current_period_end = $3, version = version + 1 where owner_id = $1", [owner, ar("2026-10-01"), ar("2026-11-01")]);
    assert.equal((await sub(owner)).status, "active");
    await assert.rejects(admin.query("update public.billing_subscriptions set current_period_end = $2, version = version + 1 where owner_id = $1", [owner, ar("2030-01-01")]), /billing_period_not_backed_by_payment/, "tampoco se puede alargar el período a mano");
    assert.equal(row.version, 1);
  });

  await check("2.3 toda escritura de una suscripción debe subir la versión en uno (control optimista)", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    await assert.rejects(admin.query("update public.billing_subscriptions set pending_plan_code = null where owner_id = $1", [owner]), /billing_version_not_bumped/);
    await assert.rejects(admin.query("update public.billing_subscriptions set version = version + 5 where owner_id = $1", [owner]), /billing_version_not_bumped/);
    await admin.query("update public.billing_subscriptions set pending_plan_code = null, version = version + 1 where owner_id = $1", [owner]);
    assert.equal(Number((await sub(owner)).version), 2);
  });

  await check("2.4 una ejecución del proveedor es única y NUNCA cambia de propietaria; un resultado más viejo no pisa a uno más nuevo", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await store.ensureAccount(a);
    await store.ensureAccount(b);
    await insertExecution(a, "exe_unique", { outcome: "rejected" });
    await assert.rejects(insertExecution(b, "exe_unique"), /duplicate key|unique/);
    await assert.rejects(admin.query("update public.billing_executions set owner_id = $1 where execution_uid = 'exe_unique'", [b]), /billing_owner_immutable/);
    const batch = (owner, outcome, occurredAt) => ({ executions: [{ ownerId: owner, provider: "fake", executionUid: "exe_unique", providerPaymentId: "p", outcome, planCode: "tf_monthly_ars_v1", amountMinor: 2490000, currency: "ARS", dueAt: ar("2026-10-01"), occurredAt }], periods: [], subscriptions: [], reconciliations: [], events: [] });
    await store.commitBatch(batch(a, "approved", ar("2026-10-01", 5)));
    assert.equal((await admin.query("select outcome from public.billing_executions where execution_uid = 'exe_unique'")).rows[0].outcome, "approved", "el más reciente gana");
    await store.commitBatch(batch(a, "rejected", ar("2026-10-01", 3)));
    assert.equal((await admin.query("select outcome from public.billing_executions where execution_uid = 'exe_unique'")).rows[0].outcome, "approved", "un rechazo VIEJO que llega tarde no pisa al cobro aprobado");
    await store.commitBatch(batch(b, "rejected", ar("2026-12-01")));
    const row = (await admin.query("select owner_id, outcome from public.billing_executions where execution_uid = 'exe_unique'")).rows[0];
    assert.deepEqual([row.owner_id, row.outcome], [a, "approved"], "otra propietaria no puede pisar la ejecución");
  });

  await check("2.4b un MISMO lote con el mismo cobro repetido (aprobado, liquidado, rechazo viejo) no falla y deja el resultado más reciente; los períodos repetidos tampoco", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    const execution = (outcome, occurredAt) => ({ ownerId: owner, provider: "fake", executionUid: "exe_dup_batch", providerPaymentId: "p", outcome, planCode: "tf_monthly_ars_v1", amountMinor: 2490000, currency: "ARS", dueAt: ar("2026-10-01"), occurredAt });
    const period = { ownerId: owner, provider: "fake", executionUid: "exe_dup_batch", planCode: "tf_monthly_ars_v1", priceVersion: 1, amountMinor: 2490000, currency: "ARS", periodStart: ar("2026-10-01"), periodEnd: ar("2026-11-01") };
    await store.commitBatch({ executions: [execution("rejected", ar("2026-10-01", 9)), execution("approved", ar("2026-10-01", 10)), execution("approved", ar("2026-10-01", 12)), execution("rejected", ar("2026-10-01", 8))], periods: [period, period], subscriptions: [], reconciliations: [], events: [] });
    const rows = (await admin.query("select outcome, occurred_at from public.billing_executions where execution_uid = 'exe_dup_batch'")).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].outcome, iso(rows[0].occurred_at)], ["approved", ar("2026-10-01", 12)]);
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where execution_uid = 'exe_dup_batch'")).rows[0].n, 1);
  });

  await check("2.5 intentos de checkout: UNO abierto por cuenta y la misma clave de idempotencia es única; un solo cambio de plan programado", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    const insertAttempt = (key, status) => admin.query("insert into public.billing_checkout_attempts (owner_id, plan_code, price_version, amount_minor, currency, provider, idempotency_key, status, expires_at) values ($1, 'tf_monthly_ars_v1', 1, 2490000, 'ARS', 'fake', $2, $3, now() + interval '1 hour')", [owner, key, status]);
    await insertAttempt("key-direct-0001", "open");
    await assert.rejects(insertAttempt("key-direct-0002", "open"), /unique|duplicate/);
    await assert.rejects(insertAttempt("key-direct-0001", "expired"), /unique|duplicate/);
    await insertAttempt("key-direct-0003", "completed");
    const insertChange = (key, status) => admin.query("insert into public.billing_plan_changes (owner_id, kind, from_plan_code, to_plan_code, status, idempotency_key) values ($1, 'plan_change', 'tf_monthly_ars_v1', 'tf_annual_ars_v1', $2, $3)", [owner, status, key]);
    await insertChange("chg-1", "scheduled");
    await assert.rejects(insertChange("chg-2", "scheduled"), /unique|duplicate/);
    await insertChange("chg-3", "superseded");
  });

  await check("2.6 avisos: sin cuerpo crudo (límite de tamaño), identidad única y retención definida", async () => {
    const insert = (key, normalized) => admin.query("insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized) values ($1, 'fake', 'other', $2, $3::jsonb)", [key, "a".repeat(64), JSON.stringify(normalized)]);
    await insert("1".repeat(64), { ok: true });
    await assert.rejects(insert("1".repeat(64), { ok: true }), /unique|duplicate/);
    await assert.rejects(insert("2".repeat(64), { raw: "x".repeat(5000) }), /check|violates/, "un cuerpo grande no cabe");
    await assert.rejects(admin.query("insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized) values ('zz', 'fake', 'other', $1, '{}')", ["a".repeat(64)]), /check|violates/);
    const row = (await admin.query("select purge_after - received_at as retention from public.billing_webhook_events where dedup_key = $1", ["1".repeat(64)])).rows[0];
    assert.ok(row.retention.days >= 89 && row.retention.days <= 91, JSON.stringify(row.retention));
    await assert.rejects(store.ingestEvents(Array.from({ length: 1 }, () => ({}))), /./, "una fila inválida no entra");
    const tooMany = await svcConn.query("select public.billing_ingest_webhook_events($1::jsonb)", [JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ dedup_key: String(i).padStart(64, "0"), provider: "fake", event_type: "other", payload_hash: "a".repeat(64), normalized: {} })))]).then(() => "ok", (e) => e.message);
    assert.match(tooMany, /billing_batch_too_large/);
  });

  await check("2.7 CONTROL OPTIMISTA: una escritura con una versión vieja no escribe nada, informa el conflicto y devuelve a la cola los avisos de esa cuenta; con la versión vigente escribe y sube la versión", async () => {
    const acct = await accountWithSubscriber();
    const before = await sub(acct.owner);
    const current = await store.loadSubscriptions([acct.owner]);
    const snapshot = current.get(acct.owner);
    // Un aviso en proceso de esa cuenta (para comprobar que vuelve a la cola).
    await admin.query("delete from public.billing_webhook_events where dedup_key = $1", ["7".repeat(64)]);
    await admin.query("insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized, status, locked_until, locked_by) values ($1, 'fake', 'other', $2, '{}', 'processing', now() + interval '5 minutes', 'opt-test')", ["7".repeat(64), "a".repeat(64)]);
    const eventId = (await admin.query("select id from public.billing_webhook_events where dedup_key = $1", ["7".repeat(64)])).rows[0].id;
    const write = (expectedVersion) => ({ executions: [], periods: [], reconciliations: [], events: [{ id: Number(eventId), ownerId: acct.owner, status: "processed", result: "fact", retryDelaySeconds: 0 }], subscriptions: [{ snapshot: { ...snapshot, pendingPlanCode: "tf_annual_ars_v1" }, expectedVersion, nextCheckAt: null }] });
    const stale = await store.commitBatch(write(Number(before.version) + 40));
    assert.deepEqual(stale, { conflicts: [acct.owner], subscriptionsWritten: 0 });
    const afterStale = await sub(acct.owner);
    assert.equal(afterStale.pending_plan_code, null, "no se escribió nada");
    assert.equal(Number(afterStale.version), Number(before.version));
    const event = (await admin.query("select status, attempts, locked_until from public.billing_webhook_events where id = $1", [eventId])).rows[0];
    assert.deepEqual([event.status, event.attempts, event.locked_until], ["received", 1, null], "el aviso de la cuenta en conflicto vuelve a la cola");
    const fresh = await store.commitBatch(write(Number(before.version)));
    assert.deepEqual(fresh, { conflicts: [], subscriptionsWritten: 1 });
    const afterFresh = await sub(acct.owner);
    assert.equal(afterFresh.pending_plan_code, "tf_annual_ars_v1");
    assert.equal(Number(afterFresh.version), Number(before.version) + 1);
    const again = await store.commitBatch(write(Number(before.version)));
    assert.deepEqual(again.conflicts, [acct.owner], "repetir con la versión ya usada es un conflicto, no una doble escritura");
  });

  // =============================================================== Parte 3: checkout (atómico, uno vivo por cuenta)
  /** Pone una cuenta en un estado (con los cobros/períodos que ese estado exige) para probar reglas por estado. */
  const accountIn = async (status) => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    const needsPeriod = ["active", "past_due", "grace_period", "limited", "cancel_at_period_end"].includes(status);
    if (needsPeriod) {
      await admin.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', $2, 'tf_monthly_ars_v1', 1, 2490000, 'ARS', $3, $4)", [owner, `exe_state_${owner.slice(-6)}`, ar("2026-09-01"), ar("2026-10-01")]);
    }
    await admin.query("update public.billing_subscriptions set status = $2, grandfathered = $3, plan_code = $4, current_period_start = $5, current_period_end = $6, version = version + 1 where owner_id = $1", [owner, status, status === "grandfathered", needsPeriod ? "tf_monthly_ars_v1" : null, needsPeriod ? ar("2026-09-01") : null, needsPeriod ? ar("2026-10-01") : null]);
    return owner;
  };

  await check("3.1 DIFERENCIAL: el SQL permite abrir un checkout en los MISMOS estados que la máquina de estados del servidor (checkout_started)", async () => {
    for (const status of smLib.BILLING_STATUSES) {
      const owner = await accountIn(status);
      const result = await store.openCheckoutAttempt({ ownerId: owner, plan: MONTHLY, provider: "fake", idempotencyKey: `diff-${status}-aaaa`, expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
      assert.equal(result.ok, smLib.canApplyTrigger(status, "checkout_started"), `${status}: SQL=${result.ok} máquina=${smLib.canApplyTrigger(status, "checkout_started")}`);
      if (!result.ok) assert.equal(result.reason, "not_allowed", status);
    }
  });

  await check("3.2 el precio sale del catálogo de la BASE, no del llamador; un plan inexistente o inactivo se rechaza", async () => {
    const owner = await accountIn("pending");
    const opened = await store.openCheckoutAttempt({ ownerId: owner, plan: ANNUAL, provider: "fake", idempotencyKey: "price-key-aaaa", expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    assert.equal(opened.ok, true);
    assert.equal(opened.attempt.amountMinor, 24_900_000);
    assert.equal(opened.attempt.priceVersion, 1);
    const forged = await svcConn.query("select public.billing_open_checkout_attempt($1, 'tf_annual_ars_v1; drop table x', 'fake', 'forged-key-aaaa', now() + interval '1 hour') as v", [owner]);
    assert.equal(forged.rows[0].v.reason, "plan_invalid");
    await admin.query("update public.billing_plans set active = false where code = 'tf_quarterly_ars_v1'");
    const inactive = await svcConn.query("select public.billing_open_checkout_attempt($1, 'tf_quarterly_ars_v1', 'fake', 'inactive-key-aaa', now() + interval '1 hour') as v", [owner]);
    assert.equal(inactive.rows[0].v.reason, "plan_invalid");
    await admin.query("update public.billing_plans set active = true where code = 'tf_quarterly_ars_v1'");
    assert.equal((await svcConn.query("select public.billing_open_checkout_attempt($1, 'tf_monthly_ars_v1', 'fake', 'x', now()) as v", [uuidFor(88888)])).rows[0].v.reason, "no_account");
  });

  await check("3.3 DOS PESTAÑAS a la vez (10 conexiones simultáneas): UN solo intento vivo del mismo plan; otros planes lo reemplazan sin dejar dos abiertos", async () => {
    const owner = await accountIn("pending");
    const conns = await Promise.all(Array.from({ length: 10 }, async () => new RpcBillingStore(await makeRpcCaller(await pg.session("", "service_role")))));
    const expiresAt = new Date(NOW.getTime() + 3_600_000).toISOString();
    const same = await Promise.all(conns.map((s, i) => s.openCheckoutAttempt({ ownerId: owner, plan: MONTHLY, provider: "fake", idempotencyKey: `tab-${i}-aaaaaaaa`, expiresAt })));
    assert.ok(same.every((r) => r.ok));
    assert.equal(new Set(same.map((r) => r.attempt.id)).size, 1, "todas reutilizan el mismo intento");
    assert.equal(same.filter((r) => r.created).length, 1);
    const mixed = await Promise.all(conns.map((s, i) => s.openCheckoutAttempt({ ownerId: owner, plan: i % 2 ? ANNUAL : MONTHLY, provider: "fake", idempotencyKey: `mix-${i}-aaaaaaaa`, expiresAt })));
    assert.ok(mixed.every((r) => r.ok));
    const live = (await admin.query("select count(*)::int n from public.billing_checkout_attempts where owner_id = $1 and status in ('open','completed') and expires_at > now()", [owner])).rows[0].n;
    assert.equal(live, 1, "nunca dos intentos vivos");
  });

  await check("3.4 completar un intento es idempotente, fija el suscriptor UNA vez y no activa la suscripción", async () => {
    const owner = await accountIn("pending");
    const opened = await store.openCheckoutAttempt({ ownerId: owner, plan: MONTHLY, provider: "fake", idempotencyKey: "complete-key-aa", expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    assert.equal(await store.completeCheckoutAttempt({ attemptId: opened.attempt.id, providerCheckoutUid: "c1", providerSubscriberUid: "SUBR_X", redirectUrl: "https://mobbex.com/p/x" }), true);
    assert.equal(await store.completeCheckoutAttempt({ attemptId: opened.attempt.id, providerCheckoutUid: "c1", providerSubscriberUid: "SUBR_X", redirectUrl: "https://mobbex.com/p/x" }), true);
    assert.equal(await store.completeCheckoutAttempt({ attemptId: "00000000-0000-4000-8000-0000000000ff", providerCheckoutUid: "c", providerSubscriberUid: null, redirectUrl: "https://mobbex.com/p/y" }), false);
    const row = await sub(owner);
    assert.equal(row.provider_subscriber_uid, "SUBR_X");
    assert.equal(row.status, "pending", "volver del proveedor no activa nada");
    // Un suscriptor del proveedor sólo puede pertenecer a UNA cuenta.
    const other = await accountIn("pending");
    const attempt = await store.openCheckoutAttempt({ ownerId: other, plan: MONTHLY, provider: "fake", idempotencyKey: "complete-key-bb", expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    await assert.rejects(store.completeCheckoutAttempt({ attemptId: attempt.attempt.id, providerCheckoutUid: "c2", providerSubscriberUid: "SUBR_X", redirectUrl: "https://mobbex.com/p/z" }), /unique|duplicate/);
  });

  await check("3.5 volver a suscribirse desde canceled o expired: la cuenta vuelve a pending y el período anterior deja de contar", async () => {
    const owner = await accountIn("canceled");
    await admin.query("update public.billing_subscriptions set cancel_requested_at = now() - interval '5 days', version = version + 1 where owner_id = $1", [owner]);
    const opened = await store.openCheckoutAttempt({ ownerId: owner, plan: MONTHLY, provider: "fake", idempotencyKey: "restart-key-aa", expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
    assert.equal(opened.ok, true);
    const row = await sub(owner);
    assert.equal(row.status, "pending");
    assert.equal(row.cancel_requested_at, null);
    assert.ok(row.restarted_at);
    assert.equal(row.grandfathered, false);
  });

  // =============================================================== Parte 4: avisos (ingesta, reclamo, arrendamiento, concurrencia)
  const eventRows = (n, prefix) => Array.from({ length: n }, (_, i) => ({ dedupKey: crypto.createHash("sha256").update(`${prefix}-${i}`).digest("hex"), provider: "fake", eventType: "other", payloadHash: "a".repeat(64), hint: { providerPaymentId: null, executionUid: null, subscriberUid: null, subscriberReference: null }, receivedAt: NOW.toISOString() }));

  await check("4.1 ingesta idempotente: los duplicados se descartan y se cuentan", async () => {
    const rows = eventRows(5, "ingest");
    assert.deepEqual(await store.ingestEvents(rows), { inserted: 5, duplicates: 0 });
    assert.deepEqual(await store.ingestEvents([...rows, ...eventRows(2, "ingest-b")]), { inserted: 2, duplicates: 5 });
    assert.deepEqual(await store.ingestEvents(rows), { inserted: 0, duplicates: 5 });
  });

  await check("4.2 reclamo con arrendamiento: un aviso se reclama una vez; si el proceso se interrumpe, el arrendamiento vence y vuelve a la cola sin perderse", async () => {
    await admin.query("delete from public.billing_webhook_events");
    await store.ingestEvents(eventRows(6, "lease"));
    const first = await store.claimEvents({ limit: 4, leaseSeconds: 60, worker: "w1", maxAttempts: 3 });
    assert.equal(first.length, 4);
    const second = await store.claimEvents({ limit: 10, leaseSeconds: 60, worker: "w2", maxAttempts: 3 });
    assert.equal(second.length, 2, "los ya reclamados no se entregan de nuevo");
    assert.equal((await store.claimEvents({ limit: 10, leaseSeconds: 60, worker: "w3", maxAttempts: 3 })).length, 0);
    // El proceso w1 «muere»: su arrendamiento vence.
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 minute' where locked_by = 'w1'");
    const recovered = await store.claimEvents({ limit: 10, leaseSeconds: 60, worker: "w4", maxAttempts: 3 });
    assert.equal(recovered.length, 4, "los cuatro vuelven a la cola y se reclaman de nuevo");
    assert.ok(recovered.every((e) => e.attempts === 1), "la interrupción cuenta como un intento");
    // Tres interrupciones seguidas: pasa a dead (no hay bucle infinito) pero se conserva.
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 minute' where locked_by = 'w4'");
    await store.claimEvents({ limit: 10, leaseSeconds: 60, worker: "w5", maxAttempts: 3 });
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 minute' where locked_by = 'w5'");
    const last = await store.claimEvents({ limit: 10, leaseSeconds: 60, worker: "w6", maxAttempts: 3 });
    assert.equal(last.length, 0);
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events where status = 'dead'")).rows[0].n, 4);
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events")).rows[0].n, 6, "nada se pierde");
  });

  await check("4.3 CONCURRENCIA: 6 trabajadores reclaman 1.500 avisos a la vez; cada aviso se entrega a UNO solo (sin duplicados ni faltantes)", async () => {
    await admin.query("delete from public.billing_webhook_events");
    for (let offset = 0; offset < 1500; offset += 150) await store.ingestEvents(eventRows(150, `conc-${offset}`).map((row, i) => ({ ...row, dedupKey: crypto.createHash("sha256").update(`conc-${offset + i}`).digest("hex") })));
    const workers = await Promise.all(Array.from({ length: 6 }, async () => new RpcBillingStore(await makeRpcCaller(await pg.session("", "service_role")))));
    const claimed = await Promise.all(workers.map(async (worker, index) => {
      const mine = [];
      for (let guard = 0; guard < 60; guard += 1) {
        const batch = await worker.claimEvents({ limit: 100, leaseSeconds: 60, worker: `cw-${index}`, maxAttempts: 5 });
        if (batch.length === 0) break;
        mine.push(...batch.map((event) => event.id));
      }
      return mine;
    }));
    const all = claimed.flat();
    assert.equal(all.length, 1500);
    assert.equal(new Set(all).size, 1500, "ningún aviso entregado dos veces");
    assert.ok(claimed.filter((list) => list.length > 0).length >= 2, "el trabajo se repartió");
  });

  // =============================================================== Parte 5: tubería completa (aviso → verificación → conciliación → estado)
  await check("5.1 PRIMER COBRO: aviso verificado + consulta al proveedor + conciliación → active, con cobro, período y versión", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    assert.equal((await deliver(o)).status, 200);
    const stats = await drain();
    assert.equal(stats.facts, 1);
    const row = await sub(acct.owner);
    assert.equal(row.status, "active");
    assert.equal(row.plan_code, "tf_monthly_ars_v1");
    assert.equal(iso(row.current_period_end), ar("2026-11-01"));
    assert.equal(iso(row.next_check_at), ar("2026-11-01"));
    assert.equal(Number(row.version), 3, "ensure(1) → complete checkout (2) → pago (3)");
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 1);
    assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1 and outcome = 'approved'", [acct.owner])).rows[0].n, 1);
    assert.equal((await admin.query("select status, result from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [o.providerPaymentId])).rows[0].status, "processed");
  });

  await check("5.2 webhook DUPLICADO ×5 y reproceso: un solo cobro, un solo período, la versión no sube de nuevo", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    for (let i = 0; i < 5; i += 1) await deliver(o);
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [o.providerPaymentId])).rows[0].n, 1);
    await drain();
    const version = (await sub(acct.owner)).version;
    // Un aviso NUEVO del mismo pago (liquidación posterior, estado 300) se procesa pero no duplica ni cambia nada.
    const later = { ...o, statusCode: "300", occurredAt: ar("2026-10-02", 9) };
    provider.seedOperation(later);
    await ageNotices();
    await deliver(later);
    await drain();
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 1);
    assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1", [acct.owner])).rows[0].n, 1);
    assert.equal((await sub(acct.owner)).version, version, "sin cambios reales no se escribe la suscripción");
    assert.equal((await sub(acct.owner)).status, "active");
  });

  await check("5.3 webhooks FUERA DE ORDEN (procesados de a uno, en lotes separados) dan el MISMO estado que en orden", async () => {
    const mk = async (inOrder) => {
      const acct = await accountWithSubscriber();
      const ops = [
        op(acct, 1, { dueAt: ar("2026-07-01", 10), occurredAt: ar("2026-07-01", 10, 5) }),
        op(acct, 2, { dueAt: ar("2026-08-01", 10), occurredAt: ar("2026-08-01", 10, 5) }),
        op(acct, 3, { dueAt: ar("2026-09-01", 10), occurredAt: ar("2026-09-01", 10, 5) }),
        op(acct, 4, { dueAt: ar("2026-10-01", 10), occurredAt: ar("2026-10-01", 10, 5), outcome: "rejected", statusCode: "410" }),
      ];
      for (const o of ops) provider.seedOperation(o);
      const order = inOrder ? [0, 1, 2, 3] : [3, 1, 0, 2];
      for (const index of order) {
        await deliver(ops[index]);
        await drain({ batchSize: 1 });
      }
      return acct;
    };
    const ordered = await mk(true);
    const shuffled = await mk(false);
    const view = (row) => ({ status: row.status, plan: row.plan_code, g: row.grandfathered, start: iso(row.current_period_start), end: iso(row.current_period_end), rej: iso(row.renewal_rejected_due_at), grace: iso(row.grace_ends_at), next: iso(row.next_check_at) });
    const [a, b] = [await sub(ordered.owner), await sub(shuffled.owner)];
    assert.deepEqual(view(b), view(a));
    assert.equal(a.status, "limited", "la renovación del 1/10 fue rechazada y la gracia terminó el 7/10");
    assert.equal(iso(a.current_period_end), ar("2026-10-01"));
    assert.equal(iso(a.renewal_rejected_due_at), ar("2026-10-01", 10));
    const periods = async (owner) => (await admin.query("select period_start, period_end from public.billing_periods where owner_id = $1 order by period_start", [owner])).rows.map((r) => [iso(r.period_start), iso(r.period_end)]);
    assert.deepEqual(await periods(shuffled.owner), await periods(ordered.owner));
  });

  await check("5.4 aviso FALSO / de un suscriptor AJENO → 200 uniforme y se descarta SIN consultar al proveedor; pago inexistente de un suscriptor nuestro → anomalía; la cuenta no cambia", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    const stranger = op({ owner: acct.owner, ref: "tfs_" + "e".repeat(32), subscriberUid: "NOBODY" }, 9, { subscriberReference: "tfs_" + "e".repeat(32), subscriberUid: "NOBODY" });
    const lookupsBefore = provider.calls.getOperation;
    assert.equal((await deliver(stranger)).status, 200, "respuesta uniforme: no se revela que el suscriptor no existe");
    assert.equal((await deliver(o, { raw: "{ no es json" })).status, 400);
    await drain();
    assert.equal(provider.calls.getOperation, lookupsBefore, "un identificador inventado NO provoca ninguna consulta al proveedor");
    assert.equal((await admin.query("select status, result from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [stranger.providerPaymentId])).rows[0].result, "ignored:unknown_subscriber");
    // Un suscriptor nuestro con un pago que el proveedor no conoce: se consulta una vez y queda como anomalía.
    assert.equal((await deliver(o)).status, 200);
    await drain();
    assert.equal((await sub(acct.owner)).status, "pending");
    const rec = (await admin.query("select kind, owner_id from public.billing_reconciliations where dedupe_key = $1 and status = 'open'", [`unknown_reference:${o.providerPaymentId}`])).rows;
    assert.equal(rec.length, 1);
    assert.equal(rec[0].kind, "unknown_reference");
    assert.equal(rec[0].owner_id, acct.owner);
  });

  await check("5.5 IMPORTE, MONEDA y PLAN manipulados: la cuenta no cambia y queda UNA anomalía por pago (aunque el aviso se repita)", async () => {
    const cases = [
      ["amount_mismatch", { amountMinor: 100 }],
      ["amount_mismatch", { amountMinor: 24_900_000 }],
      ["currency_mismatch", { currency: "USD" }],
      ["unknown_plan", { planReference: "tf_free_ars_v1" }],
      ["plan_not_expected", { planReference: "tf_annual_ars_v1", amountMinor: 24_900_000 }],
    ];
    for (const [kind, over] of cases) {
      const acct = await accountWithSubscriber();
      const o = op(acct, 1, over);
      provider.seedOperation(o);
      await deliver(o);
      await drain();
      assert.equal((await sub(acct.owner)).status, "pending", `${kind} ${JSON.stringify(over)}`);
      assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1", [acct.owner])).rows[0].n, 0, "no se registra el cobro");
      assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 0);
      const recs = (await admin.query("select kind from public.billing_reconciliations where dedupe_key = $1", [`${kind}:${o.providerPaymentId}`])).rows;
      assert.equal(recs.length, 1, `${kind}: una anomalía`);
    }
  });

  await check("5.6 owner_id AJENO: un aviso que mezcla la referencia de B con un pago de A no acredita nada a ninguna de las dos", async () => {
    const [a, b] = [await accountWithSubscriber(), await accountWithSubscriber()];
    const real = op(a, 1);
    provider.seedOperation(real); // el proveedor dice: este pago es del suscriptor de A
    const forgedBody = webhookBody({ ...real, subscriberReference: b.ref, subscriberUid: b.subscriberUid }); // el aviso dice que es de B
    await deliver(null, { raw: forgedBody });
    await drain();
    assert.equal((await sub(a.owner)).status, "pending");
    assert.equal((await sub(b.owner)).status, "pending");
    assert.equal((await admin.query("select count(*)::int n from public.billing_reconciliations where dedupe_key = $1 and kind = 'owner_mismatch'", [`owner_mismatch:${real.providerPaymentId}`])).rows[0].n, 1);
  });

  await check("5.7 pago aprobado DESPUÉS de cancelar: se registra el cobro y la anomalía; no revive una cuenta ya cancelada", async () => {
    const acct = await accountWithSubscriber();
    const first = op(acct, 1, { dueAt: ar("2026-10-01", 10), occurredAt: ar("2026-10-01", 10, 5) });
    provider.seedOperation(first);
    await deliver(first);
    await drain();
    const cmdDeps = { store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) };
    assert.deepEqual(await cancelSubscription(cmdDeps, acct.owner), { ok: true, changed: true });
    assert.equal((await sub(acct.owner)).status, "cancel_at_period_end");
    assert.ok(provider.canceled.has(acct.subscriberUid));
    const late = op(acct, 2, { dueAt: ar("2026-11-01", 10), occurredAt: ar("2026-11-01", 10, 5) });
    provider.seedOperation(late);
    await deliver(late);
    await drain({ now: () => new Date(ar("2026-11-05", 12)) });
    const recs = (await admin.query("select kind from public.billing_reconciliations where owner_id = $1 order by id", [acct.owner])).rows.map((r) => r.kind);
    assert.ok(recs.includes("paid_after_cancel"), recs.join());
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 2, "el cobro quedó registrado (el dinero no se pierde)");
    assert.notEqual((await sub(acct.owner)).status, "active");
    // El historial de la cancelación se conserva.
    assert.equal((await admin.query("select count(*)::int n from public.billing_plan_changes where owner_id = $1 and kind = 'cancel'", [acct.owner])).rows[0].n, 1);
  });

  await check("5.8 caída o timeout del PROVEEDOR: el aviso se reintenta con espera y se procesa al volver; tras el máximo de intentos pasa a dead (sin perderse)", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    provider.injectFailure("getOperation", "timeout", 2);
    const s1 = await drain();
    assert.equal(s1.retried, 1);
    const ev = () => admin.query("select status, attempts, result, next_attempt_at > now() as waiting from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [o.providerPaymentId]).then((r) => r.rows[0]);
    assert.deepEqual([(await ev()).status, (await ev()).attempts, (await ev()).waiting], ["failed", 1, true]);
    assert.equal((await drain()).claimed, 0, "todavía está esperando su turno");
    await admin.query("update public.billing_webhook_events set next_attempt_at = now() where normalized->>'providerPaymentId' = $1", [o.providerPaymentId]);
    await drain();
    assert.equal((await ev()).attempts, 2);
    await admin.query("update public.billing_webhook_events set next_attempt_at = now() where normalized->>'providerPaymentId' = $1", [o.providerPaymentId]);
    await drain();
    assert.equal((await ev()).status, "processed");
    assert.equal((await sub(acct.owner)).status, "active");
    // Caída persistente: dead + anomalía, el aviso se conserva.
    const acct2 = await accountWithSubscriber();
    const o2 = op(acct2, 1);
    provider.seedOperation(o2);
    await deliver(o2);
    provider.injectFailure("getOperation", "unavailable", 50);
    for (let i = 0; i < 4; i += 1) {
      await admin.query("update public.billing_webhook_events set next_attempt_at = now() where normalized->>'providerPaymentId' = $1", [o2.providerPaymentId]);
      await drain({ maxAttempts: 3 });
    }
    assert.equal((await admin.query("select status from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [o2.providerPaymentId])).rows[0].status, "dead");
    assert.equal((await admin.query("select count(*)::int n from public.billing_reconciliations where dedupe_key = $1", [`provider_unreachable:${o2.providerPaymentId}`])).rows[0].n, 1);
    assert.equal((await sub(acct2.owner)).status, "pending");
    provider.failures = [];
  });

  await check("5.9 RESPUESTA PERDIDA / proceso interrumpido: el lote reclamado queda en proceso, vence el arrendamiento y se reprocesa UNA vez (sin duplicar el cobro)", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    const claimed = await store.claimEvents({ limit: 100, leaseSeconds: 60, worker: "dying-worker", maxAttempts: 5 });
    assert.ok(claimed.length >= 1);
    assert.equal((await drain()).claimed, 0, "mientras el arrendamiento vive nadie más lo toma");
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 second' where locked_by = 'dying-worker'");
    await drain();
    assert.equal((await sub(acct.owner)).status, "active");
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 1);
  });

  await check("5.10 CONCURRENCIA sobre la MISMA cuenta: dos trabajadores con avisos de la misma propietaria; resultado = secuencial, sin períodos duplicados", async () => {
    const acct = await accountWithSubscriber();
    const dues = ["2026-08-01", "2026-09-01", "2026-10-01"];
    const ops = dues.map((due, i) => op(acct, i + 1, { dueAt: ar(due, 10), occurredAt: ar(due, 10, 5) }));
    for (const o of ops) provider.seedOperation(o);
    for (const o of ops) await deliver(o);
    const workers = await Promise.all([0, 1, 2].map(async (i) => ({ store: new RpcBillingStore(await makeRpcCaller(await pg.session("", "service_role"))), name: `same-${i}` })));
    const stats = await Promise.all(workers.map((w) => drainEvents(deps({ store: w.store, worker: w.name, batchSize: 1 }), 10)));
    assert.ok(stats.reduce((n, s) => n + s.facts, 0) >= 3, "cada cobro se procesó al menos una vez (un conflicto de versión lo reencola)");
    assert.equal((await sub(acct.owner)).status, "active");
    assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1", [acct.owner])).rows[0].n, 3, "exactamente tres cobros registrados");
    const periods = (await admin.query("select period_start, period_end from public.billing_periods where owner_id = $1 order by period_start", [acct.owner])).rows.map((r) => [iso(r.period_start), iso(r.period_end)]);
    assert.deepEqual(periods, [[ar("2026-08-01"), ar("2026-09-01")], [ar("2026-09-01"), ar("2026-10-01")], [ar("2026-10-01"), ar("2026-11-01")]]);
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events e where e.owner_id = $1 and e.status = 'processed'", [acct.owner])).rows[0].n, 3);
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events where status in ('received','processing','failed') and owner_id = $1", [acct.owner])).rows[0].n, 0, "ningún aviso perdido ni colgado");
  });

  await check("5.11 CANCELACIÓN y CAMBIO DE PLAN concurrentes desde dos conexiones: un único registro de cancelación y un único cambio programado", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    await drain();
    const mk = async () => ({ store: new RpcBillingStore(await makeRpcCaller(await pg.session("", "service_role"))), provider: new FakeProviderAdapter(), flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) });
    const [d1, d2, d3, d4] = await Promise.all([mk(), mk(), mk(), mk()]);
    const cancels = await Promise.all([cancelSubscription(d1, acct.owner), cancelSubscription(d2, acct.owner), cancelSubscription(d3, acct.owner)]);
    assert.ok(cancels.every((r) => r.ok), JSON.stringify(cancels));
    assert.equal((await admin.query("select count(*)::int n from public.billing_plan_changes where owner_id = $1 and kind = 'cancel'", [acct.owner])).rows[0].n, 1, "cancelación repetida: un solo registro");
    const row = await sub(acct.owner);
    assert.equal(row.status, "cancel_at_period_end");
    assert.equal(row.plan_code, "tf_monthly_ars_v1", "cancelar no borra nada");
    // Cambio de plan concurrente sobre otra cuenta activa.
    const acct2 = await accountWithSubscriber();
    const o2 = op(acct2, 1);
    provider.seedOperation(o2);
    await deliver(o2);
    await drain();
    const changes = await Promise.all([changePlan(d1, acct2.owner, "tf_quarterly_ars_v1"), changePlan(d2, acct2.owner, "tf_annual_ars_v1"), changePlan(d4, acct2.owner, "tf_semiannual_ars_v1")]);
    assert.ok(changes.every((r) => r.ok), JSON.stringify(changes));
    const scheduled = (await admin.query("select to_plan_code from public.billing_plan_changes where owner_id = $1 and kind = 'plan_change' and status = 'scheduled'", [acct2.owner])).rows;
    assert.equal(scheduled.length, 1, "un solo cambio programado");
    const row2 = await sub(acct2.owner);
    assert.equal(row2.pending_plan_code, scheduled[0].to_plan_code, "la suscripción y el historial coinciden");
    assert.equal(row2.plan_code, "tf_monthly_ars_v1");
    assert.equal(row2.status, "active");
    assert.equal((await admin.query("select count(*)::int n from public.billing_subscriptions where owner_id = $1", [acct2.owner])).rows[0].n, 1, "no se duplica la suscripción");
  });

  await check("5.12 barrido del RELOJ: el vencimiento y el fin de la gracia se aplican por lotes, sólo a las cuentas que vencen, y repetirlo no cambia nada", async () => {
    const mkActive = async (end) => {
      const acct = await accountWithSubscriber();
      const o = op(acct, 1, { dueAt: end, occurredAt: end });
      provider.seedOperation(o);
      await deliver(o);
      await drain({ now: () => new Date(ar("2026-10-10", 12)) });
      return acct;
    };
    const dueSoon = await mkActive(ar("2026-09-20", 10)); // venció el 20/10 → 20/9+1 mes = 20/10
    const later = await mkActive(ar("2026-10-10", 10)); // vence el 10/11
    const clockNow = new Date(ar("2026-10-21", 12));
    const sweep1 = await runClockSweep(deps({ now: () => clockNow }));
    assert.ok(sweep1.evaluated >= 1);
    assert.equal((await sub(dueSoon.owner)).status, "past_due");
    assert.equal((await sub(later.owner)).status, "active", "la que no vence no se toca");
    const sweep2 = await runClockSweep(deps({ now: () => clockNow }));
    assert.equal(sweep2.subscriptionsWritten, 0, "idempotente");
    const clockLater = new Date(ar("2026-10-30", 12));
    await runClockSweep(deps({ now: () => clockLater }));
    assert.equal((await sub(dueSoon.owner)).status, "limited");
    assert.equal((await sub(dueSoon.owner)).next_check_at, null);
  });

  await check("5.13 conciliación PERIÓDICA contra el proveedor: un aviso que nunca llegó se recupera por barrido paginado, con cursor", async () => {
    const accts = [];
    for (let i = 0; i < 3; i += 1) accts.push(await accountWithSubscriber());
    const sweepOps = accts.map((acct, i) => op(acct, 1, { providerPaymentId: `sweep_pay_${i}_${acct.owner.slice(-4)}`, executionUid: `sweep_exe_${i}_${acct.owner.slice(-4)}`, occurredAt: ar("2026-10-20", 9, i) }));
    for (const o of sweepOps) provider.seedOperation(o);
    const stats = await runProviderSweep(deps());
    assert.ok(stats.facts >= 3, JSON.stringify(stats));
    for (const acct of accts) assert.equal((await sub(acct.owner)).status, "active", "recuperada sin aviso");
    assert.equal(new Date((await admin.query("select cursor_at from public.billing_sweep_cursors where name = 'provider_operations'")).rows[0].cursor_at).toISOString(), NOW.toISOString());
    const again = await runProviderSweep(deps());
    assert.equal(again.pages >= 1, true);
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = any($1)", [accts.map((a) => a.owner)])).rows[0].n, 3, "repetir el barrido no duplica nada");
    provider.injectFailure("listOperations", "unavailable", 1);
    const failed = await runProviderSweep(deps());
    assert.equal(failed.pages, 0);
  });

  await check("5.14 una cuenta grandfathered NO se toca por el procesamiento ni por el barrido del reloj", async () => {
    const owner = await newUser(new Date(Date.now() - 86_400_000 * 300).toISOString());
    await store.ensureAccount(owner);
    assert.equal((await sub(owner)).status, "grandfathered");
    const before = await sub(owner);
    await runClockSweep(deps({ now: () => new Date(ar("2031-01-01")) }));
    await drain();
    const after = await sub(owner);
    assert.deepEqual(after, before);
  });

  await check("5.17 el DINERO lo decide la consulta autenticada al proveedor, nunca el cuerpo del aviso: un aviso auténtico que dice «aprobado» no activa una cuenta rechazada (y al revés)", async () => {
    const [fakeApproved, hiddenApproved] = [await accountWithSubscriber(), await accountWithSubscriber()];
    const claimApproved = op(fakeApproved, 1); // el aviso dice: aprobado
    provider.seedOperation({ ...claimApproved, outcome: "rejected", statusCode: "410" }); // el proveedor dice: rechazado
    await deliver(claimApproved);
    const claimRejected = op(hiddenApproved, 1, { outcome: "rejected", statusCode: "410" }); // el aviso dice: rechazado
    provider.seedOperation(op(hiddenApproved, 1)); // el proveedor dice: aprobado
    await deliver(claimRejected);
    await drain();
    assert.equal((await sub(fakeApproved.owner)).status, "pending", "no se activa con un aviso que el proveedor desmiente");
    assert.equal((await admin.query("select outcome from public.billing_executions where owner_id = $1", [fakeApproved.owner])).rows[0].outcome, "rejected");
    assert.equal((await sub(hiddenApproved.owner)).status, "active", "la verdad es la consulta autenticada");
  });

  await check("5.18 caída de SUPABASE a mitad del procesamiento: el lote queda en proceso, no se activa nada, y al volver se procesa UNA vez", async () => {
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    const flaky = new Proxy(store, {
      get(target, property) {
        if (property === "commitBatch") return async () => { throw new Error("connection terminated unexpectedly"); };
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await assert.rejects(drainEvents(deps({ store: flaky, worker: "flaky" }), 3), /connection terminated/);
    assert.equal((await sub(acct.owner)).status, "pending", "sin escritura no hay activación");
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 0);
    await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 second' where locked_by = 'flaky'");
    await drain();
    assert.equal((await sub(acct.owner)).status, "active");
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 1);
  });

  await check("5.19 una cuenta ELIMINADA entre la lectura y la escritura no envenena el lote: las demás se procesan y los avisos de la eliminada terminan como anomalía", async () => {
    const [keep, doomed] = [await accountWithSubscriber(), await accountWithSubscriber()];
    const [okOp, doomedOp] = [op(keep, 1), op(doomed, 1)];
    provider.seedOperation(okOp);
    provider.seedOperation(doomedOp);
    await deliver(okOp);
    await deliver(doomedOp);
    const racing = new Proxy(store, {
      get(target, property) {
        if (property === "loadExecutions") {
          return async (...args) => {
            await admin.query("delete from auth.users where id = $1", [doomed.owner]); // la persona elimina su cuenta justo en ese momento
            return target.loadExecutions(...args);
          };
        }
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await drainEvents(deps({ store: racing, worker: "racing" }), 6);
    assert.equal((await sub(keep.owner)).status, "active", "la otra cuenta se procesó en el mismo lote");
    const pending = (await admin.query("select count(*)::int n from public.billing_webhook_events where status in ('received','processing','failed') and normalized->>'providerPaymentId' = any($1)", [[okOp.providerPaymentId, doomedOp.providerPaymentId]])).rows[0].n;
    assert.equal(pending, 0, "ningún aviso queda colgado");
    assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1", [doomed.owner])).rows[0].n, 0);
  });

  await check("5.20 barrido del reloj con cuentas que NO se pueden actualizar (conflictos de versión): cada cuenta se visita UNA vez por corrida (el cursor avanza) y una corrida normal posterior repara su próxima revisión", async () => {
    const owners = [];
    for (let i = 0; i < 5; i += 1) {
      const acct = await accountWithSubscriber();
      const o = op(acct, 1);
      provider.seedOperation(o);
      await deliver(o);
      owners.push(acct.owner);
    }
    await drain();
    await admin.query("update public.billing_subscriptions set next_check_at = $2, version = version + 1 where owner_id = any($1)", [owners, ar("2025-01-01")]);
    const hostile = new Proxy(store, {
      get(target, property) {
        if (property === "commitBatch") {
          return async (batch) => {
            await admin.query("update public.billing_subscriptions set version = version + 1 where owner_id = any($1)", [owners]); // otro proceso escribe primero
            return target.commitBatch(batch);
          };
        }
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const clock = { now: () => new Date(ar("2025-06-01")) };
    const stuck = await runClockSweep(deps({ store: hostile, ...clock }), { pageSize: 2 });
    assert.deepEqual([stuck.evaluated, stuck.pages, stuck.conflicts], [5, 3, 5], "cinco cuentas, tres páginas de 2, una visita cada una");
    const repaired = await runClockSweep(deps(clock), { pageSize: 2 });
    assert.deepEqual([repaired.evaluated, repaired.subscriptionsWritten], [5, 5]);
    for (const owner of owners) assert.equal(iso((await sub(owner)).next_check_at), ar("2026-11-01"), "la próxima revisión vuelve a ser el fin del período");
    assert.equal((await runClockSweep(deps(clock), { pageSize: 2 })).evaluated, 0);
  });

  await check("5.15 retención: se purgan los avisos resueltos vencidos y las anomalías resueltas viejas; nunca los pendientes ni los en proceso", async () => {
    await admin.query("delete from public.billing_webhook_events");
    await store.ingestEvents(eventRows(5, "purge"));
    await admin.query("update public.billing_webhook_events set status = 'processed', purge_after = now() - interval '1 day' where id in (select id from public.billing_webhook_events order by id limit 2)");
    await admin.query("update public.billing_webhook_events set status = 'received', purge_after = now() - interval '1 day' where id in (select id from public.billing_webhook_events order by id desc limit 1)");
    await admin.query("update public.billing_webhook_events set status = 'processing', locked_until = now() + interval '5 minutes', purge_after = now() - interval '1 day' where id in (select id from public.billing_webhook_events where status = 'received' and purge_after >= now() limit 1)");
    await admin.query("insert into public.billing_reconciliations (kind, dedupe_key, status, resolved_at) values ('refund_review', 'old:1', 'resolved', now() - interval '400 days'), ('refund_review', 'new:1', 'resolved', now() - interval '10 days'), ('refund_review', 'open:1', 'open', null)");
    const purged = await store.purgeRetention({ limit: 100 });
    assert.deepEqual(purged, { events: 2, reconciliations: 1 });
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events")).rows[0].n, 3);
    assert.equal((await admin.query("select count(*)::int n from public.billing_reconciliations where dedupe_key in ('new:1','open:1')")).rows[0].n, 2);
  });

  await check("5.16 con los interruptores APAGADOS la recepción no guarda nada y la facturación no escribe en la base", async () => {
    const before = (await admin.query("select (select count(*) from public.billing_webhook_events) e, (select count(*) from public.billing_subscriptions) s, (select count(*) from public.billing_executions) x")).rows[0];
    const acct = await accountWithSubscriber();
    const o = op(acct, 1);
    provider.seedOperation(o);
    const body = webhookBody(o);
    const mid = (await admin.query("select (select count(*) from public.billing_webhook_events) e, (select count(*) from public.billing_executions) x")).rows[0];
    const response = await deliver(null, { raw: body, flags: { enabled: false, enforcement: true } });
    assert.equal(response.status, 404);
    const after = (await admin.query("select (select count(*) from public.billing_webhook_events) e, (select count(*) from public.billing_executions) x")).rows[0];
    assert.deepEqual(after, mid);
    assert.ok(Number(before.s) >= 0);
  });

  // =============================================================== Parte 6 (M2): registro fiscal, devoluciones y contracargos, sondeo, reparación, checkout, eliminación, operación
  const payment = (acct, n, overrides = {}) => op(acct, n, overrides);
  const withNow = (iso) => () => new Date(iso);
  /** Deja en el sondeo SÓLO a las cuentas dadas (las demás pruebas dejan cuentas programadas que meterían ruido). */
  const isolatePolls = (owners) => admin.query("delete from public.billing_poll_schedule where owner_id <> all($1::uuid[])", [owners]);
  const executionOf = async (acct, n) => (await admin.query("select * from public.billing_executions where owner_id = $1 and execution_uid = $2", [acct.owner, `exe_${acct.owner.slice(-6)}_${n}`])).rows[0];
  const reviews = async (owner) => (await admin.query("select kind, status from public.billing_reconciliations where owner_id = $1 order by id", [owner])).rows;
  /** Cuenta ACTIVA con su suscriptor también creado en el proveedor falso (para sondeo, cancelación y reparación). */
  const paidAccount = async (planCode = "tf_monthly_ars_v1") => {
    const acct = await accountWithSubscriber(planCode);
    provider.seedSubscriber(acct.subscriberUid, { status: "active" });
    const o = payment(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    await drain();
    assert.equal((await sub(acct.owner)).status, "active");
    return { ...acct, first: o };
  };

  await check("6.1 REGISTRO FISCAL: mínimo y seudonimizado, sin propietaria ni datos personales; sobrevive a la eliminación de la cuenta; sólo se purga vencido el plazo; ni anon ni authenticated lo tocan", async () => {
    const acct = await paidAccount();
    const rows = (await admin.query("select * from public.billing_fiscal_records where operation_ref = $1", [`exe_${acct.owner.slice(-6)}_1`])).rows;
    assert.equal(rows.length, 1);
    const fiscal = rows[0];
    assert.deepEqual(Object.keys(fiscal).sort(), ["amount_minor", "created_at", "currency", "id", "occurred_at", "operation_ref", "owner_hash", "provider", "receipt_ref", "reconciliation_hash", "retain_until", "status", "updated_at"].sort());
    assert.equal(fiscal.status, "approved");
    assert.equal(Number(fiscal.amount_minor), 2_490_000);
    assert.equal(fiscal.currency, "ARS");
    assert.match(fiscal.owner_hash, /^[0-9a-f]{64}$/);
    assert.match(fiscal.reconciliation_hash, /^[0-9a-f]{64}$/);
    assert.equal(fiscal.receipt_ref, `pay_${acct.owner.slice(-6)}_1`);
    assert.notEqual(fiscal.owner_hash, crypto.createHash("sha256").update(acct.owner).digest("hex"), "la huella lleva una sal: no se reconstruye a partir del identificador");
    const years = (await admin.query("select (retain_until - (occurred_at at time zone 'UTC')::date) as days from public.billing_fiscal_records where id = $1", [fiscal.id])).rows[0].days;
    assert.ok(years >= 3650 && years <= 3653, `10 años de conservación (${years} días)`);
    const text = JSON.stringify(fiscal);
    for (const forbidden of [acct.owner, acct.owner.replace(/-/g, ""), acct.ref, acct.subscriberUid, "@"]) assert.equal(text.includes(forbidden), false, forbidden);
    assert.ok(!fiscal.owner_hash.includes(acct.owner.replace(/-/g, "")), "la huella no contiene el identificador");
    assert.notEqual(fiscal.owner_hash, crypto.createHash("sha256").update(`:${acct.owner}`).digest("hex"), "ni siquiera sin sal se reconstruye");
    // Un cobro rechazado no es una operación fiscal.
    const rej = payment(acct, 2, { outcome: "rejected", statusCode: "410", dueAt: ar("2026-11-01", 10), occurredAt: ar("2026-11-01", 10, 5) });
    provider.seedOperation(rej);
    await deliver(rej);
    await drain({ now: withNow(ar("2026-11-02", 12)) });
    assert.equal((await admin.query("select count(*)::int n from public.billing_fiscal_records where operation_ref = $1", [`exe_${acct.owner.slice(-6)}_2`])).rows[0].n, 0);
    // Repetir el mismo hecho no duplica ni cambia la huella.
    const hashBefore = (await admin.query("select reconciliation_hash h from public.billing_fiscal_records where id = $1", [fiscal.id])).rows[0].h;
    await admin.query("update public.billing_executions set provider_payment_id = provider_payment_id where owner_id = $1 and execution_uid = $2", [acct.owner, `exe_${acct.owner.slice(-6)}_1`]);
    assert.equal((await admin.query("select reconciliation_hash h from public.billing_fiscal_records where id = $1", [fiscal.id])).rows[0].h, hashBefore);
    // Privilegios.
    const anon = await pg.session("", "anon");
    const auth = await pg.session(acct.owner, "authenticated");
    try {
      await assert.rejects(anon.query("select 1 from public.billing_fiscal_records"), /permission denied/);
      await assert.rejects(auth.query("select 1 from public.billing_fiscal_records"), /permission denied/);
      await assert.rejects(auth.query("delete from public.billing_fiscal_records"), /permission denied/);
    } finally {
      await anon.end();
      await auth.end();
    }
    // Eliminar la cuenta: lo operativo desaparece, el registro fiscal queda.
    await admin.query("delete from auth.users where id = $1", [acct.owner]);
    for (const table of ["billing_subscriptions", "billing_executions", "billing_periods", "billing_poll_schedule"]) assert.equal((await admin.query(`select count(*)::int n from public.${table} where owner_id = $1`, [acct.owner])).rows[0].n, 0, table);
    assert.equal((await admin.query("select count(*)::int n from public.billing_fiscal_records where id = $1", [fiscal.id])).rows[0].n, 1, "el registro fiscal se conserva");
    // Sólo se purga lo que ya cumplió su plazo.
    assert.equal(await svcConn.query("select public.billing_purge_fiscal_records(100) v").then((r) => r.rows[0].v), 0);
    await admin.query("update public.billing_fiscal_records set retain_until = current_date - 1 where id = $1", [fiscal.id]);
    assert.equal(await svcConn.query("select public.billing_purge_fiscal_records(100) v").then((r) => r.rows[0].v), 1);
  });

  await check("6.2 DEVOLUCIÓN TOTAL confirmada por la consulta autenticada: el período se anula (se conserva en el historial), la cuenta queda sin período, el registro fiscal pasa a «refunded» y queda auditada", async () => {
    const acct = await paidAccount();
    const refund = { ...acct.first, outcome: "refunded", statusCode: "602", refundScope: "full", occurredAt: ar("2026-10-10", 9) };
    provider.seedOperation(refund);
    await ageNotices();
    await deliver(refund);
    await drain();
    const row = await sub(acct.owner);
    assert.equal(row.status, "pending");
    assert.equal(row.current_period_end, null);
    assert.equal((await executionOf(acct, 1)).outcome, "refunded");
    const period = (await admin.query("select voided_at from public.billing_periods where owner_id = $1", [acct.owner])).rows;
    assert.equal(period.length, 1, "el período no se borra");
    assert.ok(period[0].voided_at, "pero queda anulado");
    assert.equal((await admin.query("select status from public.billing_fiscal_records where operation_ref = $1", [`exe_${acct.owner.slice(-6)}_1`])).rows[0].status, "refunded");
    assert.ok((await reviews(acct.owner)).some((r) => r.kind === "refund_applied" && r.status === "open"));
    // Un período anulado deja de respaldar el estado: no se puede volver a «activar» a mano apoyándose en él.
    await assert.rejects(admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v1', current_period_start = $2, current_period_end = $3, version = version + 1 where owner_id = $1", [acct.owner, ar("2026-10-01"), ar("2026-11-01")]), /billing_period_not_backed_by_payment/);
    // Y un aprobado VIEJO que llega tarde no revive el período.
    await ageNotices();
    provider.seedOperation(acct.first);
    await deliver(acct.first);
    await drain();
    assert.equal((await executionOf(acct, 1)).outcome, "refunded", "un «aprobado» VIEJO que llega tarde no revive el cobro devuelto");
    assert.equal((await sub(acct.owner)).status, "pending");
  });

  await check("6.3 DEVOLUCIÓN PARCIAL o AMBIGUA → revisión manual y la cuenta NO cambia; CONTRACARGO → modo limitado inmediato y revisión", async () => {
    for (const scope of ["partial", "unknown"]) {
      const acct = await paidAccount();
      const refund = { ...acct.first, outcome: "refunded", statusCode: scope === "partial" ? "605" : "601", refundScope: scope, occurredAt: ar("2026-10-10", 9) };
      provider.seedOperation(refund);
      await ageNotices();
      await deliver(refund);
      await drain();
      assert.equal((await sub(acct.owner)).status, "active", scope);
      assert.equal((await executionOf(acct, 1)).outcome, "approved", scope);
      assert.ok((await reviews(acct.owner)).some((r) => r.kind === "refund_review"), scope);
    }
    const acct = await paidAccount();
    const chargeback = { ...acct.first, outcome: "chargeback", statusCode: "cb", refundScope: null, occurredAt: ar("2026-10-15", 12) };
    provider.seedOperation(chargeback);
    await ageNotices();
    await deliver(chargeback);
    await drain();
    const row = await sub(acct.owner);
    assert.equal(row.status, "pending", "el único cobro fue contracargado: la cuenta queda sin período");
    assert.equal(iso(row.chargeback_at), ar("2026-10-15", 12));
    assert.ok((await reviews(acct.owner)).some((r) => r.kind === "chargeback_review" && r.status === "open"));
    assert.equal((await admin.query("select status from public.billing_fiscal_records where operation_ref = $1", [`exe_${acct.owner.slice(-6)}_1`])).rows[0].status, "chargeback");
  });

  await check("6.4 CONTRACARGO con otro período pagado por delante: limitado AL INSTANTE (no se borra ni se acorta lo pagado); un cobro posterior lo supera; el resultado manual conciliado hace lo mismo", async () => {
    const acct = await paidAccount();
    // Segundo cobro (renovación del 1/11) ya pagado.
    const second = payment(acct, 2, { dueAt: ar("2026-11-01", 10), occurredAt: ar("2026-11-01", 10, 5) });
    provider.seedOperation(second);
    await deliver(second);
    await drain({ now: withNow(ar("2026-11-02", 12)) });
    assert.equal((await sub(acct.owner)).status, "active");
    const chargeback = { ...acct.first, outcome: "chargeback", statusCode: "cb", refundScope: null, occurredAt: ar("2026-11-10", 12) };
    provider.seedOperation(chargeback);
    await ageNotices();
    await deliver(chargeback);
    await drain({ now: withNow(ar("2026-11-12", 12)) });
    const row = await sub(acct.owner);
    assert.equal(row.status, "limited");
    assert.equal(iso(row.current_period_end), ar("2026-12-01"), "el período que sigue pagado se conserva");
    // Un cobro aprobado posterior supera el contracargo.
    const third = payment(acct, 3, { dueAt: ar("2026-11-20", 10), occurredAt: ar("2026-11-20", 10, 5) });
    provider.seedOperation(third);
    await deliver(third);
    await drain({ now: withNow(ar("2026-11-21", 12)) });
    assert.equal((await sub(acct.owner)).chargeback_at, null);
    assert.equal((await sub(acct.owner)).status, "active");
    // Resultado manual conciliado (el contracargo no tiene código en la API de Mobbex).
    const manual = await paidAccount();
    assert.deepEqual(await svcConn.query("select public.billing_record_manual_outcome($1, $2, 'chargeback', $3) v", [manual.owner, `exe_${manual.owner.slice(-6)}_1`, ar("2026-10-15", 12)]).then((r) => r.rows[0].v), { ok: true, changed: true });
    assert.deepEqual(await svcConn.query("select public.billing_record_manual_outcome($1, $2, 'chargeback', $3) v", [manual.owner, `exe_${manual.owner.slice(-6)}_1`, ar("2026-10-15", 12)]).then((r) => r.rows[0].v), { ok: true, changed: false }, "repetirlo no cambia nada");
    assert.equal((await svcConn.query("select public.billing_record_manual_outcome($1, 'no_existe', 'chargeback', now()) v", [manual.owner])).rows[0].v.ok, false);
    assert.equal((await svcConn.query("select public.billing_record_manual_outcome($1, $2, 'approved', now()) v", [manual.owner, `exe_${manual.owner.slice(-6)}_1`])).rows[0].v.ok, false, "sólo sube a devuelto o contracargo");
    await runClockSweep(deps({ now: withNow(ar("2026-10-20", 12)) }));
    const after = await sub(manual.owner);
    assert.notEqual(after.status, "active");
    assert.equal(iso(after.chargeback_at), ar("2026-10-15", 12));
    assert.ok((await reviews(manual.owner)).some((r) => r.kind === "manual_outcome"));
  });

  await check("6.5 SONDEO POR SUSCRIPTOR: recupera un aviso que NUNCA llegó (cobro visible sólo por la consulta autenticada del suscriptor), una sola vez", async () => {
    const acct = await accountWithSubscriber();
    provider.seedSubscriber(acct.subscriberUid, { status: "active" });
    const lost = payment(acct, 1);
    provider.seedOperation(lost); // el proveedor lo tiene, pero ningún aviso llegó
    await isolatePolls([acct.owner]);
    assert.equal((await store.prioritizePolls([acct.owner])), 1);
    const stats = await runSubscriberPoll(deps());
    assert.ok(stats.polled >= 1 && stats.facts >= 1, JSON.stringify(stats));
    assert.equal((await sub(acct.owner)).status, "active");
    assert.equal((await admin.query("select count(*)::int n from public.billing_periods where owner_id = $1", [acct.owner])).rows[0].n, 1);
    const due = (await admin.query("select due_at, failures from public.billing_poll_schedule where owner_id = $1", [acct.owner])).rows[0];
    assert.ok(new Date(due.due_at) > NOW, "reprogramado hacia adelante (cuenta estable: una vez por semana)");
    assert.equal(due.failures, 0);
    await store.prioritizePolls([acct.owner]);
    const again = await runSubscriberPoll(deps());
    assert.equal(again.subscriptionsWritten, 0, "repetir el sondeo no cambia nada");
    assert.equal((await admin.query("select count(*)::int n from public.billing_executions where owner_id = $1", [acct.owner])).rows[0].n, 1);
  });

  await check("6.6 el sondeo respeta el ARRENDAMIENTO: dos trabajadores simultáneos jamás reciben al mismo suscriptor; si el trabajador muere, vencido el arrendamiento vuelve a ser elegible", async () => {
    const owners = [];
    for (let i = 0; i < 40; i += 1) owners.push((await accountWithSubscriber()).owner);
    await isolatePolls(owners);
    await store.prioritizePolls(owners);
    const workers = await Promise.all(Array.from({ length: 4 }, async () => new RpcBillingStore(await makeRpcCaller(await pg.session("", "service_role")))));
    const claimed = await Promise.all(workers.map(async (worker) => {
      const mine = [];
      for (let guard = 0; guard < 30; guard += 1) {
        const batch = await worker.claimPolls({ nowIso: NOW.toISOString(), limit: 7, leaseSeconds: 300 });
        if (batch.length === 0) break;
        mine.push(...batch);
      }
      return mine;
    }));
    const all = claimed.flat().filter((id) => owners.includes(id));
    assert.equal(all.length, 40);
    assert.equal(new Set(all).size, 40, "ninguno entregado dos veces");
    // El trabajador «muere» sin marcar: vencido el arrendamiento, vuelven.
    assert.equal((await store.claimPolls({ nowIso: NOW.toISOString(), limit: 100, leaseSeconds: 300 })).filter((id) => owners.includes(id)).length, 0);
    const later = new Date(NOW.getTime() + 6 * 60_000).toISOString();
    assert.equal((await store.claimPolls({ nowIso: later, limit: 100, leaseSeconds: 300 })).filter((id) => owners.includes(id)).length, 40, "recuperados tras el vencimiento");
  });

  await check("6.7 PROVEEDOR CAÍDO durante el sondeo: espera exponencial acotada, nada se pierde ni se activa, y tras 8 fallas seguidas queda UNA revisión abierta", async () => {
    const acct = await accountWithSubscriber();
    provider.seedSubscriber(acct.subscriberUid, { status: "active" });
    await isolatePolls([acct.owner]);
    provider.injectFailure("getSubscriber", "unavailable", 20);
    let lastDue = null;
    for (let i = 0; i < 9; i += 1) {
      await admin.query("update public.billing_poll_schedule set due_at = now() - interval '1 minute' where owner_id = $1", [acct.owner]);
      const stats = await runSubscriberPoll(deps());
      assert.ok(stats.failed >= 1);
      const row = (await admin.query("select due_at > now() as waiting, failures, due_at from public.billing_poll_schedule where owner_id = $1", [acct.owner])).rows[0];
      assert.equal(row.waiting, true);
      assert.equal(row.failures, i + 1);
      if (lastDue) assert.ok(new Date(row.due_at) - Date.now() <= 6 * 3_600_000 + 5_000, "la espera nunca pasa de 6 horas");
      lastDue = row.due_at;
    }
    assert.equal((await sub(acct.owner)).status, "pending", "una caída no activa ni cambia nada");
    assert.equal((await admin.query("select count(*)::int n from public.billing_reconciliations where dedupe_key = $1 and status = 'open'", [`poll_stuck:${acct.owner}`])).rows[0].n, 1);
    provider.failures = [];
    await admin.query("update public.billing_poll_schedule set due_at = now() - interval '1 minute' where owner_id = $1", [acct.owner]);
    const ok = await runSubscriberPoll(deps());
    assert.equal(ok.failed, 0);
    assert.equal((await admin.query("select failures from public.billing_poll_schedule where owner_id = $1", [acct.owner])).rows[0].failures, 0, "al responder, las fallas vuelven a cero");
  });

  await check("6.8 un aviso de registro o de cambio de medio de pago NO cambia nada: sólo pide un sondeo prioritario del suscriptor; los suscriptores ajenos se descartan sin consultar y quedan en UNA anotación por hora", async () => {
    const acct = await accountWithSubscriber();
    provider.seedSubscriber(acct.subscriberUid, { status: "active" });
    await admin.query("update public.billing_poll_schedule set due_at = now() + interval '3 days' where owner_id = $1", [acct.owner]);
    const body = JSON.stringify({ type: "subscription:change_source", data: { payment: { id: "REG1" }, subscriber: { uid: acct.subscriberUid, reference: acct.ref } } });
    assert.equal((await deliver(null, { raw: body })).status, 200);
    const stats = await drain();
    assert.equal(stats.pollsRequested, 1);
    assert.equal((await sub(acct.owner)).status, "pending");
    assert.equal((await admin.query("select due_at <= now() + interval '1 minute' as soon from public.billing_poll_schedule where owner_id = $1", [acct.owner])).rows[0].soon, true);
    const lookups = provider.calls.getOperation;
    // Un aviso que trae SÓLO el uid del suscriptor (sin nuestra referencia) también se resuelve.
    const onlyUid = JSON.stringify({ type: "subscription:registration", data: { payment: { id: "REG2" }, subscriber: { uid: acct.subscriberUid } } });
    await ageNotices();
    await deliver(null, { raw: onlyUid });
    assert.equal((await drain()).pollsRequested, 1, "resuelto por el uid del proveedor");
    for (let i = 0; i < 25; i += 1) await deliver(null, { raw: JSON.stringify({ type: "subscription:execution", data: { payment: { id: `FAKE${i}` }, subscriber: { uid: `GHOST${i}`, reference: `tfs_${String(i).padStart(32, "0")}` } } }) });
    const ghostStats = await drain();
    assert.equal(ghostStats.unknownSubscriber, 25);
    assert.equal(provider.calls.getOperation, lookups, "ni una consulta al proveedor por identificadores inventados");
    const notes = (await admin.query("select count(*)::int n from public.billing_reconciliations where dedupe_key like 'unknown_reference:notice:%' and status = 'open'")).rows[0].n;
    assert.equal(notes, 1, "una sola anotación por hora, no una por aviso");
  });

  await check("6.9 REPARACIÓN: el proveedor ya canceló y la base no se enteró (falló después de confirmar allá) → el sondeo la repara; y al revés, si la base dice «cancelada» y el proveedor sigue cobrando, se vuelve a suspender", async () => {
    // (a) cancelación «proveedor primero» con la base caída justo al escribir.
    const acct = await paidAccount();
    const flaky = new Proxy(store, { get: (target, property) => (property === "commitBatch" ? async () => { throw new Error("connection terminated unexpectedly"); } : typeof target[property] === "function" ? target[property].bind(target) : target[property]) });
    const cmd = (overrides = {}) => ({ store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)), ...overrides });
    const failed = await cancelSubscription(cmd({ store: flaky }), acct.owner);
    assert.equal(failed.ok, false);
    assert.ok(provider.canceled.has(acct.subscriberUid), "el proveedor ya dejó de cobrar");
    assert.equal((await sub(acct.owner)).status, "active", "la base todavía no lo sabe");
    // Reintentar el comando es idempotente (no vuelve a fallar el proveedor ni duplica nada) y también repara.
    await isolatePolls([acct.owner]);
    await store.prioritizePolls([acct.owner]);
    const stats = await runSubscriberPoll(deps());
    assert.ok(stats.repaired >= 1, JSON.stringify(stats));
    const repaired = await sub(acct.owner);
    assert.equal(repaired.status, "cancel_at_period_end");
    assert.ok(repaired.cancel_requested_at);
    assert.equal((await admin.query("select count(*)::int n from public.billing_plan_changes where owner_id = $1 and kind = 'cancel'", [acct.owner])).rows[0].n, 1);
    assert.deepEqual(await cancelSubscription(cmd(), acct.owner), { ok: true, changed: false });
    // (b) la base dice «cancelada» pero el proveedor sigue activo (p. ej. alguien lo reactivó allá): se vuelve a suspender y queda registrado.
    const other = await paidAccount();
    assert.deepEqual(await cancelSubscription(cmd(), other.owner), { ok: true, changed: true });
    provider.canceled.delete(other.subscriberUid);
    provider.subscribers.get(other.subscriberUid).status = "active";
    const callsBefore = provider.calls.cancelSubscriber;
    await store.prioritizePolls([other.owner]);
    const re = await runSubscriberPoll(deps());
    assert.ok(re.resuspended >= 1, JSON.stringify(re));
    assert.ok(provider.calls.cancelSubscriber > callsBefore);
    assert.ok(provider.canceled.has(other.subscriberUid));
    assert.ok((await reviews(other.owner)).some((r) => r.kind === "provider_state_mismatch"));
    // (c) el proveedor dio por terminada la suscripción: se registra.
    const ended = await paidAccount();
    provider.subscribers.get(ended.subscriberUid).status = "finished";
    await store.prioritizePolls([ended.owner]);
    await runSubscriberPoll(deps());
    assert.ok((await sub(ended.owner)).provider_ended_at);
  });

  await check("6.10 CHECKOUT: doble envío / dos pestañas devuelven el MISMO enlace sin crear un segundo suscriptor; cambiar de plan cancela el suscriptor anterior; el DNI y el nombre no quedan en NINGUNA tabla ni registro", async () => {
    const owner = await newUser();
    await store.ensureAccount(owner);
    const customer = { email: "profe@example.test", name: "Ana Pérez Única", identification: "29876543" };
    const lines = [];
    const originals = { info: console.info, warn: console.warn, error: console.error, log: console.log };
    console.info = console.warn = console.error = console.log = (...args) => void lines.push(args.map(String).join(" "));
    let first, second, third;
    try {
      const d = { store, provider, flags: { enabled: true, enforcement: false }, now: () => NOW };
      const make = (planCode, key) => startCheckout(d, { ownerId: owner, planCode, idempotencyKey: key, returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer });
      const before = provider.calls.createCheckout;
      [first, second] = await Promise.all([make("tf_monthly_ars_v1", "tab-a-aaaaaaaa"), make("tf_monthly_ars_v1", "tab-b-aaaaaaaa")]);
      assert.ok(first.ok && second.ok);
      assert.equal(first.redirectUrl, second.redirectUrl, "mismo enlace");
      assert.ok(provider.calls.createCheckout - before <= 2);
      const afterFirst = provider.calls.createCheckout;
      const again = await make("tf_monthly_ars_v1", "tab-c-aaaaaaaa");
      assert.ok(again.ok);
      assert.equal(provider.calls.createCheckout, afterFirst, "con el intento ya completado NO se vuelve a llamar al proveedor");
      assert.equal(again.redirectUrl, first.redirectUrl);
      const firstUid = (await sub(owner)).provider_subscriber_uid;
      assert.ok(firstUid);
      third = await make("tf_annual_ars_v1", "tab-d-aaaaaaaa");
      assert.ok(third.ok);
      assert.ok(provider.canceled.has(firstUid), "el suscriptor del plan anterior se canceló en el proveedor");
      const row = await sub(owner);
      assert.notEqual(row.provider_subscriber_uid, firstUid);
      assert.equal(row.provider_plan_code, "tf_annual_ars_v1");
      assert.equal(row.status, "pending", "volver del proveedor no activa nada");
    } finally {
      Object.assign(console, originals);
    }
    assert.ok(provider.receivedCustomers.some((c) => c.identification === "29876543"), "el documento sí viajó al proveedor");
    // Ninguna tabla de facturación contiene el documento ni el nombre.
    for (const table of TABLES) {
      const dump = JSON.stringify((await admin.query(`select * from public.${table}`)).rows);
      for (const secret of ["29876543", "Ana Pérez", "profe@example.test"]) assert.equal(dump.includes(secret), false, `${table} contiene ${secret}`);
    }
    assert.equal(lines.join("\n").includes("29876543"), false);
    assert.equal(lines.join("\n").includes("Ana"), false);
    const fiscal = JSON.stringify((await admin.query("select * from public.billing_fiscal_records")).rows);
    assert.equal(fiscal.includes("29876543"), false);
  });

  await check("6.11 volver a suscribirse tras cancelar usa el suscriptor NUEVO (la cancelación posterior apunta al correcto, nunca al viejo)", async () => {
    const acct = await paidAccount();
    const d = { store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) };
    assert.deepEqual(await cancelSubscription(d, acct.owner), { ok: true, changed: true });
    const later = { ...d, now: () => new Date(ar("2026-11-15", 12)) };
    await runClockSweep(deps({ now: later.now }));
    assert.equal((await sub(acct.owner)).status, "canceled");
    const customer = { email: "profe@example.test", name: "Ana Pérez", identification: "29876543" };
    const restarted = await startCheckout(later, { ownerId: acct.owner, planCode: "tf_quarterly_ars_v1", idempotencyKey: "restart-aaaaaaaa", returnUrl: "https://teacherflowapp.com/facturacion/resultado", customer });
    assert.ok(restarted.ok);
    const row = await sub(acct.owner);
    assert.notEqual(row.provider_subscriber_uid, acct.subscriberUid);
    assert.equal(row.status, "pending");
    assert.equal(row.provider_plan_code, "tf_quarterly_ars_v1");
  });

  await check("6.12 ELIMINACIÓN con suscripción activa: se cancela y CONFIRMA en el proveedor ANTES de borrar nada; si no se puede confirmar no se elimina; el registro fiscal queda", async () => {
    const acct = await paidAccount();
    const d = { store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) };
    // Proveedor caído: bloqueado.
    provider.injectFailure("cancelSubscriber", "unavailable", 5);
    const blocked = await prepareAccountDeletion(d, acct.owner);
    assert.equal(blocked.ok, false);
    assert.equal((await sub(acct.owner)).status, "active", "no se tocó nada");
    provider.failures = [];
    // Estado ilegible: no se puede confirmar.
    const unreadable = await paidAccount();
    provider.subscribers.get(unreadable.subscriberUid).status = "unknown";
    assert.deepEqual((await prepareAccountDeletion(d, unreadable.owner)).ok, false);
    assert.ok((await sub(unreadable.owner)), "la cuenta sigue existiendo");
    // Camino feliz.
    assert.deepEqual(await prepareAccountDeletion(d, acct.owner), { ok: true });
    assert.ok(provider.canceled.has(acct.subscriberUid));
    assert.equal(provider.subscribers.get(acct.subscriberUid).status, "suspended");
    assert.equal((await sub(acct.owner)).status, "cancel_at_period_end");
    await admin.query("delete from auth.users where id = $1", [acct.owner]);
    assert.equal((await admin.query("select count(*)::int n from public.billing_fiscal_records where operation_ref = $1", [`exe_${acct.owner.slice(-6)}_1`])).rows[0].n, 1);
    // Sin suscripción en el proveedor no hay nada que cancelar; con la facturación apagada ni se consulta.
    const plain = await newUser();
    await store.ensureAccount(plain);
    assert.deepEqual(await prepareAccountDeletion(d, plain), { ok: true });
    const callsBefore = provider.calls.cancelSubscriber;
    assert.deepEqual(await prepareAccountDeletion({ ...d, flags: { enabled: false, enforcement: false } }, unreadable.owner), { ok: true });
    assert.equal(provider.calls.cancelSubscriber, callsBefore);
  });

  await check("6.13 CAMBIO DE PLAN (capacidad validada del adaptador falso): rige en el PRÓXIMO período, sin prorrateo; el cobro siguiente con el plan nuevo lo resuelve; el proveedor real sin validar no lo ofrece", async () => {
    const acct = await paidAccount();
    const d = { store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) };
    assert.deepEqual(await changePlan(d, acct.owner, "tf_annual_ars_v1"), { ok: true, changed: true });
    const row = await sub(acct.owner);
    assert.equal(row.pending_plan_code, "tf_annual_ars_v1");
    assert.equal(row.plan_code, "tf_monthly_ars_v1", "hasta la renovación sigue el plan actual");
    assert.equal(iso(row.current_period_end), ar("2026-11-01"), "no se toca el período pagado");
    assert.equal(provider.planChanges.at(-1).toPlanCode, "tf_annual_ars_v1");
    const renewal = payment(acct, 2, { planReference: "tf_annual_ars_v1", amountMinor: 24_900_000, dueAt: ar("2026-11-01", 10), occurredAt: ar("2026-11-01", 10, 5) });
    provider.seedOperation(renewal);
    await deliver(renewal);
    await drain({ now: withNow(ar("2026-11-02", 12)) });
    const after = await sub(acct.owner);
    assert.equal(after.plan_code, "tf_annual_ars_v1");
    assert.equal(after.pending_plan_code, null);
    assert.equal(iso(after.current_period_end), ar("2027-11-01"));
    const { MobbexAdapter } = await importLib("billing/providers/mobbex.ts");
    const closed = { store, provider: new MobbexAdapter(null), flags: { enabled: true, enforcement: false }, now: d.now };
    const refused = await changePlan(closed, acct.owner, "tf_quarterly_ars_v1");
    assert.equal(refused.ok, false);
    assert.equal(refused.failure, "feature_unavailable");
  });

  await check("6.14 HISTORIAL de la propietaria: períodos y cobros SIN identificadores del proveedor; y las funciones de operación (cola, reintento de muertos, resolución de revisiones)", async () => {
    const acct = await paidAccount();
    const history = await store.getHistory(acct.owner, 24);
    assert.equal(history.periods.length, 1);
    assert.equal(history.charges.length, 1);
    const text = JSON.stringify(history);
    for (const forbidden of ["exe_", "pay_", acct.subscriberUid, acct.ref, acct.owner]) assert.equal(text.includes(forbidden), false, forbidden);
    const stats = await store.queueStats();
    for (const key of ["pendingEvents", "processingEvents", "duePolls", "dueClock", "openReviews"]) assert.equal(typeof stats[key], "number", key);
    // Aviso muerto → se puede reencolar.
    await admin.query("delete from public.billing_webhook_events");
    await store.ingestEvents(eventRows(2, "dead"));
    await admin.query("update public.billing_webhook_events set status = 'dead', attempts = 8");
    const ids = (await admin.query("select id from public.billing_webhook_events")).rows.map((r) => Number(r.id));
    assert.equal((await svcConn.query("select public.billing_requeue_dead_events($1::bigint[]) v", [ids])).rows[0].v, 2);
    assert.equal((await svcConn.query("select public.billing_requeue_dead_events($1::bigint[]) v", [ids])).rows[0].v, 0, "repetirlo no hace nada");
    assert.equal((await admin.query("select count(*)::int n from public.billing_webhook_events where status = 'received' and attempts = 0")).rows[0].n, 2);
    const open = (await admin.query("select id from public.billing_reconciliations where status = 'open' limit 3")).rows.map((r) => Number(r.id));
    assert.equal((await svcConn.query("select public.billing_resolve_reconciliations($1::bigint[]) v", [open])).rows[0].v, open.length);
    await admin.query("delete from public.billing_webhook_events");
  });

  await check("6.15 TRABAJOS programados: el de proceso vacía la cola y sondea; el de conciliación aplica el reloj y purga; las métricas son sólo números y fechas (sin identificadores ni datos)", async () => {
    const acct = await accountWithSubscriber();
    provider.seedSubscriber(acct.subscriberUid, { status: "active" });
    const o = payment(acct, 1);
    provider.seedOperation(o);
    await deliver(o);
    const processed = await runProcessJob(deps(), { budgetMs: 20_000 });
    assert.equal(processed.kind, "process");
    assert.equal((await sub(acct.owner)).status, "active");
    const reconciled = await runReconcileJob(deps({ now: withNow(ar("2026-11-03", 12)) }), { budgetMs: 20_000 });
    assert.equal(reconciled.kind, "reconcile");
    assert.ok(reconciled.clock.evaluated >= 1);
    for (const metrics of [processed, reconciled]) {
      const text = JSON.stringify(metrics);
      for (const forbidden of [acct.owner, acct.ref, acct.subscriberUid, o.providerPaymentId, "@"]) assert.equal(text.includes(forbidden), false, forbidden);
    }
  });

  await check("6.16 el cambio de medio de pago NO cambia ningún estado y sólo existe con la capacidad validada; con el proveedor cerrado no sale nada", async () => {
    const acct = await paidAccount();
    const d = { store, provider, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-10-10", 12)) };
    const before = await sub(acct.owner);
    const result = await updatePaymentMethod(d, acct.owner);
    assert.ok(result.ok && result.redirectUrl.startsWith("https://"));
    assert.deepEqual(await sub(acct.owner), before, "pedir el enlace no toca la suscripción");
    const { MobbexAdapter } = await importLib("billing/providers/mobbex.ts");
    const refused = await updatePaymentMethod({ ...d, provider: new MobbexAdapter(null) }, acct.owner);
    assert.deepEqual([refused.ok, refused.failure], [false, "feature_unavailable"]);
    assert.equal((await updatePaymentMethod({ ...d, flags: { enabled: false, enforcement: false } }, acct.owner)).ok, false);
  });

  await check("6.17 deduplicación con ENFRIAMIENTO: un aviso repetido mientras el anterior sigue pendiente —o dentro de los 60 s— se descarta; pasado ese tiempo y ya procesado, un aviso NUEVO del mismo pago vuelve a encolar", async () => {
    await admin.query("delete from public.billing_webhook_events");
    const acct = await accountWithSubscriber();
    const o = payment(acct, 1);
    provider.seedOperation(o);
    const count = async () => (await admin.query("select count(*)::int n from public.billing_webhook_events where normalized->>'providerPaymentId' = $1", [o.providerPaymentId])).rows[0].n;
    await deliver(o);
    await deliver(o);
    assert.equal(await count(), 1, "pendiente: duplicado descartado");
    await drain();
    await deliver(o);
    assert.equal(await count(), 1, "procesado hace menos de 60 s: sigue en enfriamiento");
    await ageNotices();
    await deliver(o);
    assert.equal(await count(), 2, "pasado el enfriamiento un aviso nuevo vuelve a encolar (p. ej. una devolución posterior)");
    await deliver(o);
    assert.equal(await count(), 2, "y mientras ése siga pendiente, no se duplica");
  });

  const failed = results.filter((r) => !r.ok);
  try {
    await svcConn.end();
  } catch {}
  await pg.stop();
  return { results, failed, label };
}

// ---------------------------------------------------------------------------------------------------- mutaciones de las migraciones
const MUTATIONS = [
  ["la tabla de suscripciones deja de tener RLS", M1_FILES[0], "alter table public.billing_subscriptions enable row level security;", ""],
  ["la tabla de avisos deja de tener RLS", M1_FILES[0], "alter table public.billing_webhook_events enable row level security;", ""],
  ["anon recibe SELECT sobre las suscripciones", M1_FILES[0], "grant select, insert, update, delete on table public.billing_plans,", "grant select on public.billing_subscriptions to anon;\ngrant select, insert, update, delete on table public.billing_plans,"],
  ["authenticated recibe UPDATE sobre las suscripciones", M1_FILES[0], "drop policy if exists billing_subscriptions_owner_select", "grant update on public.billing_subscriptions to authenticated;\ndrop policy if exists billing_subscriptions_owner_select"],
  ["la lectura propia incluye provider_reference", M1_FILES[0], "grant select (owner_id, status, grandfathered, plan_code,", "grant select (owner_id, provider_reference, status, grandfathered, plan_code,"],
  ["la política de suscripciones deja de filtrar por propietaria", M1_FILES[0], "create policy billing_subscriptions_owner_select on public.billing_subscriptions for select to authenticated using (owner_id = auth.uid());", "create policy billing_subscriptions_owner_select on public.billing_subscriptions for select to authenticated using (true);"],
  ["la política de períodos deja de filtrar por propietaria", M1_FILES[0], "create policy billing_periods_owner_select on public.billing_periods for select to authenticated using (owner_id = auth.uid());", "create policy billing_periods_owner_select on public.billing_periods for select to authenticated using (true);"],
  ["el trigger de importe contra el catálogo no compara el importe", M1_FILES[0], "if v_amount is null or new.amount_minor <> v_amount or new.currency <> 'ARS' then", "if v_amount is null or new.currency <> 'ARS' then"],
  ["se elimina el trigger que exige un período registrado", M1_FILES[0], "create trigger billing_subscriptions_backed before insert or update on public.billing_subscriptions for each row execute function public.billing_check_subscription_backed_by_payment();", ""],
  ["se elimina el control de versión", M1_FILES[0], "create trigger billing_subscriptions_version before update on public.billing_subscriptions for each row execute function public.billing_enforce_version_bump();", ""],
  ["se elimina la unicidad de ejecución por proveedor", M1_FILES[0], "constraint billing_executions_provider_uid_unique unique (provider, execution_uid)\n", "constraint billing_executions_dummy check (true)\n"],
  ["se elimina la inmutabilidad de la propietaria de un cobro", M1_FILES[0], "create trigger billing_executions_owner before update on public.billing_executions for each row execute function public.billing_forbid_owner_change();", ""],
  ["se elimina el índice de un solo intento abierto", M1_FILES[0], "create unique index if not exists billing_checkout_attempts_one_open_idx on public.billing_checkout_attempts (owner_id) where status = 'open';", ""],
  ["se elimina el índice de un solo cambio programado", M1_FILES[0], "create unique index if not exists billing_plan_changes_one_scheduled_idx on public.billing_plan_changes (owner_id) where kind = 'plan_change' and status = 'scheduled';", ""],
  ["los avisos pueden guardar cualquier tamaño", M1_FILES[0], "check (octet_length(normalized::text) <= 4096)", ""],
  ["un precio del catálogo SQL difiere del servidor", M1_FILES[0], "('tf_annual_ars_v1',     'Anual',      'ARS', 24900000,", "('tf_annual_ars_v1',     'Anual',      'ARS', 24900001,"],
  ["una función de servidor se vuelve ejecutable por authenticated", M1_FILES[2], "grant execute on function public.billing_commit_batch(jsonb) to service_role;", "grant execute on function public.billing_commit_batch(jsonb) to service_role, authenticated;"],
  ["una función de servidor se vuelve ejecutable por anon", M1_FILES[1], "grant execute on function public.billing_claim_events(int, int, text, int) to service_role;", "grant execute on function public.billing_claim_events(int, int, text, int) to service_role, anon;"],
  ["una función pierde el search_path vacío", M1_FILES[2], "returns jsonb\nlanguage plpgsql\nset search_path = ''\nas $$\ndeclare\n  v_conflicts uuid[];", "returns jsonb\nlanguage plpgsql\nas $$\ndeclare\n  v_conflicts uuid[];"],
  ["el reclamo deja de saltear filas bloqueadas", M1_FILES[1], "       for update skip locked", ""],
  ["se rompe la recuperación de arrendamientos vencidos", M1_FILES[1], "where e.status = 'processing' and e.locked_until < now();", "where e.status = 'processing' and e.locked_until < now() - interval '100 years';"],
  ["el control optimista de versión se ignora", M1_FILES[2], "where t.owner_id = i.owner_id and t.version = i.expected_version", "where t.owner_id = i.owner_id"],
  ["un resultado viejo pisa al nuevo", M1_FILES[2], "(excluded.occurred_at > public.billing_executions.occurred_at\n          or", "(true\n          or"],
  ["un cobro puede cambiar de propietaria", M1_FILES[2], "where public.billing_executions.owner_id = excluded.owner_id\n     and (", "where (true) and ("],
  ["el checkout permite cualquier estado", M1_FILES[2], "if v_sub.status not in ('grandfathered', 'pending', 'canceled', 'expired') then", "if false then"],
  ["el checkout toma el precio del llamador (ignora el catálogo)", M1_FILES[2], "values (p_owner, v_plan.code, v_plan.price_version, v_plan.amount_minor, v_plan.currency, p_provider, p_idempotency_key, p_expires_at)", "values (p_owner, v_plan.code, v_plan.price_version, 1, v_plan.currency, p_provider, p_idempotency_key, p_expires_at)"],
  ["el checkout no reutiliza el intento vivo (crea uno nuevo siempre)", M1_FILES[2], "where a.owner_id = p_owner and a.status in ('open', 'completed') and a.expires_at > now()\n     order by a.created_at desc limit 1;\n    if found and v_attempt.plan_code = v_plan.code then", "where a.owner_id = p_owner and a.status in ('open', 'completed') and a.expires_at > now()\n     order by a.created_at desc limit 1;\n    if found and false then"],
  ["el checkout no bloquea la fila de la suscripción", M1_FILES[2], "select * into v_sub from public.billing_subscriptions s where s.owner_id = p_owner for update;", "select * into v_sub from public.billing_subscriptions s where s.owner_id = p_owner;"],
  ["la retención borra avisos pendientes", M1_FILES[1], "where e.purge_after < now() and e.status in ('processed', 'ignored', 'dead')", "where e.purge_after < now()"],
  ["la ingesta no respeta el enfriamiento de 60 segundos", M1_FILES[2], "e.received_at > now() - interval '60 seconds'", "false"],
  ["la ingesta pierde el filtro de duplicados pendientes", M1_FILES[2], "from fresh f\n    on conflict", "from input f\n    on conflict"],
  // --- M2
  ["el registro fiscal guarda la propietaria sin seudonimizar", M1_FILES[2], "encode(sha256(convert_to(coalesce(v_salt, '') || ':' || new.owner_id::text, 'UTF8')), 'hex'),", "replace(new.owner_id::text, '-', '') || repeat('0', 32),"],
  ["el registro fiscal se conserva sólo 1 año", M1_FILES[2], "+ interval '10 years')::date)", "+ interval '1 year')::date)"],
  ["un cobro rechazado entra al registro fiscal", M1_FILES[2], "if new.outcome = 'rejected' then return new; end if;", ""],
  ["la purga fiscal borra también lo que no venció", M1_FILES[2], "where f.retain_until < current_date order by", "where true order by"],
  ["el registro fiscal deja de tener RLS", M1_FILES[2], "alter table public.billing_fiscal_records enable row level security;", ""],
  ["el registro fiscal queda legible por anon", M1_FILES[2], "revoke all on table public.billing_fiscal_records from public, anon, authenticated;", "revoke all on table public.billing_fiscal_records from public;"],
  ["la agenda de sondeos deja de tener RLS", M1_FILES[2], "alter table public.billing_poll_schedule enable row level security;", ""],
  ["una función de sondeo se vuelve ejecutable por anon", M1_FILES[2], "grant execute on function public.billing_claim_polls(timestamptz, int, int) to service_role;", "grant execute on function public.billing_claim_polls(timestamptz, int, int) to service_role, anon;"],
  ["el sondeo reclamado no queda arrendado", M1_FILES[2], "set due_at = p_now + pg_catalog.make_interval(secs => greatest(p_lease_seconds, 30)), updated_at = now()", "set due_at = p_now, updated_at = now()"],
  ["una falla del proveedor se reintenta sin espera", M1_FILES[2], "least(21600, 300 * (2 ^ least(ps.failures, 7))::int)", "0"],
  ["tras muchas fallas nunca queda una revisión abierta", M1_FILES[2], "where u.failed and u.failures >= 8", "where u.failed and u.failures >= 100000"],
  ["los suscriptores no se resuelven por uid del proveedor", M1_FILES[2], "or s.provider_subscriber_uid = any (coalesce(p_uids, '{}'::text[]))", "or false"],
  ["un suscriptor nuevo no reemplaza al anterior", M1_FILES[2], "and s.provider_subscriber_uid is distinct from p_subscriber_uid;", "and s.provider_subscriber_uid is null;"],
  ["el checkout no informa los suscriptores reemplazados", M1_FILES[2], "'superseded', v_superseded, 'stale', v_stale,", "'superseded', v_superseded, 'stale', '[]'::jsonb,"],
  ["el checkout no devuelve el enlace ya creado", M1_FILES[2], "'redirect_url', v_attempt.redirect_url,", "'redirect_url', null,"],
  ["los períodos anulados no se marcan", M1_FILES[2], "set voided_at = now()\n    from jsonb_to_recordset", "set voided_at = null\n    from jsonb_to_recordset"],
  ["un período anulado sigue respaldando el estado", M1_FILES[2], "p.period_end = new.current_period_end and p.voided_at is null", "p.period_end = new.current_period_end"],
  ["el resultado manual permite bajar la jerarquía", M1_FILES[2], "if public.billing_outcome_rank(p_outcome) <= public.billing_outcome_rank(v_exec.outcome) then", "if false then"],
  ["los cobros ya no admiten devoluciones ni contracargos", M1_FILES[2], "check (outcome in ('approved', 'rejected', 'refunded', 'chargeback'))", "check (outcome in ('approved', 'rejected'))"],
  ["la jerarquía de resultados trata el contracargo como un rechazo", M1_FILES[2], "when 'chargeback' then 3 else -1 end;", "when 'chargeback' then 0 else -1 end;"],
];

/** Mutaciones del CÓDIGO DE APLICACIÓN (procesador y almacén) que sólo se detectan contra Postgres real. */
const LIB_MUTATIONS = [
  ["el almacén escribe con versión esperada 0 (nunca coincide)", "lib/billing/rpc-store.ts", "expected_version: expectedVersion,", "expected_version: 0,"],
  ["un aviso nunca pasa a dead aunque el proveedor siga caído", "lib/billing/processor.ts", "} else if (event.attempts + 1 >= maxAttempts) {", "} else if (false) {"],
  ["un pago que el proveedor no conoce se reintenta eternamente (en lugar de quedar como anomalía)", "lib/billing/processor.ts", 'if (kind === "rejected") {', "if (false) {"],
  ["el procesamiento nunca escribe la suscripción", "lib/billing/processor.ts", "const subscription = reduced.changed || patch !== undefined || nextCheck !== loaded.nextCheckAt ?", "const subscription = false ?"],
  ["el barrido no repara la próxima revisión guardada de una cuenta que no cambió de estado", "lib/billing/processor.ts", "reduced.changed || patch !== undefined || nextCheck !== loaded.nextCheckAt ?", "reduced.changed || patch !== undefined ?"],
  ["un cobro rechazado se registra como aprobado", "lib/billing/processor.ts", "outcome: fact.outcome,\n      planCode: fact.planCode,", 'outcome: "approved",\n      planCode: fact.planCode,'],
  ["el barrido del reloj nunca avanza el cursor (reprocesa siempre las mismas cuentas)", "lib/billing/processor.ts", "    after = due.nextCursor;\n    if (!after) break;", "    after = null;\n    if (stats.pages >= 3) break;"],
  ["los períodos devueltos o contracargados no se anulan", "lib/billing/processor.ts", 'incomingFinals.filter((fact) => fact.outcome === "refunded" || fact.outcome === "chargeback")', "incomingFinals.filter(() => false)"],
  ["una devolución parcial o ambigua se aplica como total", "lib/billing/reconcile.ts", 'if (operation.outcome === "refunded" && operation.refundScope !== "full") return anomaly("refund_review", ownerId);', ""],
  ["el sondeo no repara una cancelación hecha en el proveedor", "lib/billing/processor.ts", 'if (state.status === "suspended" && open && !snapshot.cancelRequestedAt) {', "if (false) {"],
  ["el sondeo no vuelve a suspender a quien canceló", "lib/billing/processor.ts", 'else if (state.status === "active" && snapshot.cancelRequestedAt && snapshot.providerSubscriberUid && polled.planCode) {', "else if (false) {"],
  ["una falla del proveedor en el sondeo no se registra como falla", "lib/billing/processor.ts", "        results.push({ ownerId, nextAt: null, failed: true });", "        results.push({ ownerId, nextAt: new Date(now.getTime() + 60_000).toISOString(), failed: false });"],
  ["el checkout vuelve a crear un suscriptor aunque el intento ya tiene enlace", "lib/billing/commands.ts", 'if (opened.attempt.status === "completed" && opened.attempt.redirectUrl) return', "if (false) return"],
  ["el checkout no cancela al suscriptor del intento reemplazado", "lib/billing/commands.ts", "for (const stale of opened.stale) {", "for (const stale of []) {"],
  ["la eliminación sigue aunque no se pueda confirmar la cancelación", "lib/billing/account-deletion.ts", "    break; // «unknown»: el proveedor devolvió algo que no se interpreta → no se puede confirmar", "    return { ok: true };"],
];

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const mutations = process.argv.includes("--mutations");
  if (process.argv.includes("--lib-mutations")) {
    // Mutaciones del CÓDIGO DE APLICACIÓN (procesador y almacén) que sólo se detectan contra Postgres real: cada una corre la batería en
    // un proceso aparte, con una copia mutada de lib/billing (BILLING_LIB_DIR).
    const { spawnSync } = await import("node:child_process");
    const copy = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name));
        else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
      }
    };
    let undetected = 0;
    for (const [description, file, find, replacement] of LIB_MUTATIONS) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-libmut-"));
      copy(path.join(REPO, "lib", "billing"), path.join(dir, "lib", "billing"));
      copy(path.join(REPO, "lib", "calendar"), path.join(dir, "lib", "calendar"));
      const target = path.join(dir, file);
      const source = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      if (!source.includes(find)) {
        console.log(`✖ MUTACIÓN NO APLICABLE: ${description}`);
        undetected += 1;
        continue;
      }
      fs.writeFileSync(target, source.split(find).join(replacement));
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--fail-fast"], { env: { ...process.env, BILLING_LIB_DIR: path.join(dir, "lib") }, encoding: "utf8", timeout: 900_000 });
      const detected = run.status !== 0;
      const why = (run.stdout ?? "").split("\n").find((line) => line.startsWith("✖")) ?? "";
      console.log(`${detected ? "✔ detectada " : "✖ NO DETECTADA"}  ${description}${detected ? `  ← ${why.slice(0, 70)}` : ""}`);
      if (!detected) undetected += 1;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log(`\n${LIB_MUTATIONS.length} mutaciones del código de aplicación contra Postgres real, ${undetected} sin detectar`);
    process.exit(undetected === 0 ? 0 : 1);
  } else if (!mutations) {
    const { results, failed } = await runChecks({ failFast: process.argv.includes("--fail-fast") });
    for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}${r.ok ? "" : `\n    → ${r.error}`}`);
    console.log(`\n${results.length} comprobaciones, ${failed.length} fallidas`);
    process.exit(failed.length === 0 ? 0 : 1);
  } else {
    const original = path.join(REPO, "supabase", "migrations");
    let undetected = 0;
    const skip = process.argv.includes("--skip") ? Number(process.argv[process.argv.indexOf("--skip") + 1]) : 0; // --skip N: retoma una corrida interrumpida
    for (const [description, file, find, replacement] of MUTATIONS.slice(skip)) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-mut-"));
      for (const name of fs.readdirSync(original)) fs.copyFileSync(path.join(original, name), path.join(dir, name));
      const source = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
      if (!source.includes(find)) {
        console.log(`✖ MUTACIÓN NO APLICABLE (el texto cambió): ${description}`);
        undetected += 1;
        continue;
      }
      fs.writeFileSync(path.join(dir, file), source.replace(find, replacement));
      let detected = false;
      let why = "";
      try {
        const { failed } = await runChecks({ migrationsDir: dir, label: description, failFast: true });
        detected = failed.length > 0;
        why = failed[0]?.name ?? "";
      } catch (error) {
        detected = true;
        why = `error: ${String(error?.message ?? error ?? "rechazo sin mensaje").slice(0, 80)}`;
      }
      console.log(`${detected ? "✔ detectada " : "✖ NO DETECTADA"}  ${description}${detected ? `  ← ${why.slice(0, 70)}` : ""}`);
      if (!detected) undetected += 1;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log(`\n${MUTATIONS.length} mutaciones, ${undetected} sin detectar`);
    process.exit(undetected === 0 ? 0 : 1);
  }
}
