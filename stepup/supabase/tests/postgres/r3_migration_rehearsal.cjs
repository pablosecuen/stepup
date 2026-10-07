// R3 — Ensayo único de las dos migraciones de cuotas sobre el esquema REAL (Postgres real) con datos sembrados:
//   BEGIN; aplicar ambas; comparar huellas de TODAS las tablas de datos; ROLLBACK; comparar; aplicar de verdad; reaplicar (idempotencia);
//   y comprobar que el uso normal anterior (altas, clases, cobros) sigue funcionando con los disparadores puestos.
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/r3_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { start } = require("./load.cjs");
const MIG = path.join(__dirname, "..", "..", "migrations");
const M1 = "20261007100000_r3_quota_infrastructure.sql";
const M2 = "20261007110000_r3_quota_triggers.sql";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const NEW_TABLES = ["quota_defaults", "action_quota_defaults", "account_quota_overrides", "account_action_events"];
let bad = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FALLA ") + m); if (!c) bad += 1; };
const md5uuid = (text) => crypto.createHash("md5").update(text).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

async function fingerprint(db, exclude = []) {
  const out = {};
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename).filter((t) => !exclude.includes(t));
  for (const t of tables) {
    const r = await db.query(`select count(*)::int c, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public."${t}" x`);
    out[t] = r.rows[0].c + ":" + r.rows[0].h;
  }
  return out;
}
async function objects(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => Object.values(r)[0]);
  return {
    tables: await q("select tablename from pg_tables where schemaname = 'public' order by 1"),
    fn: await q("select proname || '(' || pg_get_function_identity_arguments(oid) || ')' from pg_proc where pronamespace = 'public'::regnamespace order by 1"),
    idx: await q("select indexname from pg_indexes where schemaname = 'public' order by 1"),
    cons: await q("select conname from pg_constraint where connamespace = 'public'::regnamespace order by 1"),
    trg: await q("select c.relname || ':' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1"),
    pol: await q("select tablename || '.' || policyname from pg_policies where schemaname = 'public' order by 1"),
  };
}
const diff = (a, b) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

