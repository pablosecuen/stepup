// R4 — Retención y purga de importaciones, sobre Postgres REAL con varias conexiones simultáneas (todas las migraciones reales).
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/r4_retention.cjs [--mutations]
// Con `--mutations` se rompe cada control de `purge_expired_import_data()` a propósito (sin gracia, sin filtro de vencimiento, sin lock por
// cuenta, borrando previews con corrida, sin borrar snapshots, con privilegios abiertos…) y se exige que las pruebas lo detecten.
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const MIG = path.join(__dirname, "..", "..", "migrations");
const FILE = "20261008100000_r4_import_retention.sql";
const SQL = fs.readFileSync(path.join(MIG, FILE), "utf8");

let failures = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) failures.push(msg); return !!cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function expectError(promise, test, label) {
  try {
    await promise;
    ok(false, `${label}: debía fallar y no falló`);
  } catch (e) {
    ok(test(e), `${label}: error inesperado ${e.code}/${String(e.message).slice(0, 90)}`);
  }
}

async function wipe(admin) {
  await admin.query(`truncate public.import_run_row_snapshots, public.import_undo_previews, public.import_runs, public.import_preview_duplicate_candidates,
    public.import_preview_row_fingerprints, public.import_previews, public.account_quota_overrides restart identity cascade`);
  await admin.query("delete from public.students");
}

async function student(admin, owner, name) {
  return (await admin.query(`insert into public.students (owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
    values ($1, $2, 'online','activo','otro','mensual','2026-01-01',1000,'A1','{}') returning id`, [owner, name])).rows[0].id;
}

/** `expires` = hace cuánto venció el preview (intervalo SQL); el preview nace 30 minutos antes de vencer. */
async function preview(admin, owner, { status = "applied", expires = "2 days" } = {}) {
  return (await admin.query(`insert into public.import_previews (owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status, created_at, expires_at)
    values ($1, 'chk', 1, '{"students":[{"name":"Dato Personal"}]}'::jsonb, '{"maestros":{"students":{"inserts":[{"legacy_mobile_id":"x"}]}}}'::jsonb, '["a"]'::jsonb, $2,
      now() - interval '${expires}' - interval '30 minutes', now() - interval '${expires}') returning id`, [owner, status])).rows[0].id;
}

async function fingerprintsAndCandidates(admin, previewId, owner) {
  await admin.query(`insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint) values ($1, 'students', gen_random_uuid(), 'fp')`, [previewId]);
  const sid = await student(admin, owner, "Candidato " + previewId.slice(0, 4));
  await admin.query(`insert into public.import_preview_duplicate_candidates (preview_id, backup_legacy_mobile_id, candidate_student_id, match_signals, candidate_fingerprint, field_diff)
    values ($1, 'leg', $2, '{name}', 'fp', '{"name":"Dato Personal"}'::jsonb)`, [previewId, sid]);
  return sid;
}

/** `undo` = hace cuánto venció (positivo) o dentro de cuánto vence (`-1 day`) el plazo de deshacer de la corrida. */
async function run(admin, owner, previewId, { undo = "2 hours", payload = true, snapshots = 3, status = "applied", purgedFlags = false } = {}) {
  const id = (await admin.query(`insert into public.import_runs (owner_id, preview_id, backup_checksum, schema_version, summary, field_overrides, duplicate_decisions, retained_payload,
      payload_purged_at, snapshots_purged_at, status, created_at, undo_expires_at)
    values ($1, $2, 'chk', 1, '{"total_rows_written":3}'::jsonb, '[]'::jsonb, '[]'::jsonb, ${payload ? `'{"students":[{"name":"Dato Personal"}]}'::jsonb` : "null"},
      ${purgedFlags ? "now()" : "null"}, ${purgedFlags ? "now()" : "null"}, $3, now() - interval '31 days', now() - interval '${undo}') returning id`, [owner, previewId, status])).rows[0].id;
  for (let i = 0; i < snapshots; i += 1) {
    await admin.query(`insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, new_row) values ($1, 'students', gen_random_uuid(), 'inserted', '{"name":"Dato Personal"}'::jsonb)`, [id]);
  }
  return id;
}

