// R11 — Cierre del traslado: conservar el origen y congelarlo sin borrar nada. Postgres REAL aislado, datos SINTÉTICOS.
//   1) la migración (BEGIN…ROLLBACK idéntico a la huella inicial, idempotente, rollback exacto);
//   2) la retención que borraba respaldos antiguos queda resuelta: la copia permanente conserva TODOS (aunque `upload_cloud_backup` rote los 10 más nuevos) y ni un trabajo ni la
//      API pueden borrarla ni cambiarla; el trabajo de R4 no toca el origen (ni `import_source_archives` ni la copia permanente);
//   3) el cierre exige el último respaldo, el cotejo COMPLETO y la confirmación; congelada, la app anterior NO puede guardar respaldos (no se pisa ni rota nada) y NO se puede importar;
//      la autenticación, el dispositivo activo y las escrituras de la web siguen funcionando; reabrir permite incorporar un faltante.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r11_freeze_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");
const { generateBackup } = require("./r6_dataset.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R11 = fs.readdirSync(DIR).filter((f) => /^20261019\d{6}_r11_/.test(f)).sort();
const BEFORE = fs.readdirSync(DIR).filter((f) => f < R11[0]).sort().pop();
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r11_freeze_rollback.sql"), "utf8");
const A = H.A;
const B = "00000000-0000-4000-8000-0000000000b2";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

async function inventory(admin) {
  const one = async (sql) => (await admin.query(sql)).rows;
  const tables = await one("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
  const data = {};
  for (const { table_name: t } of tables) data[t] = (await one(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h from public.${t} x`))[0];
  const funcs = Object.fromEntries((await one("select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, md5(replace(pg_get_functiondef(p.oid), chr(13), '') || coalesce(p.proacl::text, '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace")).map((r) => [r.sig, r.h]));
  const triggers = (await one("select md5(string_agg(tgrelid::regclass::text || tgname, '|' order by tgrelid::regclass::text, tgname)) h, count(*)::int n from pg_trigger where not tgisinternal"))[0];
  return { data, funcs, triggers };
}

async function main() {
  const pg = await start({ port: 5701, upTo: BEFORE });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const { admin } = pg;
  await H.reset(admin);
  await admin.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [B, `${B}@example.invalid`]);
  check("hay 1 migración R11 (lo único posterior es R12, R13 y R14)", R11.length === 1 && fs.readdirSync(DIR).filter((f) => f > R11[0]).every((f) => /_r1[234]_/.test(f)));

  // Estado de partida: la cuenta A usa la app anterior (dispositivo activo + respaldos en la nube) y ya importó a la web.
  const sA = await H.apiSession(pg, A, 60000);
  await sA.query("select * from public.transfer_active_session('dispositivo-viejo-1')");
  const gen = (await admin.query("select generation from public.active_sessions where user_id = $1", [A])).rows[0].generation;
  const upload = async (label) => (await sA.query("select * from public.upload_cloud_backup('dispositivo-viejo-1', $1, 2, '1.0.0', $2::jsonb)", [gen, JSON.stringify({ schemaVersion: 2, label })])).rows[0];
  for (let i = 1; i <= 10; i += 1) await upload(`respaldo-${i}`);
  const backup = generateBackup(30, { prefix: "cl", levelHistory: false, selfLinks: false });
  const preview = (await sA.query("select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)", [JSON.stringify(backup)])).rows[0];
  const applied = (await sA.query("select * from public.apply_backup_import($1::uuid, '[]', '[]')", [preview.preview_id])).rows[0];
  const baseline = await inventory(admin);

  // --- 1) La migración ---
  await admin.query("begin");
  await admin.query(fs.readFileSync(path.join(DIR, R11[0]), "utf8"));
  const inside = await inventory(admin);
  const changed = Object.keys({ ...baseline.funcs, ...inside.funcs }).filter((k) => baseline.funcs[k] !== inside.funcs[k]);
  check("ensayo: sólo aparecen funciones nuevas (ninguna existente cambia) y 3 disparadores; los datos existentes quedan idénticos", changed.every((k) => !(k in baseline.funcs)) && inside.triggers.n === baseline.triggers.n + 3 && Object.keys(baseline.data).every((t) => JSON.stringify(baseline.data[t]) === JSON.stringify(inside.data[t])), changed.filter((k) => k in baseline.funcs).join(","));
  await admin.query("rollback");
  check("ensayo REVERTIDO: la base vuelve exactamente a la huella inicial", JSON.stringify(await inventory(admin)) === JSON.stringify(baseline));
  await admin.query(fs.readFileSync(path.join(DIR, R11[0]), "utf8"));
  const once = await inventory(admin);
  await admin.query(fs.readFileSync(path.join(DIR, R11[0]), "utf8"));
  check("aplicada dos veces: nada cambia (idempotente)", JSON.stringify(once) === JSON.stringify(await inventory(admin)));
  const grants = (await admin.query("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('legacy_cloud_backup_archive', 'account_transfer_state') and grantee in ('anon', 'authenticated', 'service_role')")).rows;
  check("las tablas nuevas: lectura propia para authenticated; NINGÚN rol de la API puede insertar, modificar ni borrar", grants.every((g) => g.grantee === "authenticated" && g.privilege_type === "SELECT") && grants.length === 2, JSON.stringify(grants));

  // --- 2) Retención ---
  check("retención (a): hoy la app anterior conserva sólo 10 respaldos en la nube", (await admin.query("select count(*)::int n from public.cloud_backups where user_id = $1", [A])).rows[0].n === 10);
  const arch1 = (await sA.query("select public.archive_legacy_cloud_backups() r")).rows[0].r;
  check("la copia permanente guarda los 10 respaldos actuales; repetirlo no duplica", arch1.archived_now === 10 && arch1.archived_total === 10 && (await sA.query("select public.archive_legacy_cloud_backups() r")).rows[0].r.archived_now === 0);
  for (let i = 11; i <= 13; i += 1) await upload(`respaldo-${i}`);
  const cloudNow = (await admin.query("select count(*)::int n, count(*) filter (where payload ->> 'label' in ('respaldo-1','respaldo-2','respaldo-3'))::int old from public.cloud_backups where user_id = $1", [A])).rows[0];
  check("la rotación de la app anterior SÍ borra los más viejos de la nube (sigue 10; respaldo-1..3 ya no están)…", cloudNow.n === 10 && cloudNow.old === 0);
  const arch2 = (await sA.query("select public.archive_legacy_cloud_backups() r")).rows[0].r;
  const labels = (await admin.query("select array_agg(payload ->> 'label' order by payload ->> 'label') l from public.legacy_cloud_backup_archive where owner_id = $1", [A])).rows[0].l;
  check("…pero la copia permanente conserva los 13: nada se perdió", arch2.archived_now === 3 && arch2.archived_total === 13 && labels.includes("respaldo-1") && labels.includes("respaldo-13"));
  const apiMods = [];
  for (const sql of ["update public.legacy_cloud_backup_archive set payload = '{}'::jsonb", "delete from public.legacy_cloud_backup_archive", "insert into public.legacy_cloud_backup_archive (owner_id, schema_version, checksum, payload) values (auth.uid(), 1, 'x', '{}'::jsonb)", "update public.account_transfer_state set status = 'frozen'"]) apiMods.push(await fails(() => sA.query(sql)));
  const svc = await H.apiSession(pg, A, 8000);
  await svc.query("set role service_role");
  const svcFail = await fails(() => svc.query("delete from public.legacy_cloud_backup_archive"));
  await svc.end();
  check("ni la cuenta (API) ni el rol de servicio pueden borrar, cambiar ni agregar filas de la copia permanente", apiMods.every((m) => m !== null) && svcFail !== null, JSON.stringify(apiMods.map((m) => m && m.slice(0, 40))));
  // retención (b): el trabajo por hora de R4 con todo vencido.
  await admin.query("update public.import_runs set undo_expires_at = now() - interval '5 days' where owner_id = $1", [A]);
  await admin.query("update public.import_previews set expires_at = now() - interval '5 days' where owner_id = $1", [A]);
  const purge = (await admin.query("select public.purge_expired_import_data(500) r")).rows[0].r;
  const afterPurge = (await admin.query("select (select count(*)::int from public.import_source_archives where owner_id = $1) a, (select count(*)::int from public.legacy_cloud_backup_archive where owner_id = $1) b, (select count(*)::int from public.cloud_backups where user_id = $1) c, (select (retained_payload is null) from public.import_runs where owner_id = $1 limit 1) p", [A])).rows[0];
  check("retención (b): el trabajo de R4 vacía el respaldo retenido de la importación pero NO toca el archivo del origen, la copia permanente ni la nube", afterPurge.p === true && afterPurge.a === 1 && afterPurge.b === 13 && afterPurge.c === 10, JSON.stringify({ purge, afterPurge }));

  // --- 3) Cierre y congelamiento ---
  const latest = (await admin.query("select checksum from public.cloud_backups where user_id = $1 order by created_at desc limit 1", [A])).rows[0].checksum;
  const audit = { verdict: "COMPLETO", user_confirmed: "true", origin_sha256: "a".repeat(64), destination_sha256: "b".repeat(64), counts: { entities: 32 } };
  const f = (checksum, a) => sA.query("select public.freeze_legacy_source($1, $2::jsonb) r", [checksum, JSON.stringify(a)]);
  check("cerrar SIN el cotejo COMPLETO o sin la confirmación de la usuaria: se rechaza", (await fails(() => f(latest, { ...audit, verdict: "NO COMPLETO" }))) !== null && (await fails(() => f(latest, { ...audit, user_confirmed: "false" }))) !== null && (await fails(() => f(latest, {}))) !== null);
  check("cerrar con una huella que no es la del último respaldo: se rechaza (hay algo más nuevo cargado en la app anterior)", /más nuevo/.test((await fails(() => f("0".repeat(64), audit))) ?? ""));
  await upload("respaldo-14-cargado-despues");
  check("si se cargó algo en la app anterior DESPUÉS de la copia (respaldo nuevo), el cierre con la huella vieja se rechaza", /más nuevo/.test((await fails(() => f(latest, audit))) ?? ""));
  const latest2 = (await admin.query("select checksum from public.cloud_backups where user_id = $1 order by created_at desc limit 1", [A])).rows[0].checksum;
  const noImport = await H.apiSession(pg, B, 8000);
  check("sin importación aplicada no hay nada que cerrar", (await fails(() => noImport.query("select public.freeze_legacy_source($1, $2::jsonb)", ["f".repeat(64), JSON.stringify(audit)]))) !== null);
  await noImport.end();
  const frozen = (await f(latest2, audit)).rows[0].r;
  check("cierre correcto: la cuenta queda congelada y la copia permanente ya incluye el último respaldo", frozen.status === "frozen" && frozen.archive.archived_total === 14 && (await sA.query("select public.get_transfer_state() s")).rows[0].s.status === "frozen");

  const cloudBefore = (await admin.query("select md5(string_agg(checksum, '|' order by checksum)) h, count(*)::int n from public.cloud_backups where user_id = $1", [A])).rows[0];
  const upMsg = await fails(() => upload("respaldo-15-despues-del-cierre"));
  const cloudAfter = (await admin.query("select md5(string_agg(checksum, '|' order by checksum)) h, count(*)::int n from public.cloud_backups where user_id = $1", [A])).rows[0];
  check("congelada: la app anterior NO puede guardar respaldos (no pisa ni rota nada): la nube queda EXACTAMENTE igual", /ya se trasladó a la web/.test(upMsg ?? "") && cloudBefore.h === cloudAfter.h && cloudAfter.n === 10);
  check("congelada: NO se puede importar otra copia (ni vista previa ni aplicación)", /ya se cerró/.test((await fails(() => sA.query("select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)", [JSON.stringify(generateBackup(5, { prefix: "zz", levelHistory: false, selfLinks: false })) ]))) ?? ""));
  const studentsBefore = (await admin.query("select count(*)::int n from public.students where owner_id = $1", [A])).rows[0].n;
  const touch = (await sA.query("select * from public.touch_active_session('dispositivo-viejo-1')")).rows[0];
  const authKept = (await admin.query("select count(*)::int n from auth.users where id = $1", [A])).rows[0].n;
  const webWrite = await sA.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel cargado en la web') returning id");
  check("congelada: la autenticación, el dispositivo activo y las escrituras de la web NO se afectan", touch.is_current_device === true && authKept === 1 && webWrite.rows.length === 1 && (await admin.query("select count(*)::int n from public.students where owner_id = $1", [A])).rows[0].n === studentsBefore);
  const sB = await H.apiSession(pg, B, 60000);
  const prevB = (await sB.query("select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)", [JSON.stringify(generateBackup(5, { prefix: "bb", levelHistory: false, selfLinks: false }))])).rows[0];
  check("el congelamiento es POR CUENTA: otra cuenta puede importar con normalidad", Boolean(prevB.preview_id));
  await sB.end();

  // Reapertura para incorporar un faltante; el estado y la copia permanente quedan registrados.
  check("reabrir exige un motivo", (await fails(() => sA.query("select public.reopen_legacy_source('')"))) !== null);
  await sA.query("select public.reopen_legacy_source('incorporar clases cargadas después de la copia')");
  const prevAfter = (await sA.query("select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)", [JSON.stringify(generateBackup(5, { prefix: "re", levelHistory: false, selfLinks: false }))])).rows[0];
  const audits = (await admin.query("select jsonb_array_length(audit) n, audit -> 1 ->> 'action' a from public.account_transfer_state where owner_id = $1", [A])).rows[0];
  check("reabierta: se puede volver a importar y el historial de cierres y reaperturas queda registrado", Boolean(prevAfter.preview_id) && audits.n === 2 && audits.a === "reopen");
  void applied;

  // Eliminar la cuenta (decisión explícita de la usuaria) sigue funcionando y se lleva sus archivos: por eso existen las copias cifradas fuera de la base.
  const cDel = "00000000-0000-4000-8000-0000000000c3";
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [cDel, `${cDel}@example.invalid`]);
  const sD = await H.apiSession(pg, cDel, 60000);
  await sD.query("insert into public.cloud_backups (user_id, device_id, schema_version, checksum, payload) values ($1, 'dispositivo-viejo-9', 2, 'cc', '{}'::jsonb)", [cDel]).catch(() => {});
  await admin.query("insert into public.cloud_backups (user_id, device_id, schema_version, checksum, payload) values ($1, 'dispositivo-viejo-9', 2, 'cc', '{}'::jsonb)", [cDel]);
  await sD.query("select public.archive_legacy_cloud_backups()");
  await admin.query("insert into public.account_transfer_state (owner_id, status) values ($1, 'frozen')", [cDel]);
  const delErr = await fails(() => sD.query("select public.delete_own_account()"));
  const left = (await admin.query("select (select count(*)::int from public.legacy_cloud_backup_archive where owner_id = $1) + (select count(*)::int from public.account_transfer_state where owner_id = $1) n", [cDel])).rows[0].n;
  check("eliminar una cuenta congelada funciona (cascada limpia) — la copia permanente se va con ella, por eso las copias cifradas se conservan aparte", delErr === null && left === 0, String(delErr));
  await sD.end();

  // --- Rollback ---
  await admin.query(ROLLBACK);
  const rolled = await inventory(admin);
  const names = ["legacy_cloud_backup_archive", "account_transfer_state"];
  check("rollback: se quitan tablas, funciones y disparadores nuevos y las funciones anteriores quedan idénticas", names.every((t) => !(t in rolled.data)) && Object.keys(baseline.funcs).every((k) => baseline.funcs[k] === rolled.funcs[k]) && rolled.triggers.h === baseline.triggers.h);
  check("rollback: la app anterior vuelve a poder guardar respaldos", (await fails(() => upload("respaldo-despues-del-rollback"))) === null);

  await sA.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
