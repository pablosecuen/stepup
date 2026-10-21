// (Las comparaciones de cuerpos de funciones ignoran el retorno de carro: según el sistema donde se aplicó la migración, el cuerpo guardado trae CRLF o LF.)
// R9 (traslado desde la app móvil) — Ensayo de la migración sobre un Postgres REAL con el estado de Production ANTERIOR a R9 (todas las migraciones previas), con datos sintéticos:
//   1) dentro de una transacción que se REVIERTE: sólo cambian las 3 funciones previstas, aparecen 2 funciones internas, 1 tabla vacía, 1 política y 1 disparador;
//      los datos de todas las demás tablas quedan idénticos; al revertir, todo vuelve a la huella inicial;
//   2) confirmada: es idempotente y compatible con lo que ya existía (una vista previa PENDIENTE y una importación ya aplicada, creadas con el código anterior,
//      se confirman / deshacen con el código nuevo; la importación nueva guarda el archivo del origen y se puede deshacer sin perderlo);
//   3) el script de rollback devuelve las 3 funciones a su cuerpo anterior EXACTO y quita la tabla, el disparador y las funciones nuevas.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r9_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { generateBackup, emptyBackup, student } = require("./r6_dataset.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R9 = fs.readdirSync(DIR).filter((f) => /^20261019\d{6}_r9_/.test(f)).sort();
const BEFORE_R9 = fs.readdirSync(DIR).filter((f) => f < R9[0]).sort().pop();
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r9_transfer_rollback.sql"), "utf8");
const MODIFIED = ["_import_row_key", "apply_backup_import", "apply_undo_backup_import"];
const NEW = ["_import_archive_source", "_import_apply_histories"];
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
const names = (keys) => keys.map((k) => k.split("(")[0]).sort();

