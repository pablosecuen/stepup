// M2.1 — ENSAYO de las migraciones de facturación (M1 completas + M2) sobre el esquema REAL (Postgres real, embedded-postgres 17) con datos
// sembrados de DOS propietarias: nada se aplica a ningún proyecto de Supabase (`db push` NO se usa).
//
//   1. BEGIN … aplicar las tres … verificar cuerpos, privilegios, RLS, índices, funciones y huellas … ROLLBACK … comparar con el estado previo
//   2. aplicar de verdad; huellas de TODAS las funciones; reaplicar (idempotencia: mismas huellas, mismos datos)
//   3. dos propietarias sin cruces; anon sin acceso; authenticated sólo lectura propia; escrituras sensibles sólo por service_role y billing_*
//   4. ROLLBACK reproducible (supabase/repairs/m1_billing_rollback.sql): el esquema vuelve EXACTAMENTE al previo (salvo el registro fiscal,
//      que se conserva a propósito); reaplicar después deja las MISMAS huellas
//
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/m2_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const ROLLBACK = path.join(__dirname, "..", "..", "repairs", "m1_billing_rollback.sql");
const PRE = "20261012100000_r8_retire_legacy_student_claims_and_enddate.sql";
const FILES = ["20261014100000_m1_billing_core.sql", "20261014110000_m1_billing_functions.sql", "20261014120000_m2_billing_ops.sql"];
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
let bad = 0;
const ok = (condition, message) => {
  console.log((condition ? "  ok   " : "  FALLA ") + message);
  if (!condition) bad += 1;
};
const sql = (file) => fs.readFileSync(path.join(MIG, file), "utf8");

/** Huella de TODAS las tablas de datos que NO son de facturación: lo que ya existe no puede cambiar. */
async function dataFingerprint(db) {
  const out = {};
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' and tablename not like 'billing\\_%' order by 1")).rows.map((r) => r.tablename);
  for (const table of tables) {
    const r = await db.query(`select count(*)::int c, coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '') h from public."${table}" x`);
    out[table] = `${r.rows[0].c}:${r.rows[0].h}`;
  }
  return out;
}

/** Inventario del esquema (todo lo que no es de facturación + lo de facturación aparte). */
async function objects(db, billing) {
  const like = billing ? "like" : "not like";
  const q = async (text) => (await db.query(text)).rows.map((row) => Object.values(row)[0]);
  return {
    tables: await q(`select tablename from pg_tables where schemaname = 'public' and tablename ${like} 'billing\\_%' order by 1`),
    cols: await q(`select table_name || '.' || column_name || ':' || data_type from information_schema.columns where table_schema = 'public' and table_name ${like} 'billing\\_%' order by 1`),
    fns: await q(`select proname || '(' || pg_get_function_identity_arguments(oid) || ')' from pg_proc where pronamespace = 'public'::regnamespace and proname ${like} 'billing\\_%' order by 1`),
    idx: await q(`select indexname from pg_indexes where schemaname = 'public' and tablename ${like} 'billing\\_%' order by 1`),
    cons: await q(`select conrelid::regclass::text || '.' || conname from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text ${like} 'billing\\_%' order by 1`),
    trg: await q(`select c.relname || ':' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname ${like} 'billing\\_%' order by 1`),
    pol: await q(`select tablename || '.' || policyname from pg_policies where schemaname = 'public' and tablename ${like} 'billing\\_%' order by 1`),
    grants: await q(`select grantee || ':' || table_name || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name ${like} 'billing\\_%' and grantee in ('anon','authenticated','service_role') order by 1`),
    colgrants: await q(`select grantee || ':' || table_name || '.' || column_name || ':' || privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name ${like} 'billing\\_%' and grantee in ('anon','authenticated','service_role') order by 1`),
    fnacl: await q(`select proname || '(' || pg_get_function_identity_arguments(oid) || '):' || coalesce(proacl::text, 'default') from pg_proc where pronamespace = 'public'::regnamespace and proname ${like} 'billing\\_%' order by 1`),
    rls: await q(`select relname || ':' || relrowsecurity::text from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname ${like} 'billing\\_%' order by 1`),
  };
}
const diff = (a, b) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Huella (md5) del CUERPO de cada función de facturación y de cada trigger. */
async function bodyFingerprints(db) {
  const fns = (await db.query("select proname || '(' || pg_get_function_identity_arguments(oid) || ')' as k, md5(pg_get_functiondef(oid)) as h from pg_proc where pronamespace = 'public'::regnamespace and proname like 'billing\\_%' order by 1")).rows;
  const trg = (await db.query("select c.relname || ':' || t.tgname as k, md5(pg_get_triggerdef(t.oid)) as h from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname like 'billing\\_%' order by 1")).rows;
  const idx = (await db.query("select indexname as k, md5(indexdef) as h from pg_indexes where schemaname = 'public' and tablename like 'billing\\_%' order by 1")).rows;
  const con = (await db.query("select conrelid::regclass::text || '.' || conname as k, md5(pg_get_constraintdef(oid)) as h from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'billing\\_%' order by 1")).rows;
  const pol = (await db.query("select tablename || '.' || policyname as k, md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || roles::text) as h from pg_policies where schemaname = 'public' and tablename like 'billing\\_%' order by 1")).rows;
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.k, r.h]));
  return { fns: toMap(fns), trg: toMap(trg), idx: toMap(idx), con: toMap(con), pol: toMap(pol) };
}