async function undoPreview(admin, owner, runId, { expires = "2 days", status = "pending" } = {}) {
  return (await admin.query(`insert into public.import_undo_previews (import_run_id, owner_id, is_safe, unsafe_rows, status, created_at, expires_at)
    values ($1, $2, true, '[]'::jsonb, $3, now() - interval '${expires}' - interval '30 minutes', now() - interval '${expires}') returning id`, [runId, owner, status])).rows[0].id;
}

/** Estado completo y comparable de todo lo que la purga puede tocar (sin ids generados al azar: orden por checksum/estado). */
async function snapshot(admin) {
  const q = async (sql) => (await admin.query(sql)).rows;
  return JSON.stringify({
    previews: await q(`select owner_id, status, expires_at is not null e, normalized_payload::text p, classification::text c, payload_purged_at is not null pp, id from public.import_previews order by id`),
    runs: await q(`select r.id, r.owner_id, r.status, r.retained_payload::text p, r.payload_purged_at is not null pp, r.snapshots_purged_at is not null sp, r.summary::text s,
      (select count(*)::int from public.import_run_row_snapshots s where s.import_run_id = r.id) n from public.import_runs r order by r.id`),
    undo: await q(`select id from public.import_undo_previews order by id`),
    fps: await q(`select count(*)::int c from public.import_preview_row_fingerprints`),
    cands: await q(`select count(*)::int c from public.import_preview_duplicate_candidates`),
    students: await q(`select count(*)::int c, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public.students x`),
  });
}
const purge = async (admin, n = 200) => (await admin.query("select public.purge_expired_import_data($1) r", [n])).rows[0].r;
const ZERO = { undo_previews_deleted: 0, previews_deleted: 0, previews_blanked: 0, runs_purged: 0, runs_skipped: 0, snapshots_deleted: 0 };

