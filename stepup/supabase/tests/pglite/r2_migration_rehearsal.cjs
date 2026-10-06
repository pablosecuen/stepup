// R2 — Ensayo ÚNICO de las dos migraciones nuevas sobre el esquema REAL reproducido (PGlite), con datos sembrados:
//   BEGIN; aplicar ambas; comparar huellas de TODAS las tablas; ROLLBACK; comparar de nuevo; aplicar de verdad; reaplicar (idempotencia).
// Las migraciones sólo AGREGAN una función y índices: ninguna fila cambia y nada existente se elimina.
//
//   NODE_PATH=<carpeta con @electric-sql/pglite>/node_modules node supabase/tests/pglite/r2_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { load } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const M1 = "20261006100000_r2_list_open_charge_balances.sql";
const M2 = "20261006110000_r2_fk_and_window_indexes.sql";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";

let bad = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FALLA ") + msg); if (!cond) bad += 1; };

async function tables(db) {
  return (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
}
async function fingerprint(db) {
  const out = {};
  for (const t of await tables(db)) {
    const r = await db.query(`select count(*)::int c, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public."${t}" x`);
    out[t] = r.rows[0].c + ":" + r.rows[0].h;
  }
  return out;
}
async function objects(db) {
  const idx = (await db.query("select indexname from pg_indexes where schemaname = 'public' order by 1")).rows.map((r) => r.indexname);
  const fn = (await db.query("select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1")).rows.map((r) => r.proname);
  const cons = (await db.query("select conname from pg_constraint where connamespace = 'public'::regnamespace order by 1")).rows.map((r) => r.conname);
  return { idx, fn, cons };
}
const diff = (before, after) => ({ added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) });

(async () => {
  const { db } = await load({ upTo: "20261005160000_student_creation_operation_id.sql" }); // todo lo anterior a R2
  await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
  for (const [owner, tag] of [[A, "a"], [B, "b"]]) {
    await db.query(`insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
      select md5($2 || 'st' || s)::uuid, $1::uuid, 'Alumno ' || s, 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}' from generate_series(1, 40) s`, [owner, tag]);
    await db.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period)
      select md5($2 || 'ch' || s || '-' || p)::uuid, $1::uuid, md5($2 || 'st' || s)::uuid, 'mensual', 1500, (date '2024-01-10' + (p || ' month')::interval)::date, to_char(date '2024-01-01' + (p || ' month')::interval, 'YYYY-MM')
      from generate_series(1, 40) s, generate_series(0, 11) p`, [owner, tag]);
    await db.query(`insert into public.payments (id, owner_id, student_id, amount, method, paid_at)
      select md5($2 || 'pa' || s)::uuid, $1::uuid, md5($2 || 'st' || s)::uuid, 1500, 'efectivo', date '2024-01-12' from generate_series(1, 40) s`, [owner, tag]);
    await db.query(`insert into public.payment_allocations (id, owner_id, payment_id, charge_id, student_id, amount)
      select md5($2 || 'al' || s)::uuid, $1::uuid, md5($2 || 'pa' || s)::uuid, md5($2 || 'ch' || s || '-0')::uuid, md5($2 || 'st' || s)::uuid, 1500 from generate_series(1, 40) s`, [owner, tag]);
  }
  const beforeFp = await fingerprint(db);
  const beforeObj = await objects(db);
  const rowCount = Object.values(beforeFp).reduce((s, v) => s + Number(v.split(":")[0]), 0);
  console.log(`esquema real (migraciones previas a R2) con ${rowCount} filas sembradas en ${Object.keys(beforeFp).length} tablas`);
  ok(!beforeObj.fn.includes("list_open_charge_balances"), "antes: la función nueva no existe");

  console.log("\n[1] BEGIN … aplicar ambas migraciones … comparar huellas … ROLLBACK");
  await db.exec("begin");
  await db.exec(fs.readFileSync(path.join(MIG, M1), "utf8"));
  await db.exec(fs.readFileSync(path.join(MIG, M2), "utf8"));
  const inTx = await fingerprint(db);
  ok(JSON.stringify(inTx) === JSON.stringify(beforeFp), "huellas de las tablas idénticas dentro de la transacción (ninguna fila cambió)");
  const midObj = await objects(db);
  const d1 = diff(beforeObj.idx, midObj.idx);
  ok(d1.removed.length === 0, `no se eliminó ningún índice (agregados: ${d1.added.length})`);
  ok(diff(beforeObj.cons, midObj.cons).removed.length === 0 && diff(beforeObj.cons, midObj.cons).added.length === 0, "ningún constraint agregado ni eliminado");
  ok(diff(beforeObj.fn, midObj.fn).removed.length === 0 && diff(beforeObj.fn, midObj.fn).added.join() === "list_open_charge_balances", "una única función agregada y ninguna eliminada");
  await db.exec("rollback");
  const afterRb = await fingerprint(db);
  const rbObj = await objects(db);
  ok(JSON.stringify(afterRb) === JSON.stringify(beforeFp), "tras ROLLBACK: huellas idénticas a las de antes");
  ok(JSON.stringify(rbObj) === JSON.stringify(beforeObj), "tras ROLLBACK: índices, funciones y constraints idénticos a los de antes (nada quedó)");

  console.log("\n[2] Aplicar de verdad (en orden) y reaplicar (idempotencia)");
  for (const f of [M1, M2]) await db.exec(fs.readFileSync(path.join(MIG, f), "utf8"));
  const applied = await fingerprint(db);
  ok(JSON.stringify(applied) === JSON.stringify(beforeFp), "huellas idénticas tras aplicar");
  const objApplied = await objects(db);
  let reapplyError = null;
  try { for (const f of [M1, M2]) await db.exec(fs.readFileSync(path.join(MIG, f), "utf8")); } catch (e) { reapplyError = e.message; }
  ok(reapplyError === null, "reaplicar ambas no falla (idempotente)" + (reapplyError ? ": " + reapplyError : ""));
  ok(JSON.stringify(await objects(db)) === JSON.stringify(objApplied), "reaplicar no cambia nada");
  ok(JSON.stringify(await fingerprint(db)) === JSON.stringify(beforeFp), "huellas idénticas tras reaplicar");

  console.log("\n[3] Compatibilidad hacia atrás: lo que usa el web ANTERIOR sigue igual");
  const legacy = [
    ["students", "select name from public.students where owner_id = $1 order by name limit 5"],
    ["payment_charges", "select count(*) from public.payment_charges where owner_id = $1"],
    ["rpc ensure_monthly_charges (existente)", "select proname from pg_proc where proname = 'ensure_monthly_charges'"],
  ];
  for (const [label, sql] of legacy) {
    let fail = null;
    try { await db.query(sql, sql.includes("$1") ? [A] : []); } catch (e) { fail = e.message; }
    ok(fail === null, `consulta del web anterior sigue funcionando: ${label}`);
  }

  console.log(bad === 0 ? "\nENSAYO OK" : `\nENSAYO CON ${bad} FALLA(S)`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
