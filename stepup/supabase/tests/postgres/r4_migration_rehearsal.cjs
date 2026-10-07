// R4 — Ensayo único de las tres migraciones de retención sobre el esquema REAL (Postgres real) con datos sembrados (incluidas
// importaciones vencidas y vigentes): BEGIN; aplicar; comparar huellas de TODAS las tablas de datos; ROLLBACK; comparar; aplicar de verdad;
// reaplicar (idempotencia); uso normal del web anterior; y rollback manual.
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/r4_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const MIG = path.join(__dirname, "..", "..", "migrations");
const FILES = ["20261008100000_r4_import_retention.sql", "20261008110000_r4_reauth_quota.sql", "20261008120000_r4_schedule_import_purge.sql"];
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
let bad = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FALLA ") + m); if (!c) bad += 1; };

/** La columna nueva `payload_purged_at` de import_previews es lo único que cambia la forma de una fila existente: se compara sin ella. */
/** `action_quota_defaults` es configuración que la propia R4 amplía (una fila nueva): se verifica aparte (conteo = 5). */
async function fingerprint(db) {
  const out = {};
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename).filter((t) => t !== "action_quota_defaults");
  for (const t of tables) {
    const r = await db.query(`select count(*)::int c, coalesce(md5(string_agg((to_jsonb(x) - 'payload_purged_at')::text, '|' order by (to_jsonb(x) - 'payload_purged_at')::text)), '') h from public."${t}" x`);
    out[t] = r.rows[0].c + ":" + r.rows[0].h;
  }
  return out;
}
async function objects(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => Object.values(r)[0]);
  return {
    tables: await q("select tablename from pg_tables where schemaname = 'public' order by 1"),
    cols: await q("select table_name || '.' || column_name from information_schema.columns where table_schema = 'public' order by 1"),
    fn: await q("select proname || '(' || pg_get_function_identity_arguments(oid) || ')' from pg_proc where pronamespace = 'public'::regnamespace order by 1"),
    idx: await q("select indexname from pg_indexes where schemaname = 'public' order by 1"),
    cons: await q("select conname from pg_constraint where connamespace = 'public'::regnamespace order by 1"),
    trg: await q("select c.relname || ':' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1"),
    pol: await q("select tablename || '.' || policyname from pg_policies where schemaname = 'public' order by 1"),
    grants: await q("select grantee || ':' || table_name || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1"),
    defaults: await q("select quota_key || '=' || coalesce(max_total::text, '-') from public.quota_defaults order by 1"),
  };
}
const diff = (a, b) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