async function runChecks(pg, label) {
  failures = [];
  const { admin } = pg;
  const L = (m) => `[${label}] ${m}`;
  await wipe(admin);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@invalid.test'), ($2, 'b@invalid.test') on conflict do nothing", [A, B]);

  // ------------------------------------------------------------------------------------------------------ 1) nada vigente se toca
  const pAppliedRecent = await preview(admin, A, { status: "applied", expires: "2 hours" }); // dentro de las 24 h de gracia
  const runWithin = await run(admin, A, pAppliedRecent, { undo: "-5 days" }); // plazo de deshacer vigente
  const pPendingRecent = await preview(admin, A, { status: "pending", expires: "2 hours" });
  const pPendingLive = await preview(admin, A, { status: "pending", expires: "-20 minutes" }); // todavía vigente
  const pGrace = await preview(admin, B, { status: "applied", expires: "3 days" });
  const runGrace = await run(admin, B, pGrace, { undo: "30 minutes" }); // vencido hace 30 min: dentro de la hora de gracia
  const undoRecent = await undoPreview(admin, A, runWithin, { expires: "2 hours" });
  await fingerprintsAndCandidates(admin, pPendingRecent, A);
  await admin.query("update public.import_previews set payload_purged_at = null where id = $1", [pGrace]);
  const before1 = await snapshot(admin);
  const r1 = await purge(admin);
  // el preview aplicado de B (vencido hace 3 días) SÍ se vacía; lo demás no cambia. Se compara el resto.
  ok(r1.previews_blanked === 1, L(`sólo el preview aplicado de B (vencido hace 3 días) se vació: ${JSON.stringify(r1)}`));
  ok(r1.runs_purged === 0 && r1.runs_skipped === 0, L(`ninguna corrida vigente ni dentro de la hora de gracia se purgó: ${JSON.stringify(r1)}`));
  ok(r1.previews_deleted === 0 && r1.undo_previews_deleted === 0, L("ningún preview vigente / dentro de 24 h se borró"));
  const after1 = JSON.parse(await snapshot(admin));
  const b1 = JSON.parse(before1);
  ok(JSON.stringify(after1.runs) === JSON.stringify(b1.runs), L("las corridas vigentes y la de gracia quedaron idénticas (payload y snapshots intactos)"));
  ok(after1.undo.length === 1 && after1.undo[0].id === undoRecent, L("el preview de deshacer de hace 2 h sigue"));
  ok(after1.previews.filter((p) => p.id !== pGrace).every((p, i) => JSON.stringify(p) === JSON.stringify(b1.previews.filter((x) => x.id !== pGrace)[i])), L("los demás previews quedaron idénticos"));
  ok(after1.fps[0].c === 1 && after1.cands[0].c === 1, L("huellas/candidatos de un preview pendiente reciente intactos"));

  // ------------------------------------------------------------------------------------------------------ 2) lo vencido se purga
  await wipe(admin);
  const stOwn = await student(admin, A, "Alumna Real");
  const stOther = await student(admin, B, "Alumna de B");
  const pOld = await preview(admin, A, { status: "applied", expires: "40 days" });
  const candStudent = await fingerprintsAndCandidates(admin, pOld, A);
  const runOld = await run(admin, A, pOld, { undo: "10 days", snapshots: 5 });
  const pOldB = await preview(admin, B, { status: "applied", expires: "40 days" });
  const runOldB = await run(admin, B, pOldB, { undo: "2 hours", snapshots: 2 });
  const pGone = await preview(admin, A, { status: "pending", expires: "3 days" });
  await fingerprintsAndCandidates(admin, pGone, A);
  const pExpired = await preview(admin, A, { status: "expired", expires: "3 days" });
  const undoOld = await undoPreview(admin, A, runOld, { expires: "3 days" });
  const undoOldApplied = await undoPreview(admin, A, runOld, { expires: "3 days", status: "applied" });
  const runFuture = await run(admin, B, await preview(admin, B, { status: "applied", expires: "40 days" }), { undo: "-3 days", snapshots: 4 });
  const bFuture = JSON.stringify((await admin.query("select count(*)::int c from public.import_run_row_snapshots where import_run_id = $1", [runFuture])).rows[0]);
  const studentsBefore = (await admin.query("select count(*)::int c, md5(string_agg(x::text, '|' order by x::text)) h from public.students x")).rows[0];
  const r2 = await purge(admin);
  ok(r2.runs_purged === 2 && r2.snapshots_deleted === 7, L(`2 corridas vencidas purgadas con 7 snapshots: ${JSON.stringify(r2)}`));
  ok(r2.undo_previews_deleted === 2, L(`2 previews de deshacer vencidos borrados: ${JSON.stringify(r2)}`));
  ok(r2.previews_deleted === 2, L(`2 previews nunca aplicados (pendiente y vencido) borrados: ${JSON.stringify(r2)}`));
  ok(r2.previews_blanked === 3, L(`3 previews aplicados vaciados (A, B y B futuro): ${JSON.stringify(r2)}`));
  const runs = (await admin.query("select id, retained_payload, payload_purged_at, snapshots_purged_at, status, summary from public.import_runs where id = any($1::uuid[])", [[runOld, runOldB]])).rows;
  ok(runs.length === 2 && runs.every((x) => x.retained_payload === null && x.payload_purged_at && x.snapshots_purged_at), L("el respaldo retenido se borró y se escribieron payload_purged_at / snapshots_purged_at"));
  ok(runs.every((x) => x.status === "applied" && x.summary.total_rows_written === 3), L("la corrida queda como historial: estado y resumen intactos"));
  ok(Number((await admin.query("select count(*)::int c from public.import_run_row_snapshots where import_run_id = any($1::uuid[])", [[runOld, runOldB]])).rows[0].c) === 0, L("sin snapshots de las corridas purgadas"));
  ok(JSON.stringify((await admin.query("select count(*)::int c from public.import_run_row_snapshots where import_run_id = $1", [runFuture])).rows[0]) === bFuture, L("la corrida con plazo vigente conserva sus snapshots"));
  const blanked = (await admin.query("select normalized_payload::text p, classification::text c, excluded_collections::text e, payload_purged_at, status from public.import_previews where id = $1", [pOld])).rows[0];
  ok(blanked.p === "{}" && blanked.c === "{}" && blanked.e === "[]" && blanked.payload_purged_at && blanked.status === "applied", L("el preview aplicado queda vacío (sin contenido personal), con su estado y payload_purged_at"));
  ok(Number((await admin.query("select count(*)::int c from public.import_previews where id = any($1::uuid[])", [[pGone, pExpired]])).rows[0].c) === 0, L("los previews pendiente/vencido sin corrida se borraron"));
  ok(Number((await admin.query("select count(*)::int c from public.import_preview_duplicate_candidates")).rows[0].c) === 0 && Number((await admin.query("select count(*)::int c from public.import_preview_row_fingerprints")).rows[0].c) === 0, L("sin huellas ni candidatos (con datos del alumno) de previews vencidos"));
  const studentsAfter = (await admin.query("select count(*)::int c, md5(string_agg(x::text, '|' order by x::text)) h from public.students x")).rows[0];
  ok(studentsAfter.c === studentsBefore.c && studentsAfter.h === studentsBefore.h, L("los datos de negocio (alumnos, incluso el candidato y los de las dos cuentas) quedaron idénticos"));
  ok(!!stOwn && !!stOther && !!candStudent, L("alumnos de la cuenta intactos"));

  // ------------------------------------------------------------------------------------------------------ 3) idempotencia
  const stateDone = await snapshot(admin);
  const r3 = await purge(admin);
  ok(Object.keys(ZERO).every((k) => r3[k] === 0) && Object.keys(r3).length === Object.keys(ZERO).length, L(`segunda pasada = ceros: ${JSON.stringify(r3)}`));
  ok((await snapshot(admin)) === stateDone, L("segunda pasada no cambia nada"));
  void undoOld; void undoOldApplied;

  // ------------------------------------------------------------------------------------------------------ 4) lotes acotados
  await wipe(admin);
  for (let i = 0; i < 7; i += 1) await preview(admin, A, { status: "pending", expires: "3 days" });
  const l1 = await purge(admin, 3);
  ok(l1.previews_deleted === 3, L(`lote de 3: borra 3 de 7: ${JSON.stringify(l1)}`));
  const l2 = await purge(admin, 3);
  const l3 = await purge(admin, 3);
  const l4 = await purge(admin, 3);
  ok(l2.previews_deleted === 3 && l3.previews_deleted === 1 && l4.previews_deleted === 0, L(`se vacía de a lotes: ${l2.previews_deleted}/${l3.previews_deleted}/${l4.previews_deleted}`));
  const pr = [];
  for (let i = 0; i < 30; i += 1) { const p = await preview(admin, A, { status: "applied", expires: "40 days" }); pr.push(await run(admin, A, p, { undo: "2 days", snapshots: 1 })); }
  const rb = await purge(admin, 100); // lote de corridas = 10
  ok(rb.runs_purged === 10, L(`lote de corridas acotado a 100/10 = 10: ${JSON.stringify(rb)}`));
  const rb2 = await purge(admin, 1000); // 25 como máximo por pasada
  ok(rb2.runs_purged === 20, L(`el resto (20) en la siguiente pasada: ${JSON.stringify(rb2)}`));
  ok(Number((await admin.query("select count(*)::int c from public.import_run_row_snapshots")).rows[0].c) === 0, L("todos los snapshots purgados"));

  // ------------------------------------------------------------------------------------------------------ 5) un preview con corrida nunca se borra
  await wipe(admin);
  const weird = await preview(admin, A, { status: "pending", expires: "40 days" }); // estado raro: pendiente pero con corrida
  await run(admin, A, weird, { undo: "2 days" });
  const rw = await purge(admin);
  ok(rw.previews_deleted === 0, L(`un preview referenciado por una corrida no se borra: ${JSON.stringify(rw)}`));
  ok(Number((await admin.query("select count(*)::int c from public.import_previews where id = $1", [weird])).rows[0].c) === 1, L("el preview con corrida sigue (FK intacta)"));

  // ------------------------------------------------------------------------------------------------------ 6) lock por cuenta (el mismo de aplicar/deshacer)
  await wipe(admin);
  const pa = await preview(admin, A, { status: "applied", expires: "40 days" });
  const ra = await run(admin, A, pa, { undo: "2 days", snapshots: 4 });
  const pb = await preview(admin, B, { status: "applied", expires: "40 days" });
  const rb_ = await run(admin, B, pb, { undo: "2 days", snapshots: 2 });
  const holder = await pg.connect();
  await holder.query("begin");
  await holder.query("select pg_advisory_xact_lock(hashtext('backup_import:' || $1::text))", [A]); // A está aplicando o deshaciendo
  const t0 = Date.now();
  await admin.query("set statement_timeout = '4s'"); // una purga que ESPERA el lock de otra cuenta se corta y se detecta como falla
  let rl = {};
  try { rl = await purge(admin); } catch (e) { ok(false, L(`la purga quedó esperando el lock de otra cuenta (${e.message})`)); }
  await admin.query("set statement_timeout = 0");
  const elapsed = Date.now() - t0;
  ok(rl.runs_skipped === 1 && rl.runs_purged === 1, L(`con la cuenta A ocupada: A se saltea y B se purga: ${JSON.stringify(rl)}`));
  ok(elapsed < 1500, L(`la purga no espera al lock de otra cuenta (${elapsed} ms)`));
  ok(Number((await admin.query("select count(*)::int c from public.import_run_row_snapshots where import_run_id = $1", [ra])).rows[0].c) === 4, L("los snapshots de la cuenta ocupada siguen intactos"));
  ok(Number((await admin.query("select count(*)::int c from public.import_run_row_snapshots where import_run_id = $1", [rb_])).rows[0].c) === 0, L("los de la otra cuenta se purgaron sin esperar"));
  await holder.query("commit");
  await holder.end();
  const rl2 = await purge(admin);
  ok(rl2.runs_purged === 1 && rl2.runs_skipped === 0, L(`al liberarse el lock, A se purga en la pasada siguiente: ${JSON.stringify(rl2)}`));

  // ------------------------------------------------------------------------------------------------------ 7) dos purgas simultáneas
  await wipe(admin);
  for (let i = 0; i < 20; i += 1) { const p = await preview(admin, i % 2 ? A : B, { status: "applied", expires: "40 days" }); await run(admin, i % 2 ? A : B, p, { undo: "2 days", snapshots: 3 }); }
  const c1 = await pg.connect();
  const c2 = await pg.connect();
  const [x, y] = await Promise.all([c1.query("select public.purge_expired_import_data(200) r"), c2.query("select public.purge_expired_import_data(200) r")]);
  const total = x.rows[0].r.runs_purged + y.rows[0].r.runs_purged + x.rows[0].r.runs_skipped * 0;
  const leftover = Number((await admin.query("select count(*)::int c from public.import_runs where retained_payload is not null or payload_purged_at is null")).rows[0].c);
  const rest = await purge(admin);
  ok(total + rest.runs_purged === 20 && leftover === 20 - total, L(`dos purgas simultáneas: sin errores, sin doble trabajo (${total} + ${rest.runs_purged} = 20)`));
  ok(Number((await admin.query("select count(*)::int c from public.import_run_row_snapshots")).rows[0].c) === 0, L("al final no quedan snapshots"));
  await c1.end(); await c2.end();

  // ------------------------------------------------------------------------------------------------------ 8) deshacer después de la purga
  await wipe(admin);
  const sKeep = await student(admin, A, "Alumna importada");
  const pu = await preview(admin, A, { status: "applied", expires: "40 days" });
  const ru = await run(admin, A, pu, { undo: "2 days", snapshots: 1 });
  await admin.query("update public.import_run_row_snapshots set row_id = $1 where import_run_id = $2", [sKeep, ru]);
  const sessionA = await pg.session(A);
  const before8 = await snapshot(admin);
  await purge(admin);
  await expectError(sessionA.query("select * from public.preview_undo_backup_import($1)", [ru]), (e) => /plazo para deshacer/.test(e.message), L("preview_undo_backup_import: «el plazo venció» después de la purga"));
  ok(Number((await admin.query("select count(*)::int c from public.students where id = $1", [sKeep])).rows[0].c) === 1, L("la purga y el deshacer rechazado no borran datos de negocio"));
  // Carrera: un preview de deshacer creado DENTRO del plazo y aplicado después de la purga se rechaza y no marca la corrida como deshecha.
  await wipe(admin);
  const pu2 = await preview(admin, A, { status: "applied", expires: "40 days" });
  const ru2 = await run(admin, A, pu2, { undo: "2 hours", snapshots: 2, purgedFlags: false });
  const up = await undoPreview(admin, A, ru2, { expires: "-20 minutes" }); // vigente
  await purge(admin);
  await expectError(sessionA.query("select * from public.apply_undo_backup_import($1)", [up]), (e) => /renunciaste/.test(e.message), L("apply_undo_backup_import sobre una corrida purgada se rechaza"));
  ok((await admin.query("select status from public.import_runs where id = $1", [ru2])).rows[0].status === "applied", L("la corrida purgada no queda marcada como deshecha en vacío"));
  void before8;
  await sessionA.end();

  // ------------------------------------------------------------------------------------------------------ 9) privilegios
  await wipe(admin);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const c = await pg.session(role === "anon" ? "" : A, role);
    await expectError(c.query("select public.purge_expired_import_data(5)"), (e) => e.code === "42501", L(`${role} no puede ejecutar la purga (42501)`));
    await c.end();
  }
  const cs = await pg.session(A);
  await expectError(cs.query("select count(*) from public.import_previews"), (e) => e.code === "42501", L("authenticated sigue sin leer previews"));
  await cs.end();
  const acl = (await admin.query("select has_function_privilege('anon', 'public.purge_expired_import_data(integer)', 'execute') a, has_function_privilege('authenticated', 'public.purge_expired_import_data(integer)', 'execute') b, has_function_privilege('public', 'public.purge_expired_import_data(integer)', 'execute') c")).rows[0];
  ok(!acl.a && !acl.b && !acl.c, L("sin EXECUTE para anon/authenticated/public"));
  const sec = (await admin.query("select prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where proname = 'purge_expired_import_data'")).rows[0];
  ok(sec.prosecdef && /search_path=""/.test(sec.cfg), L("SECURITY DEFINER con search_path vacío"));

  // ------------------------------------------------------------------------------------------------------ 10) convive con las cuotas de R3
  await wipe(admin);
  const pq = await preview(admin, A, { status: "applied", expires: "40 days" });
  await run(admin, A, pq, { undo: "2 days" });
  await admin.query("insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'import_runs', 1), ($1, 'import_previews', 1)", [A]);
  const rq = await purge(admin);
  ok(rq.runs_purged === 1 && rq.previews_blanked === 1, L(`cuenta por encima de su tope: la purga (UPDATE/DELETE) no choca con las cuotas: ${JSON.stringify(rq)}`));

  // ------------------------------------------------------------------------------------------------------ 11) la salida no lleva datos
  ok(Object.values(rq).every((v) => typeof v === "number"), L("la purga sólo devuelve cantidades"));
  ok(pg.failures.length === 0, L(`todas las migraciones (incluida la programación sin pg_cron) se aplican sin error: ${JSON.stringify(pg.failures)}`));
  ok((await admin.query("select count(*)::int c from pg_namespace where nspname = 'cron'")).rows[0].c === 0, L("sin pg_cron en la base de pruebas: la migración de programación saltea sin error"));
}