(async () => {
  const pg = await start({ port: 5471 + Math.floor(Math.random() * 300), upTo: PRE });
  const db = pg.admin;
  if (pg.failures.length) throw new Error("migraciones previas con error: " + JSON.stringify(pg.failures));
  await db.query("insert into auth.users(id,email,created_at) values ($1,'a@x.test', now() - interval '60 days'),($2,'b@x.test', now() - interval '45 days')", [A, B]);
  for (const [owner, tag] of [[A, "a"], [B, "b"]]) {
    await db.query(
      `insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
       select md5($2 || 'st' || s)::uuid, $1::uuid, 'Alumno ' || s, 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}' from generate_series(1, 25) s`,
      [owner, tag],
    );
  }
  const beforeData = await dataFingerprint(db);
  const beforeApp = await objects(db, false);
  const beforeBilling = await objects(db, true);
  console.log(`esquema real previo a la facturación: ${Object.keys(beforeData).length} tablas de datos, ${Object.values(beforeData).reduce((n, v) => n + Number(v.split(":")[0]), 0)} filas; objetos de facturación previos: ${beforeBilling.tables.length}`);
  ok(beforeBilling.tables.length === 0 && beforeBilling.fns.length === 0, "el esquema previo no tiene ningún objeto billing_*");

  // ------------------------------------------------------------------------------------------------ [1] BEGIN … ROLLBACK
  console.log("\n[1] BEGIN … aplicar las tres migraciones … verificar … ROLLBACK");
  await db.query("begin");
  for (const file of FILES) await db.query(sql(file));
  const txObjects = await objects(db, true);
  const txBodies = await bodyFingerprints(db);
  ok(txObjects.tables.length === 12, `se crean exactamente 12 tablas billing_*: ${txObjects.tables.join(", ")}`);
  ok(txObjects.rls.length === 12 && txObjects.rls.every((row) => row.endsWith(":true")), "las 12 tablas tienen RLS habilitada");
  ok(txObjects.fns.length >= 25, `funciones billing_* creadas: ${txObjects.fns.length}`);
  ok(Object.keys(txBodies.fns).length === txObjects.fns.length && Object.values(txBodies.fns).every((h) => /^[0-9a-f]{32}$/.test(h)), "huella (md5) de cada cuerpo de función");
  ok(Object.keys(txBodies.trg).length >= 8, `triggers de integridad: ${Object.keys(txBodies.trg).length}`);
  const txData = await dataFingerprint(db);
  ok(same(txData, beforeData), "huellas de TODAS las tablas de datos de la aplicación idénticas dentro de la transacción (ninguna fila existente cambió)");
  ok(same(await objects(db, false), beforeApp), "el inventario de objetos de la aplicación (tablas, columnas, funciones, índices, restricciones, triggers, políticas, permisos) no cambió");
  const backfill = (await db.query("select status, grandfathered from public.billing_subscriptions order by owner_id")).rows;
  ok(backfill.length === 2 && backfill.every((row) => row.status === "grandfathered" && row.grandfathered), "las cuentas existentes quedan grandfathered (sólo se escribió en tablas nuevas)");
  await db.query("rollback");
  const afterRollback = await objects(db, true);
  if (process.env.DBG) console.log(JSON.stringify(afterRollback));
  ok(afterRollback.tables.length === 0 && afterRollback.fns.length === 0 && afterRollback.idx.length === 0 && afterRollback.cons.length === 0 && afterRollback.trg.length === 0 && afterRollback.pol.length === 0, "tras ROLLBACK no queda NINGÚN objeto de facturación (tablas, funciones, índices, restricciones, triggers, políticas)");
  ok(same(await objects(db, false), beforeApp) && same(await dataFingerprint(db), beforeData), "tras ROLLBACK el esquema y los datos son idénticos a los previos");
  ok((await db.query("select to_regclass('public.billing_subscriptions') r")).rows[0].r === null, "la tabla de suscripciones no existe tras el ROLLBACK");

  // ------------------------------------------------------------------------------------------------ [2] aplicar de verdad + idempotencia
  console.log("\n[2] aplicar de verdad; reaplicar (idempotencia)");
  for (const file of FILES) await db.query(sql(file));
  const live = await objects(db, true);
  const liveBodies = await bodyFingerprints(db);
  ok(same(live, txObjects), "el inventario aplicado de verdad es IDÉNTICO al ensayado dentro de la transacción");
  ok(same(liveBodies, txBodies), "las huellas de cuerpos de funciones, triggers, índices, restricciones y políticas son IDÉNTICAS a las ensayadas");
  const dataSnapshot = JSON.stringify((await db.query("select owner_id, status, provider_reference from public.billing_subscriptions order by owner_id")).rows);
  const plansSnapshot = JSON.stringify((await db.query("select * from public.billing_plans order by code")).rows);
  for (const file of FILES) await db.query(sql(file));
  ok(same(await objects(db, true), live) && same(await bodyFingerprints(db), liveBodies), "reaplicar las tres migraciones no cambia nada (mismo inventario y mismas huellas)");
  ok(JSON.stringify((await db.query("select owner_id, status, provider_reference from public.billing_subscriptions order by owner_id")).rows) === dataSnapshot && JSON.stringify((await db.query("select * from public.billing_plans order by code")).rows) === plansSnapshot, "reaplicar no duplica ni modifica cuentas ni catálogo");
  ok(same(await dataFingerprint(db), beforeData), "las tablas de datos de la aplicación siguen idénticas");

  // ------------------------------------------------------------------------------------------------ [3] privilegios y aislamiento
  console.log("\n[3] privilegios, RLS y aislamiento entre propietarias");
  const tables = live.tables;
  const functions = (await db.query("select p.oid, p.proname, p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'billing\\_%'")).rows;
  const anon = await pg.session("", "anon");
  let anonOk = true;
  for (const table of tables) {
    try { await anon.query(`select 1 from public.${table} limit 1`); anonOk = false; } catch (e) { anonOk &&= /permission denied/.test(e.message); }
    try { await anon.query(`insert into public.${table} default values`); anonOk = false; } catch (e) { anonOk &&= /permission denied/.test(e.message); }
  }
  ok(anonOk, "anon: sin acceso (lectura ni escritura) a ninguna de las 12 tablas");
  await anon.end();
  const fnAccess = async (role) => (await Promise.all(functions.map(async (fn) => (await db.query("select has_function_privilege($1, $2, 'execute') ok", [role, fn.oid])).rows[0].ok))).filter(Boolean).length;
  const triggerOnly = new Set(["billing_check_amount_vs_catalog", "billing_check_subscription_backed_by_payment", "billing_enforce_version_bump", "billing_forbid_owner_change", "billing_capture_fiscal_record"]);
  ok((await fnAccess("anon")) === 0 && (await fnAccess("authenticated")) === 0, "anon y authenticated no ejecutan NINGUNA función billing_*");
  if (process.env.DBG) console.log(await fnAccess("service_role"), functions.length, functions.filter((fn) => !triggerOnly.has(fn.proname)).length);
  const serverFns = functions.filter((fn) => !triggerOnly.has(fn.proname));
  const svcRunnable = (await Promise.all(serverFns.map(async (fn) => (await db.query("select has_function_privilege('service_role', $1, 'execute') ok", [fn.oid])).rows[0].ok))).filter(Boolean).length;
  ok(svcRunnable === serverFns.length, `service_role ejecuta las ${serverFns.length} funciones de servidor (las de trigger sólo las dispara la base)`);
  ok(functions.filter((fn) => fn.prosecdef).map((fn) => fn.proname).join() === "billing_ensure_account", "SECURITY DEFINER únicamente en billing_ensure_account (lee auth.users)");
  const cfg = (await db.query("select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'billing\\_%' and (proconfig is null or not exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))")).rows[0].n;
  ok(cfg === 0, "todas las funciones fijan search_path");

  const svc = await pg.session("", "service_role");
  await svc.query("select public.billing_ensure_account($1)", [A]);
  await svc.query("select public.billing_ensure_account($1)", [B]);
  for (const owner of [A, B]) {
    await db.query("insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) values ($1, 'fake', $2, 'tf_monthly_ars_v1', 1, 2490000, 'ARS', '2026-10-01', '2026-11-01')", [owner, `exe-${owner.slice(0, 2)}`]);
  }
  const asA = await pg.session(A, "authenticated");
  const mine = await asA.query("select owner_id from public.billing_subscriptions");
  const periods = await asA.query("select owner_id from public.billing_periods");
  ok(mine.rows.length === 1 && mine.rows[0].owner_id === A && periods.rows.length === 1 && periods.rows[0].owner_id === A, "la propietaria A lee SU fila y SUS períodos, y nada de B");
  ok((await asA.query("select owner_id from public.billing_subscriptions where owner_id = $1", [B])).rows.length === 0, "A no ve a B ni pidiéndolo por identificador");
  let blocked = true;
  for (const text of ["update public.billing_subscriptions set status = 'active'", "delete from public.billing_subscriptions", "insert into public.billing_subscriptions (owner_id, provider_reference) values (gen_random_uuid(), 'tfs_' || repeat('a', 32))", "update public.billing_periods set period_end = now()", "select provider_reference from public.billing_subscriptions", "select * from public.billing_subscriptions", "select 1 from public.billing_executions limit 1", "select 1 from public.billing_fiscal_records limit 1", "select 1 from public.billing_poll_schedule limit 1", "select 1 from public.billing_webhook_events limit 1"]) {
    try { await asA.query(text); blocked = false; console.log("    escapó:", text); } catch (e) { blocked &&= /permission denied/.test(e.message); }
  }
  ok(blocked, "authenticated: sólo LECTURA de su fila y sus períodos (columnas explícitas); toda escritura y toda otra tabla, rechazadas");
  await asA.end();
  const asB = await pg.session(B, "authenticated");
  ok((await asB.query("select owner_id from public.billing_subscriptions")).rows.every((row) => row.owner_id === B), "la propietaria B sólo ve lo suyo");
  await asB.end();
  const writes = await svc.query("select public.billing_prioritize_polls($1::uuid[]) v", [[A]]);
  ok(writes.rows[0].v === 0, "service_role escribe por funciones billing_* (la cuenta sin suscriptor no entra al sondeo)");
  await svc.end();

  // ------------------------------------------------------------------------------------------------ [4] ROLLBACK reproducible
  console.log("\n[4] ROLLBACK reproducible (supabase/repairs/m1_billing_rollback.sql)");
  const rollbackSql = fs.readFileSync(ROLLBACK, "utf8");
  await db.query(rollbackSql);
  const left = await objects(db, true);
  ok(left.tables.join() === "billing_fiscal_records" && left.fns.length === 0, `el rollback elimina todo lo de facturación y CONSERVA sólo el registro fiscal (tablas restantes: ${left.tables.join(", ") || "ninguna"}; funciones: ${left.fns.length})`);
  ok(same(await objects(db, false), beforeApp) && same(await dataFingerprint(db), beforeData), "el esquema y los datos de la aplicación vuelven EXACTAMENTE a los previos");
  await db.query(rollbackSql);
  ok(true, "el rollback es idempotente (se puede correr dos veces sin errores)");
  await db.query("drop table if exists public.billing_fiscal_records");
  const clean = await objects(db, true);
  if (process.env.DBG) console.log(JSON.stringify(clean));
  ok(clean.tables.length === 0 && clean.idx.length === 0 && clean.cons.length === 0 && clean.pol.length === 0 && clean.trg.length === 0, "con el borrado explícito del registro fiscal no queda NINGÚN objeto de facturación");
  for (const file of FILES) await db.query(sql(file));
  ok(same(await objects(db, true), live) && same(await bodyFingerprints(db), liveBodies), "reaplicar después del rollback deja EXACTAMENTE el mismo inventario y las mismas huellas (reproducible)");
  ok(same(await dataFingerprint(db), beforeData), "los datos de la aplicación nunca cambiaron en todo el ensayo");

  // M1 solo (cuando todavía no está M2): el rollback también funciona.
  await db.query(rollbackSql);
  await db.query("drop table if exists public.billing_fiscal_records");
  for (const file of FILES.slice(0, 2)) await db.query(sql(file));
  ok((await objects(db, true)).tables.length === 10, "M1 sola crea 10 tablas");
  await db.query(rollbackSql);
  ok((await objects(db, true)).tables.length === 0 && same(await objects(db, false), beforeApp), "el rollback también limpia una base con M1 sola");

  await pg.stop();
  console.log(bad === 0 ? "\nENSAYO COMPLETO: todo ok" : `\nENSAYO CON ${bad} FALLA(S)`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