(async () => {
  const pg = await start({ port: 5447, upTo: "20261007110000_r3_quota_triggers.sql" }); // todo lo anterior a R4
  const db = pg.admin;
  await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
  for (const [owner, tag] of [[A, "a"], [B, "b"]]) {
    await db.query(`insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
      select md5($2 || 'st' || s)::uuid, $1::uuid, 'Alumno ' || s, 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}' from generate_series(1, 30) s`, [owner, tag]);
    // importaciones: una vencida hace mucho (se purgaría), otra vigente, un preview pendiente reciente y un preview de deshacer viejo
    const old = (await db.query(`insert into public.import_previews (owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status, created_at, expires_at)
      values ($1, 'old', 1, '{"students":[{"name":"Dato"}]}', '{"x":1}', '[]', 'applied', now() - interval '40 days', now() - interval '40 days' + interval '30 minutes') returning id`, [owner])).rows[0].id;
    const live = (await db.query(`insert into public.import_previews (owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status, created_at, expires_at)
      values ($1, 'live', 1, '{"students":[{"name":"Dato"}]}', '{"x":1}', '[]', 'applied', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes') returning id`, [owner])).rows[0].id;
    await db.query(`insert into public.import_previews (owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status, expires_at)
      values ($1, 'pend', 1, '{}', '{}', '[]', 'pending', now() + interval '20 minutes')`, [owner]);
    for (const [pid, undo] of [[old, "now() - interval '10 days'"], [live, "now() + interval '28 days'"]]) {
      const run = (await db.query(`insert into public.import_runs (owner_id, preview_id, backup_checksum, schema_version, summary, field_overrides, duplicate_decisions, retained_payload, undo_expires_at, created_at)
        values ($1, $2, 'chk', 1, '{"total_rows_written":2}', '[]', '[]', '{"students":[{"name":"Dato"}]}', ${undo}, now() - interval '31 days') returning id`, [owner, pid])).rows[0].id;
      await db.query(`insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, new_row) values ($1, 'students', gen_random_uuid(), 'inserted', '{"name":"Dato"}'), ($1, 'students', gen_random_uuid(), 'inserted', '{"name":"Dato"}')`, [run]);
    }
  }
  const beforeFp = await fingerprint(db);
  const beforeObj = await objects(db);
  console.log(`esquema real (migraciones previas a R4): ${Object.keys(beforeFp).length} tablas, ${Object.values(beforeFp).reduce((s, v) => s + Number(v.split(":")[0]), 0)} filas (con importaciones vencidas y vigentes)`);

  console.log("\n[1] BEGIN … aplicar las tres … comparar huellas … ROLLBACK");
  await db.query("begin");
  for (const f of FILES) await db.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  const midFp = await fingerprint(db);
  ok(JSON.stringify(midFp) === JSON.stringify(beforeFp), "huellas de TODAS las tablas de datos idénticas dentro de la transacción (ninguna fila cambió; sólo existe la columna nueva, nula)");
  const midObj = await objects(db);
  const d = {};
  for (const k of Object.keys(beforeObj)) d[k] = diff(beforeObj[k], midObj[k]);
  ok(Object.keys(d).every((k) => d[k].removed.length === 0), "no se eliminó ninguna tabla, columna, función, índice, constraint, disparador, política ni privilegio");
  ok(d.tables.added.length === 0, "ninguna tabla nueva");
  ok(d.cols.added.join() === "import_previews.payload_purged_at", `una sola columna nueva: ${d.cols.added.join()}`);
  ok(d.fn.added.join() === "purge_expired_import_data(p_batch_size integer)", `una sola función nueva: ${d.fn.added.join()}`);
  ok(d.idx.added.length === 0 && d.cons.added.length === 0 && d.trg.added.length === 0 && d.pol.added.length === 0 && d.grants.added.length === 0, "sin índices, constraints, disparadores, políticas ni privilegios nuevos (RLS general intacta)");
  ok(d.defaults.added.length === 0 && d.defaults.removed.length === 0, "los límites de cuota de R3 no cambian");
  ok((await db.query("select count(*)::int c from public.action_quota_defaults")).rows[0].c === 5, "5 acciones por defecto (4 de R3 + account_reauth)");
  await db.query("rollback");
  ok(JSON.stringify(await fingerprint(db)) === JSON.stringify(beforeFp), "tras ROLLBACK: huellas idénticas");
  ok(JSON.stringify(await objects(db)) === JSON.stringify(beforeObj), "tras ROLLBACK: el esquema es idéntico (nada quedó)");

  console.log("\n[2] Aplicar de verdad y reaplicar (idempotencia)");
  for (const f of FILES) await db.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  const applied = await objects(db);
  let err = null;
  try { for (const f of FILES) await db.query(fs.readFileSync(path.join(MIG, f), "utf8")); } catch (e) { err = e.message; }
  ok(err === null, "reaplicar las tres no falla" + (err ? ": " + err : ""));
  ok(JSON.stringify(await objects(db)) === JSON.stringify(applied), "reaplicar no cambia nada");
  ok((await db.query("select count(*)::int c from public.action_quota_defaults")).rows[0].c === 5, "5 acciones por defecto (sin duplicar al reaplicar)");
  ok(JSON.stringify(await fingerprint(db)) === JSON.stringify(beforeFp), "huellas de los datos idénticas tras aplicar y reaplicar");
  ok((await db.query("select count(*)::int c from pg_namespace where nspname = 'cron'")).rows[0].c === 0, "base sin pg_cron: la programación se saltea sin error");

  console.log("\n[3] El web anterior a R4 sigue funcionando con las migraciones puestas");
  const s = await pg.session(A);
  const flows = [
    ["historial de importaciones (SELECT propio sobre import_runs, columnas que usa el web)", async () => {
      const r = await s.query("select id, status, backup_checksum, schema_version, app_version, summary, created_at, undo_expires_at, undone_at, payload_purged_at, snapshots_purged_at from public.import_runs");
      if (r.rowCount !== 2) throw new Error("filas " + r.rowCount);
    }],
    ["alta de alumno por RPC", () => s.query("select * from public.create_student_with_operation('11111111-1111-4111-8111-111111111111'::uuid, $1::jsonb, false)", [JSON.stringify({ name: "Zeta Nueva", modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [] })])],
    ["cuota por ventana (la acción de R3)", () => s.query("select public.consume_action_quota('report_pdf')")],
    ["cuota por ventana (la acción nueva de R4)", () => s.query("select public.consume_action_quota('account_reauth')")],
  ];
  for (const [label, run] of flows) {
    let e = null;
    try { await run(); } catch (x) { e = x.message; }
    ok(e === null, `${label}${e ? ": " + e : ""}`);
  }
  const denied = await s.query("select has_function_privilege('authenticated', 'public.purge_expired_import_data(integer)', 'execute') p").then((r) => r.rows[0].p);
  ok(denied === false, "la API no puede ejecutar la purga");
  await s.end();

  console.log("\n[4] La purga real sobre estos datos: sólo toca lo vencido de importaciones");
  const dataBefore = await fingerprint(db);
  const r = (await db.query("select public.purge_expired_import_data() r")).rows[0].r;
  ok(r.runs_purged === 2 && r.snapshots_deleted === 4 && r.previews_blanked === 4, `purgó las 2 corridas vencidas (1 por cuenta), sus 4 snapshots y vació los 4 previews aplicados (ya sin uso tras 24 h): ${JSON.stringify(r)}`);
  const live = (await db.query("select count(*)::int c from public.import_runs where retained_payload is not null")).rows[0].c;
  ok(live === 2, "las 2 corridas vigentes conservan su respaldo retenido");
  ok((await db.query("select count(*)::int c from public.import_run_row_snapshots")).rows[0].c === 4, "las 2 corridas vigentes conservan sus 4 snapshots");
  const dataAfter = await fingerprint(db);
  const changed = Object.keys(dataBefore).filter((t) => dataBefore[t] !== dataAfter[t]);
  ok(JSON.stringify(changed.sort()) === JSON.stringify(["import_previews", "import_run_row_snapshots", "import_runs"]), `sólo cambiaron las tablas de importación (${changed.join(", ")}); alumnos, cobros y el resto idénticos`);
  ok((await db.query("select public.purge_expired_import_data() r")).rows[0].r.runs_purged === 0, "segunda pasada: nada que hacer");

  console.log("\n[5] Rollback manual (supabase/repairs/r4_retention_rollback.sql): deja el esquema como estaba antes de R4");
  await db.query(fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r4_retention_rollback.sql"), "utf8"));
  const rolled = await objects(db);
  ok(JSON.stringify(rolled) === JSON.stringify(beforeObj), "tras el rollback: tablas, columnas, funciones, índices, constraints, disparadores, políticas y privilegios idénticos a los de antes de R4");
  ok((await db.query("select count(*)::int c from public.students where owner_id = $1", [A])).rows[0].c === 31, "los datos de la aplicación siguen ahí");
  console.log(bad === 0 ? "\nENSAYO OK" : `\nENSAYO CON ${bad} FALLA(S)`);
  await pg.stop();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
