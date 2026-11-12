// ENSAYO de la migración 20261112120000_billing_rebill_provider.sql sobre el esquema REAL (Postgres real, embedded-postgres 17) con datos sembrados de facturación previos
// (proveedores `mobbex` y `fake`). Nada se aplica a ningún proyecto de Supabase.
//
//   1. BEGIN … aplicar … verificar … ROLLBACK: el estado vuelve EXACTAMENTE al previo
//   2. aplicar de verdad: nada previo cambia; `rebill` es válido en las seis tablas; los valores ajenos siguen rechazados; reaplicar es idempotente (mismas huellas)
//   3. privilegios: las funciones nuevas sólo las ejecuta service_role; search_path vacío; la firma vieja de resolve sigue funcionando (sin ids de pago)
//   4. ROLLBACK reproducible (supabase/repairs/rebill_provider_rollback.sql): sin filas `rebill` vuelve a lo previo; con filas `rebill` FALLA sin tocar datos
//
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/rebill_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const ROLLBACK = path.join(__dirname, "..", "..", "repairs", "rebill_provider_rollback.sql");
const FILE = "20261112120000_billing_rebill_provider.sql";
const PRE = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f < FILE).sort().at(-1);
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const TABLES = ["billing_subscriptions", "billing_executions", "billing_periods", "billing_checkout_attempts", "billing_webhook_events", "billing_fiscal_records"];
let bad = 0;
const ok = (condition, message) => {
  console.log((condition ? "  ok   " : "  FALLA ") + message);
  if (!condition) bad += 1;
};
const sql = (file) => fs.readFileSync(path.join(MIG, file), "utf8");

async function snapshot(db) {
  const rows = async (text) => (await db.query(text)).rows.map((row) => Object.values(row).join("|"));
  return {
    cons: await rows("select conrelid::regclass::text || '.' || conname || '|' || md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'billing\\_%' order by 1"),
    fns: await rows("select proname || '(' || pg_get_function_identity_arguments(oid) || ')|' || md5(pg_get_functiondef(oid)) || '|' || coalesce(proacl::text, 'default') from pg_proc where pronamespace = 'public'::regnamespace and proname like 'billing\\_%' order by 1"),
    idx: await rows("select indexname || '|' || md5(indexdef) from pg_indexes where schemaname = 'public' and tablename like 'billing\\_%' order by 1"),
    data: await rows(
      TABLES.concat(["billing_plans", "billing_poll_schedule", "billing_reconciliations"]).map((t) => `select '${t}' || '|' || count(*) || '|' || coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '') from public.${t} x`).join(" union all ") + " order by 1",
    ),
  };
}