async function main() {
  const pg = await start({ port: 5651, upTo: BEFORE_R9 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  check("hay 1 migración R9 (la base de partida es la de Production anterior; lo único posterior es R10 a R14)", R9.length === 1 && fs.readdirSync(DIR).filter((f) => f > R9[0]).every((f) => /_r1[0-4]_/.test(f)), `${R9.length}`);

  // --- Datos sintéticos con el código anterior: dos cuentas, una importación aplicada (B) y una vista previa pendiente (A) ---
  for (const id of [A, B]) await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.invalid`]);
  const sA = await pg.session(A); const sB = await pg.session(B);
  const bk = (prefix, n) => generateBackup(n, { prefix, levelHistory: false, selfLinks: false });
  const pB = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("viejaB", 120))])).rows[0];
  const aB = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  const pA = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("pendA", 150))])).rows[0];
  const baseline = await inventory((s) => admin.query(s));
  check("el estado de partida tiene datos (alumnos, importación aplicada y vista previa pendiente) y NO existe el archivo del origen", baseline.data.students.n > 0 && baseline.data.import_runs.n === 1 && baseline.data.import_previews.n === 2 && !("import_source_archives" in baseline.data));

  // --- 1) Ensayo en transacción que se revierte ---
  await admin.query("begin");
  for (const f of R9) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const inside = await inventory((s) => admin.query(s));
  const changedFuncs = diffKeys(baseline.funcs, inside.funcs);
  const newFuncs = changedFuncs.filter((k) => !(k in baseline.funcs));
  const modified = changedFuncs.filter((k) => k in baseline.funcs);
  const dataDiff = diffKeys(baseline.data, inside.data);
  check("ensayo: los DATOS quedan idénticos; sólo aparece la tabla nueva, VACÍA", JSON.stringify(dataDiff) === JSON.stringify(["import_source_archives"]) && inside.data.import_source_archives.n === 0, dataDiff.join(","));
  check("ensayo: sólo cambian de cuerpo las 3 funciones previstas (el resto queda idéntico)", JSON.stringify(names(modified)) === JSON.stringify([...MODIFIED].sort()), modified.join(","));
  check("ensayo: aparecen exactamente 2 funciones internas nuevas", JSON.stringify(names(newFuncs)) === JSON.stringify([...NEW].sort()), newFuncs.join(","));
  check("ensayo: +1 disparador, +1 política (sólo lectura propia), índices y privilegios de las tablas existentes intactos", inside.meta.triggers.n === baseline.meta.triggers.n + 1 && inside.meta.policies.n === baseline.meta.policies.n + 1);
  const acl = (await admin.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname = any($1) or p.proname = any($2))`, [PUBLIC_RPC, ["_import_archive_source", "_import_apply_histories", "_import_row_key"]])).rows;
  check("ensayo: las RPC públicas siguen siendo ejecutables sólo por authenticated; las internas nuevas por nadie de la API", acl.filter((r) => PUBLIC_RPC.includes(r.proname)).every((r) => r.u && !r.a) && acl.filter((r) => !PUBLIC_RPC.includes(r.proname) && r.proname !== "_import_row_key").every((r) => !r.u && !r.a), JSON.stringify(acl.filter((r) => r.u || r.a).map((r) => r.proname)));
  const grants = (await admin.query(`select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'import_source_archives' and grantee in ('anon', 'authenticated')`)).rows;
  check("ensayo: la tabla del archivo da a authenticated sólo lectura (RLS) y nada a anon: ninguna escritura desde la API", grants.every((g) => g.grantee === "authenticated" && g.privilege_type === "SELECT"), JSON.stringify(grants));
  await admin.query("rollback");
  const reverted = await inventory((s) => admin.query(s));
  check("ensayo REVERTIDO: la base vuelve EXACTAMENTE a la huella inicial (datos, funciones, disparadores, políticas, índices, privilegios)", JSON.stringify(reverted) === JSON.stringify(baseline));

  // --- 2) Confirmada: idempotente y compatible ---
  for (const f of R9) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const once = await inventory((s) => admin.query(s));
  for (const f of R9) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const twice = await inventory((s) => admin.query(s));
  check("aplicada dos veces: nada cambia (idempotente)", JSON.stringify(once) === JSON.stringify(twice));

  const aA = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pA.preview_id])).rows[0];
  check("compatibilidad: una vista previa pendiente creada ANTES de R9 se confirma con la aplicación nueva y escribe todo", aA.summary.replayed === false && aA.summary.counts_by_table.students > 0, JSON.stringify(aA.summary.counts_by_table).slice(0, 160));
  const archivesA = (await admin.query(`select count(*)::int n from public.import_source_archives where owner_id = $1`, [A])).rows[0].n;
  check("la importación confirmada DESPUÉS de R9 guarda el archivo del origen (una copia)", archivesA === 1);
  const uB = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aB.import_run_id])).rows[0];
  check("compatibilidad: una importación aplicada ANTES de R9 se puede deshacer con el deshacer nuevo", uB.is_safe === true, JSON.stringify(uB.unsafe_rows).slice(0, 200));
  const rB = (await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uB.undo_preview_id])).rows[0];
  check("compatibilidad: y lo deshecho es lo que se había agregado", rB.summary.deleted_rows === aB.summary.total_rows_written && (await admin.query(`select count(*)::int n from public.students where owner_id = $1`, [B])).rows[0].n === 0);
  const again = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  check("compatibilidad: reconfirmar la vista previa anterior repite el resultado original (y no crea otro archivo)", again.summary.replayed === true && again.import_run_id === aB.import_run_id && (await admin.query(`select count(*)::int n from public.import_source_archives where owner_id = $1`, [B])).rows[0].n === 0);

  // Historiales y correcciones mensuales: llegan sólo en importaciones nuevas, con alumnos nuevos, y se deshacen.
  const hist = emptyBackup();
  hist.students = [student("rh_st1")];
  hist.profiles = { rh_st1: { id: "rh_st1", statusHistory: [{ status: "activo", date: "2026-03-02", reason: "alta" }], priceHistory: [{ price: 1000, date: "2026-03-02" }, { price: 1200, date: "2026-08-01" }], levelHistory: [] } };
  hist.monthlyAmountCorrections = [{ id: "rh_mc", studentId: "rh_st1", billingPeriod: "2026-09", previousAmount: 1200, newAmount: 999, changedAt: "2026-09-01T00:00:00.000Z", reason: "ajuste", effectiveFrom: "this_month" }];
  const pH = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(hist)])).rows[0];
  const aH = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pH.preview_id])).rows[0];
  const counts = (await admin.query(`select (select count(*)::int from public.student_status_history where owner_id = $1) s, (select count(*)::int from public.student_price_history where owner_id = $1) p, (select count(*)::int from public.monthly_amount_corrections where owner_id = $1) m`, [B])).rows[0];
  check("una importación nueva trae los historiales de estado y precio y las correcciones mensuales", counts.s === 1 && counts.p === 2 && counts.m === 1, JSON.stringify(counts));
  const aH2 = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pH.preview_id])).rows[0];
  check("reconfirmar no los duplica", aH2.summary.replayed === true && (await admin.query(`select count(*)::int n from public.student_status_history where owner_id = $1`, [B])).rows[0].n === 1);
  const uH = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aH.import_run_id])).rows[0];
  await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uH.undo_preview_id]);
  const left = (await admin.query(`select (select count(*)::int from public.students where owner_id = $1) a, (select count(*)::int from public.student_status_history where owner_id = $1) b, (select count(*)::int from public.student_price_history where owner_id = $1) c, (select count(*)::int from public.monthly_amount_corrections where owner_id = $1) d, (select count(*)::int from public.import_source_archives where owner_id = $1) e`, [B])).rows[0];
  check("deshacer deja la cuenta como estaba (sin historiales ni correcciones) y CONSERVA el archivo del origen", left.a === 0 && left.b === 0 && left.c === 0 && left.d === 0 && left.e === 1, JSON.stringify(left));
  const isolation = (await sA.query(`select count(*)::int n from public.import_source_archives`)).rows[0].n;
  check("aislamiento: una cuenta sólo ve sus archivos del origen (RLS)", isolation === 1);
  let writeBlocked = false;
  try { await sA.query(`delete from public.import_source_archives`); const n = (await admin.query(`select count(*)::int n from public.import_source_archives where owner_id = $1`, [A])).rows[0].n; writeBlocked = n === 1; } catch { writeBlocked = true; }
  check("la API no puede borrar ni modificar el archivo del origen", writeBlocked);

  // --- 3) Rollback manual ---
  await admin.query(ROLLBACK);
  const rolled = await inventory((s) => admin.query(s));
  const back = MODIFIED.every((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).every(([k, h]) => rolled.funcs[k] === h));
  check("rollback: las 3 funciones vuelven a su cuerpo, privilegios y configuración ANTERIORES exactos", back, MODIFIED.filter((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).some(([k, h]) => rolled.funcs[k] !== h)).join(","));
  const stillDiff = Object.entries(baseline.funcs).filter(([k, h]) => rolled.funcs[k] !== h).map(([k]) => k);
  check("rollback: TODAS las funciones anteriores quedan idénticas a la huella inicial", stillDiff.length === 0, stillDiff.join(","));
  check("rollback: la tabla, el disparador y las funciones nuevas ya no existen", !("import_source_archives" in rolled.data) && NEW.every((n) => !Object.keys(rolled.funcs).some((k) => k.startsWith(n + "("))) && rolled.meta.triggers.h === baseline.meta.triggers.h && rolled.meta.policies.h === baseline.meta.policies.h);
  const pD = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify((() => { const x = emptyBackup(); x.students = [student("rb1")]; return x; })())])).rows[0];
  const aD = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pD.preview_id])).rows[0];
  check("rollback: con las funciones anteriores una importación sencilla sigue funcionando", aD.summary.total_rows_written === 1);

  await sA.end(); await sB.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