const MUTATIONS = [
  ["sin hora de gracia en las corridas", (s) => s.replace(`r.undo_expires_at < now() - interval '1 hour'\n       and (r.retained_payload`, `r.undo_expires_at < now()\n       and (r.retained_payload`).replace(`where r.id = v_run.id\n        and r.undo_expires_at < now() - interval '1 hour'`, `where r.id = v_run.id\n        and r.undo_expires_at < now()`)],
  ["purga corridas sin mirar el vencimiento", (s) => s.replace(`r.undo_expires_at < now() - interval '1 hour'\n       and (r.retained_payload`, `true\n       and (r.retained_payload`).replace(`where r.id = v_run.id\n        and r.undo_expires_at < now() - interval '1 hour'`, `where r.id = v_run.id`)],
  ["sin 24 h de gracia en los previews nunca aplicados", (s) => s.replace(`and p.expires_at < now() - interval '24 hours'\n       and not exists`, `and p.expires_at < now()\n       and not exists`)],
  ["sin 24 h de gracia en los previews aplicados", (s) => s.replace(`and p.payload_purged_at is null\n       and p.expires_at < now() - interval '24 hours'`, `and p.payload_purged_at is null\n       and p.expires_at < now()`)],
  ["sin lock por cuenta (no respeta aplicar/deshacer)", (s) => s.replace(`if not pg_try_advisory_xact_lock(hashtext('backup_import:' || v_run.owner_id::text)) then`, `if false then`)],
  ["lock que ESPERA en vez de saltear", (s) => s.replace(`if not pg_try_advisory_xact_lock(hashtext('backup_import:' || v_run.owner_id::text)) then`, `perform pg_advisory_xact_lock(hashtext('backup_import:' || v_run.owner_id::text));\n    if false then`)],
  ["no borra los snapshots", (s) => s.replace(`delete from public.import_run_row_snapshots s where s.import_run_id = v_run.id;`, `perform 1;`).replace(`get diagnostics v_rows = row_count;`, `v_rows := 0;`)],
  ["no borra el respaldo retenido", (s) => s.replace(`set retained_payload = null,`, `set retained_payload = r.retained_payload,`)],
  ["no escribe snapshots_purged_at", (s) => s.replace(`snapshots_purged_at = coalesce(r.snapshots_purged_at, now())`, `snapshots_purged_at = r.snapshots_purged_at`)],
  ["borra previews aplicados (con corrida)", (s) => s.replace(`where p.status in ('pending', 'expired')`, `where p.status in ('pending', 'expired', 'applied')`).replace(`\n       and not exists (select 1 from public.import_runs r where r.preview_id = p.id)`, ``)],
  ["no vacía el preview aplicado", (s) => s.replace(`set normalized_payload = '{}'::jsonb,`, `set normalized_payload = p.normalized_payload,`)],
  ["no borra candidatos a duplicado", (s) => s.replace(`delete from public.import_preview_duplicate_candidates c using todo t where c.preview_id = t.id returning 1`, `select 1 where false`)],
  ["no borra los previews de deshacer vencidos", (s) => s.replace(`where u.expires_at < now() - interval '24 hours'`, `where false`)],
  ["lote sin límite", (s) => s.replace(`v_batch integer := least(greatest(coalesce(p_batch_size, 200), 1), 1000);`, `v_batch integer := 100000;`)],
  ["lote de corridas sin límite", (s) => s.replace(`v_run_batch integer := least(greatest(coalesce(p_batch_size, 200) / 10, 1), 25);`, `v_run_batch integer := 100000;`)],
  ["purga a todos los previews aplicados de otras cuentas sin gracia de vencimiento", (s) => s.replace(`and p.payload_purged_at is null\n       and p.expires_at < now() - interval '24 hours'`, `and p.payload_purged_at is null`)],
];

