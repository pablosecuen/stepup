// (Las comparaciones de cuerpos de funciones ignoran el retorno de carro: según el sistema donde se aplicó la migración, el cuerpo guardado trae CRLF o LF.)
// R6 — Ensayo de las migraciones sobre un Postgres REAL con el estado de Production ANTERIOR a R6 (todas las migraciones hasta R5), con datos sintéticos:
//   1) dentro de una transacción que se REVIERTE: sólo cambian las 4 RPC públicas y aparecen las funciones nuevas; los datos, el resto de las funciones,
//      los privilegios, los disparadores, las políticas y los índices quedan idénticos; al revertir, todo vuelve a la huella inicial;
//   2) confirmadas: son idempotentes (aplicarlas dos veces no cambia nada) y son compatibles con lo que ya existía (una vista previa PENDIENTE y una
//      importación ya aplicada creadas con el código anterior se confirman / deshacen con el código nuevo);
//   3) el script de rollback devuelve las 4 RPC a su cuerpo anterior EXACTO.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   node supabase/tests/postgres/r6_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { generateBackup, emptyBackup, student } = require("./r6_dataset.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R6 = fs.readdirSync(DIR).filter((f) => /^20261010\d{6}_r6_/.test(f)).sort();
const LAST_R5 = "20261009120000_r5_function_search_path.sql";
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r6_import_rollback.sql"), "utf8");
const PUBLIC_RPC = ["preview_backup_import", "apply_backup_import", "preview_undo_backup_import", "apply_undo_backup_import"];
const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000b2";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function inventory(q) {
  const one = async (sql) => (await q(sql)).rows;
  const tables = await one(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const data = {};
  for (const { table_name: t } of tables) {
    data[t] = (await one(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h from public.${t} x`))[0];
  }
  const funcs = Object.fromEntries((await one(`
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
           md5(replace(pg_get_functiondef(p.oid), chr(13), '') || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || p.prosecdef::text) as h
      from pg_proc p where p.pronamespace = 'public'::regnamespace`)).map((r) => [r.sig, r.h]));
  const meta = {
    triggers: (await one(`select md5(string_agg(tgrelid::regclass::text || tgname || tgenabled::text, '|' order by tgrelid::regclass::text, tgname)) h, count(*)::int n from pg_trigger where not tgisinternal`))[0],
    policies: (await one(`select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) h, count(*)::int n from pg_policies where schemaname = 'public'`))[0],
    indexes: (await one(`select md5(string_agg(indexdef, '|' order by indexname)) h, count(*)::int n from pg_indexes where schemaname = 'public'`))[0],
    tableAcl: (await one(`select md5(string_agg(c.relname || coalesce(c.relacl::text, ''), '|' order by c.relname)) h from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`))[0],
  };
  return { data, funcs, meta };
}
const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

async function main() {
  const pg = await start({ port: 5631, upTo: LAST_R5 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  check("hay 4 migraciones R6 y la base de partida es la de Production anterior a R6 (hasta R5)", R6.length === 4 && fs.readdirSync(DIR).filter((f) => f <= LAST_R5).length === 48, `${R6.length} / ${fs.readdirSync(DIR).filter((f) => f <= LAST_R5).length}`);

  // --- Datos sintéticos con el código ANTERIOR: dos cuentas, una importación aplicada (B) y una vista previa pendiente (A) ---
  for (const id of [A, B]) await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.invalid`]);
  const sA = await pg.session(A); const sB = await pg.session(B);
  const bk = (prefix, n) => generateBackup(n, { prefix, levelHistory: false, selfLinks: false });
  const pB = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("viejaB", 120))])).rows[0];
  const aB = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  const pendingBackup = bk("pendA", 150);
  const pA = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(pendingBackup)])).rows[0];
  const baseline = await inventory((s) => admin.query(s));
  check("el estado de partida tiene datos (alumnos, importación aplicada y vista previa pendiente)", baseline.data.students.n > 0 && baseline.data.import_runs.n === 1 && baseline.data.import_previews.n === 2);

  // --- 1) Ensayo en transacción que se revierte ---
  await admin.query("begin");
  for (const f of R6) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const inside = await inventory((s) => admin.query(s));
  const changedFuncs = diffKeys(baseline.funcs, inside.funcs);
  const newFuncs = changedFuncs.filter((k) => !(k in baseline.funcs));
  const modified = changedFuncs.filter((k) => k in baseline.funcs);
  check("ensayo: los DATOS quedan idénticos (todas las tablas: conteo y huella)", diffKeys(baseline.data, inside.data).length === 0, diffKeys(baseline.data, inside.data).join(","));
  check("ensayo: sólo las 4 RPC públicas cambian de cuerpo (el resto de las funciones existentes queda idéntico)", JSON.stringify(modified.map((k) => k.split("(")[0]).sort()) === JSON.stringify([...PUBLIC_RPC].sort()), modified.join(","));
  check("ensayo: aparecen funciones nuevas _import_* (todas internas)", newFuncs.length >= 25 && newFuncs.every((k) => k.startsWith("_import_")), String(newFuncs.length));
  check("ensayo: disparadores, políticas, índices y privilegios de tablas idénticos", JSON.stringify(baseline.meta) === JSON.stringify(inside.meta));
  const acl = (await admin.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname = any($1) or p.proname like '\\_import\\_%')`, [PUBLIC_RPC])).rows;
  check("ensayo: las RPC públicas siguen siendo ejecutables sólo por authenticated; las _import_* por nadie de la API", acl.filter((r) => PUBLIC_RPC.includes(r.proname)).every((r) => r.u && !r.a) && acl.filter((r) => r.proname.startsWith("_import_")).every((r) => !r.u && !r.a));
  await admin.query("rollback");
  const reverted = await inventory((s) => admin.query(s));
  check("ensayo REVERTIDO: la base vuelve EXACTAMENTE a la huella inicial (datos, funciones, disparadores, políticas, índices, privilegios)", JSON.stringify(reverted) === JSON.stringify(baseline));

  // --- 2) Confirmadas: idempotentes y compatibles ---
  for (const f of R6) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const once = await inventory((s) => admin.query(s));
  for (const f of R6) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const twice = await inventory((s) => admin.query(s));
  check("aplicadas dos veces: nada cambia (idempotentes)", JSON.stringify(once) === JSON.stringify(twice));
  check("aplicadas: los datos siguen idénticos a la huella inicial", diffKeys(baseline.data, once.data).length === 0);

  // La vista previa PENDIENTE creada con el código anterior se confirma con el código nuevo (la web desplegada puede tener una abierta en el momento del cambio).
  const aA = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pA.preview_id])).rows[0];
  check("compatibilidad: una vista previa pendiente creada ANTES de R6 se confirma con la aplicación nueva y escribe todo", aA.summary.replayed === false && aA.summary.counts_by_table.students === pendingBackup.students.length, JSON.stringify(aA.summary.counts_by_table));
  const uB = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aB.import_run_id])).rows[0];
  check("compatibilidad: una importación aplicada ANTES de R6 se puede deshacer con el deshacer nuevo", uB.is_safe === true, JSON.stringify(uB.unsafe_rows).slice(0, 200));
  const rB = (await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uB.undo_preview_id])).rows[0];
  check("compatibilidad: y lo deshecho es lo que se había agregado", rB.summary.deleted_rows === aB.summary.total_rows_written && (await admin.query(`select count(*)::int n from public.students where owner_id = $1`, [B])).rows[0].n === 0);
  // Los reintentos de lo creado antes también repiten su resultado.
  const again = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  check("compatibilidad: reconfirmar la vista previa anterior a R6 repite el resultado original", again.summary.replayed === true && again.import_run_id === aB.import_run_id);

  // --- 3) Rollback manual ---
  await admin.query(ROLLBACK);
  const rolled = await inventory((s) => admin.query(s));
  const back = PUBLIC_RPC.every((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).every(([k, h]) => rolled.funcs[k] === h));
  check("rollback: las 4 RPC vuelven a su cuerpo, privilegios y configuración ANTERIORES exactos", back);
  const stillDiff = Object.entries(baseline.funcs).filter(([k, h]) => rolled.funcs[k] !== h).map(([k]) => k);
  check("rollback: el resto de las funciones anteriores sigue idéntico y las _import_* quedan sin uso", stillDiff.length === 0 && Object.keys(rolled.funcs).some((k) => k.startsWith("_import_")), stillDiff.join(","));
  const pC = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify((() => { const x = emptyBackup(); x.students = [student("rb1")]; return x; })())])).rows[0];
  const aC = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pC.preview_id])).rows[0];
  check("rollback: con las RPC anteriores una importación sencilla sigue funcionando", aC.summary.total_rows_written === 1);

  await sA.end(); await sB.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