(async () => {
  const pg = await start({ port: 5445, upTo: "20261006110000_r2_fk_and_window_indexes.sql" }); // todo lo anterior a R3
  const db = pg.admin;
  await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
  for (const [owner, tag] of [[A, "a"], [B, "b"]]) {
    await db.query(`insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
      select md5($2 || 'st' || s)::uuid, $1::uuid, 'Alumno ' || s, 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}' from generate_series(1, 40) s`, [owner, tag]);
    await db.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period)
      select md5($2 || 'ch' || s || '-' || p)::uuid, $1::uuid, md5($2 || 'st' || s)::uuid, 'mensual', 1500, (date '2024-01-10' + (p || ' month')::interval)::date, to_char(date '2024-01-01' + (p || ' month')::interval, 'YYYY-MM')
      from generate_series(1, 40) s, generate_series(0, 11) p`, [owner, tag]);
  }
  const beforeFp = await fingerprint(db);
  const beforeObj = await objects(db);
  console.log(`esquema real (migraciones previas a R3): ${Object.keys(beforeFp).length} tablas, ${Object.values(beforeFp).reduce((s, v) => s + Number(v.split(":")[0]), 0)} filas`);

  console.log("\n[1] BEGIN … aplicar ambas … comparar huellas … ROLLBACK");
  await db.query("begin");
  for (const f of [M1, M2]) await db.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  const midFp = await fingerprint(db, NEW_TABLES);
  ok(Object.keys(beforeFp).every((t) => midFp[t] === beforeFp[t]) && Object.keys(midFp).length === Object.keys(beforeFp).length, "huellas de TODAS las tablas de datos existentes idénticas dentro de la transacción (ninguna fila cambió)");
  const midObj = await objects(db);
  ok(diff(beforeObj.fn, midObj.fn).removed.length === 0 && diff(beforeObj.idx, midObj.idx).removed.length === 0 && diff(beforeObj.cons, midObj.cons).removed.length === 0 && diff(beforeObj.pol, midObj.pol).removed.length === 0 && diff(beforeObj.trg, midObj.trg).removed.length === 0, "no se eliminó ninguna función, índice, constraint, disparador ni política");
  ok(diff(beforeObj.pol, midObj.pol).added.length === 0, "ninguna política RLS agregada ni cambiada (RLS general intacta)");
  ok(diff(beforeObj.tables, midObj.tables).added.sort().join() === "account_action_events,account_quota_overrides,action_quota_defaults,quota_defaults", "sólo 4 tablas nuevas");
  ok(diff(beforeObj.fn, midObj.fn).added.length === 5, `5 funciones nuevas (${diff(beforeObj.fn, midObj.fn).added.map((x) => x.split("(")[0]).join(", ")})`);
  ok(diff(beforeObj.trg, midObj.trg).added.length === 66, `66 disparadores nuevos: 2 por cada una de 33 tablas (hay ${diff(beforeObj.trg, midObj.trg).added.length})`);
  await db.query("rollback");
  ok(JSON.stringify(await fingerprint(db)) === JSON.stringify(beforeFp), "tras ROLLBACK: huellas idénticas");
  ok(JSON.stringify(await objects(db)) === JSON.stringify(beforeObj), "tras ROLLBACK: tablas, funciones, índices, constraints, disparadores y políticas idénticos (nada quedó)");

  console.log("\n[2] Aplicar de verdad y reaplicar (idempotencia)");
  for (const f of [M1, M2]) await db.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  const applied = await objects(db);
  let err = null;
  try { for (const f of [M1, M2]) await db.query(fs.readFileSync(path.join(MIG, f), "utf8")); } catch (e) { err = e.message; }
  ok(err === null, "reaplicar ambas no falla" + (err ? ": " + err : ""));
  ok(JSON.stringify(await objects(db)) === JSON.stringify(applied), "reaplicar no cambia nada");
  ok((await db.query("select count(*)::int c from public.quota_defaults")).rows[0].c === 37 && (await db.query("select count(*)::int c from public.action_quota_defaults")).rows[0].c === 4, "37 categorías y 4 acciones por defecto (sin duplicar al reaplicar)");
  ok(JSON.stringify(await fingerprint(db, NEW_TABLES)) === JSON.stringify(beforeFp), "huellas de los datos idénticas tras aplicar y reaplicar");

  console.log("\n[3] Compatibilidad: el uso normal del web anterior sigue funcionando con los disparadores puestos");
  const s = await pg.session(A);
  const flows = [
    ["alta de alumno por RPC", () => s.query("select * from public.create_student_with_operation('11111111-1111-4111-8111-111111111111'::uuid, $1::jsonb, false)", [JSON.stringify({ name: "Zeta Nueva", modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [] })])],
    ["lectura de alumnos", () => s.query("select count(*) from public.students where owner_id = auth.uid()")],
    ["generación de cobros (idempotente)", () => s.query("select public.ensure_monthly_charges('2026-10', $1::jsonb)", [JSON.stringify([{ student_id: md5uuid("ast1"), amount: 1000, due_date: "2026-10-10" }])])],
    ["nivel personalizado", () => s.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'B2')")],
  ];
  for (const [label, run] of flows) {
    let e = null;
    try { await run(); } catch (x) { e = x.message; }
    ok(e === null, `${label}${e ? ": " + e : ""}`);
  }
  await s.end();

  console.log("\n[4] Rollback manual (supabase/repairs/r3_quotas_rollback.sql): deja el esquema como estaba antes de R3");
  const afterFlows = await objects(db);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r3_quotas_rollback.sql"), "utf8"));
  const rolled = await objects(db);
  const same = JSON.stringify({ ...rolled, trg: rolled.trg }) === JSON.stringify(beforeObj);
  ok(same, "tras el rollback: tablas, funciones, índices, constraints, disparadores y políticas idénticos a los de antes de R3");
  const dataAfter = await fingerprint(db);
  ok(Object.keys(beforeFp).every((t) => t in dataAfter), "el rollback no eliminó ninguna tabla de datos de la aplicación");
  ok((await db.query("select count(*)::int c from public.students where owner_id = $1", [A])).rows[0].c === 41, "los datos de la aplicación (incluido lo creado con las cuotas activas) siguen ahí");
  ok(afterFlows.fn.length > rolled.fn.length, "el rollback retiró las 5 funciones de R3");
  console.log(bad === 0 ? "\nENSAYO OK" : `\nENSAYO CON ${bad} FALLA(S)`);
  await pg.stop();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