async function main() {
  const pg = await start({ port: 5443 });
  try {
    console.log("migraciones:", pg.files.length, "con error:", pg.failures.length);
    await runChecks(pg, "base");
    console.log(`R4 retención: ${checks} comprobaciones, ${failures.length} fallas`);
    for (const f of failures) console.log(" ✗", f);
    let bad = failures.length > 0;
    if (process.argv.includes("--mutations")) {
      const results = [];
      for (const [name, mutate] of MUTATIONS) {
        const mutated = mutate(SQL);
        if (mutated === SQL) { results.push([name, "ERROR (el parche no encontró su patrón)"]); continue; }
        try {
          await pg.admin.query(mutated);
          if (name.startsWith("privilegios")) await pg.admin.query("grant execute on function public.purge_expired_import_data(integer) to authenticated");
          await runChecks(pg, name);
        } catch (e) {
          results.push([name, "DETECTADA (error: " + String(e.message).split("\n")[0].slice(0, 60) + ")"]);
          await pg.admin.query(SQL);
          continue;
        }
        results.push([name, failures.length > 0 ? `DETECTADA (${failures.length})` : "NO DETECTADA"]);
        await pg.admin.query(SQL);
      }
      // mutación de privilegios aparte
      await pg.admin.query("grant execute on function public.purge_expired_import_data(integer) to authenticated");
      await runChecks(pg, "privilegios abiertos");
      results.push(["privilegios abiertos para authenticated", failures.length > 0 ? `DETECTADA (${failures.length})` : "NO DETECTADA"]);
      await pg.admin.query("revoke all on function public.purge_expired_import_data(integer) from public, anon, authenticated, service_role");
      for (const [n, r] of results) console.log((r.startsWith("DETECTADA") ? "DETECTADA   " : "FALLA       ") + n + "  <- " + r);
      const missed = results.filter(([, r]) => !r.startsWith("DETECTADA"));
      console.log(`\n${results.length - missed.length}/${results.length} mutaciones detectadas`);
      if (missed.length) bad = true;
      await runChecks(pg, "restaurada");
      console.log(`restaurada: ${failures.length} fallas`);
      if (failures.length) bad = true;
    }
    process.exitCode = bad ? 1 : 0;
  } finally {
    await pg.stop();
  }
}
main();
void sleep;