(async () => {
  const pg = await start({ port: 5471 + Math.floor(Math.random() * 300), upTo: PRE });
  const db = pg.admin;
  if (pg.failures.length) throw new Error("migraciones previas con error: " + JSON.stringify(pg.failures));
  console.log(`última migración previa: ${PRE}`);
  await db.query("insert into auth.users(id,email,created_at) values ($1,'a@x.test', now()),($2,'b@x.test', now())", [A, B]);
  await db.query("select public.billing_ensure_account($1)", [A]);
  await db.query("select public.billing_ensure_account($1)", [B]);
  // Filas históricas de Mobbex y del adaptador falso en las seis tablas (lo que ya existe nunca puede cambiar).
  await db.query("update public.billing_subscriptions set provider = 'mobbex', version = version + 1 where owner_id = $1", [A]);
  await db.query("insert into public.billing_executions (owner_id, provider, execution_uid, provider_payment_id, outcome, plan_code, amount_minor, currency, due_at, occurred_at) values ($1,'mobbex','exe_hist','pay_hist','approved','tf_monthly_ars_v1',2490000,'ARS', now(), now())", [A]);
  await db.query("insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized) values (repeat('a',64),'mobbex','other',repeat('b',64),'{}'::jsonb), (repeat('c',64),'fake','other',repeat('d',64),'{}'::jsonb)");
  const before = await snapshot(db);

  console.log("\n[1] BEGIN … aplicar … ROLLBACK");
  await db.query("begin");
  await db.query(sql(FILE));
  const inTx = await snapshot(db);
  ok(JSON.stringify(inTx.data) === JSON.stringify(before.data), "ninguna fila existente cambió dentro de la transacción");
  ok(inTx.fns.length === before.fns.length + 1, `una función nueva (billing_bind_subscribers): ${before.fns.length} → ${inTx.fns.length}`);
  await db.query("rollback");
  const afterRollback = await snapshot(db);
  ok(JSON.stringify(afterRollback) === JSON.stringify(before), "tras ROLLBACK: restricciones, funciones, índices y datos idénticos a los previos");

  console.log("\n[2] aplicar de verdad e idempotencia");
  await db.query(sql(FILE));
  const applied = await snapshot(db);
  ok(JSON.stringify(applied.data) === JSON.stringify(before.data), "los datos previos (Mobbex y falso) no cambiaron");
  ok(JSON.stringify(applied.idx) === JSON.stringify(before.idx), "los índices no cambiaron");
  for (const table of TABLES) {
    const defs = (await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = 'c' and conname = $2", ["public." + table, `${table}_provider_check`])).rows;
    ok(defs.length === 1 && /rebill/.test(defs[0].d) && /mobbex/.test(defs[0].d) && /fake/.test(defs[0].d), `${table}: la restricción admite mobbex, fake y rebill (una sola)`);
  }
  ok(!(await db.query("select 1 from pg_constraint where conrelid = 'public.billing_executions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'provider(::text)? = ANY' and conname <> 'billing_executions_provider_check'")).rows.length, "no quedó ninguna restricción de proveedor duplicada o vieja");
  await db.query("insert into public.billing_executions (owner_id, provider, execution_uid, provider_payment_id, outcome, plan_code, amount_minor, currency, due_at, occurred_at) values ($1,'rebill','test_pay_x','test_pay_x','approved','tf_monthly_ars_v2',2590000,'ARS', now(), now())", [B]);
  let rejected = false;
  try {
    await db.query("insert into public.billing_executions (owner_id, provider, execution_uid, provider_payment_id, outcome, plan_code, amount_minor, currency, due_at, occurred_at) values ($1,'otro','e2','p2','approved','tf_monthly_ars_v2',2590000,'ARS', now(), now())", [B]);
  } catch {
    rejected = true;
  }
  ok(rejected, "un proveedor desconocido sigue rechazado");
  await db.query(sql(FILE));
  const twice = await snapshot(db);
  ok(JSON.stringify(twice.cons) === JSON.stringify(applied.cons) && JSON.stringify(twice.fns) === JSON.stringify(applied.fns) && JSON.stringify(twice.idx) === JSON.stringify(applied.idx), "reaplicar es idempotente: mismas restricciones, funciones (cuerpo y permisos) e índices");

  console.log("\n[3] privilegios y compatibilidad");
  for (const fn of ["billing_bind_subscribers(jsonb)", "billing_resolve_subscribers(text[], text[], text[])"]) {
    for (const [role, expected] of [["anon", false], ["authenticated", false], ["service_role", true]]) {
      const has = (await db.query("select has_function_privilege($1, $2, 'execute') h", [role, `public.${fn}`])).rows[0].h;
      ok(has === expected, `${fn}: ${role} ${expected ? "puede" : "NO puede"} ejecutar`);
    }
  }
  const config = (await db.query("select array_to_string(proconfig, ',') c from pg_proc where proname in ('billing_bind_subscribers','billing_resolve_subscribers') and pronamespace = 'public'::regnamespace")).rows;
  ok(config.length === 2 && config.every((row) => /^search_path=("")?$/.test(row.c)), "search_path vacío en ambas funciones");
  const old = await db.query("select count(*)::int n from public.billing_resolve_subscribers(array[]::text[], array[]::text[])");
  ok(old.rows[0].n === 0, "la llamada de dos argumentos (código anterior) sigue funcionando");
  const sub = (await db.query("select provider_reference r from public.billing_subscriptions where owner_id = $1", [B])).rows[0].r;
  const resolved = await db.query("select owner_id, payment_ids from public.billing_resolve_subscribers(array[$1]::text[], array[]::text[], array['test_pay_x'])", [sub]);
  ok(resolved.rowCount === 1 && resolved.rows[0].payment_ids.includes("test_pay_x"), "resolver por referencia + id de pago devuelve el id conciliado");
  const byPayment = await db.query("select owner_id from public.billing_resolve_subscribers(array[]::text[], array[]::text[], array['test_pay_x'])");
  ok(byPayment.rowCount === 1 && byPayment.rows[0].owner_id === B, "resolver SÓLO por id de pago encuentra a la cuenta correcta y a ninguna otra");
  const bound = await db.query("select * from public.billing_bind_subscribers($1::jsonb)", [JSON.stringify([{ owner_id: B, subscriber_uid: "test_sub_B", plan_code: "tf_monthly_ars_v2" }])]);
  ok(bound.rows[0].bound === true && bound.rows[0].previous_uid === null, "vincular el primer suscriptor");
  const again = await db.query("select * from public.billing_bind_subscribers($1::jsonb)", [JSON.stringify([{ owner_id: B, subscriber_uid: "test_sub_B", plan_code: "tf_monthly_ars_v2" }])]);
  ok(again.rows[0].bound === false, "repetirlo no cambia nada");
  const stolen = await db.query("select * from public.billing_bind_subscribers($1::jsonb)", [JSON.stringify([{ owner_id: A, subscriber_uid: "test_sub_B", plan_code: "tf_monthly_ars_v2" }])]);
  ok(stolen.rows[0].bound === false, "un suscriptor ya vinculado a otra cuenta NUNCA se vincula a una segunda");
  const rebound = await db.query("select * from public.billing_bind_subscribers($1::jsonb)", [JSON.stringify([{ owner_id: B, subscriber_uid: "test_sub_B2", plan_code: "tf_monthly_ars_v2" }])]);
  ok(rebound.rows[0].bound === true && rebound.rows[0].previous_uid === "test_sub_B", "volver a vincular devuelve el suscriptor anterior (para pausarlo)");
  ok((await db.query("select count(*)::int n from public.billing_poll_schedule where owner_id = $1", [B])).rows[0].n === 1, "vincular programa el sondeo del suscriptor");
  await db.query("select public.billing_bind_subscribers('[]'::jsonb)");
  let malformed = false;
  try {
    await db.query("select public.billing_bind_subscribers('{}'::jsonb)");
  } catch {
    malformed = true;
  }
  ok(malformed, "un lote que no es un arreglo se rechaza");
  const sessionA = await pg.session(A, "authenticated");
  let denied = false;
  try {
    await sessionA.query("select * from public.billing_bind_subscribers('[]'::jsonb)");
  } catch {
    denied = true;
  }
  ok(denied, "una usuaria autenticada no puede llamar a la función de vinculación");
  await sessionA.end();

  console.log("\n[4] rollback reproducible");
  await db.query("begin");
  await db.query("delete from public.billing_executions where provider = 'rebill'");
  await db.query("update public.billing_subscriptions set provider = 'mobbex', version = version + 1 where provider = 'rebill'");
  await db.query("delete from public.billing_fiscal_records where provider = 'rebill'"); // sólo en esta prueba: el registro fiscal real se conserva 10 años
  await db.query(fs.readFileSync(ROLLBACK, "utf8").replace(/^begin;/im, "").replace(/^commit;/im, ""));
  const rolled = await snapshot(db);
  ok(rolled.cons.join() === before.cons.join(), "sin filas rebill: las restricciones vuelven a ser las previas");
  const shape = (list) => list.map((row) => row.replace(/\|[0-9a-f]{32}\|/, "|")).join();
  ok(shape(rolled.fns) === shape(before.fns), "y las funciones también (mismas firmas y permisos; el cuerpo de resolve es equivalente)");
  await db.query("rollback");
  await db.query("begin");
  let blocked = false;
  try {
    await db.query(fs.readFileSync(ROLLBACK, "utf8").replace(/^begin;/im, "").replace(/^commit;/im, ""));
  } catch {
    blocked = true;
  }
  await db.query("rollback");
  ok(blocked, "con filas rebill ya registradas el rollback FALLA (no borra historia ni la altera)");
  ok((await db.query("select count(*)::int n from public.billing_executions where provider = 'rebill'")).rows[0].n === 1, "la fila de Rebill sigue ahí");

  await pg.stop();
  console.log(bad === 0 ? "\nENSAYO REBILL: todo ok" : `\nENSAYO REBILL: ${bad} FALLA(S)`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
