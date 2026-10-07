// R5 — Higiene de privilegios, políticas y search_path, sobre Postgres REAL (todas las migraciones reales + las funciones móviles reales).
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/r5_hygiene.cjs [--mutations]
// Idea: se corre una BATERÍA de comportamiento de la aplicación (RPC de calendario, cobros, niveles, perfil, alumnos, respaldos y sesión de la app
// móvil, escrituras directas, aislamiento entre dos propietarias, anónimo) ANTES de R5 y DESPUÉS, con propietarias distintas, y se exige que los
// resultados normalizados sean IDÉNTICOS salvo lo que R5 cambia a propósito (anónimo y el catálogo de metadatos). Además se compara el catálogo
// completo (políticas, privilegios de tabla y de columna, cuerpos y configuración de funciones, privilegios de EXECUTE, RLS) antes/después.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { start } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const R5 = ["20261009100000_r5_grants_hygiene.sql", "20261009110000_r5_policies_to_authenticated.sql", "20261009120000_r5_function_search_path.sql"];
const LAST_BEFORE = "20261008120000_r4_schedule_import_purge.sql";
const read = (f) => fs.readFileSync(path.join(MIG, f), "utf8");

let failures = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) failures.push(msg); return !!cond; };
const uuidOf = (text) => crypto.createHash("md5").update(text).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
const norm = (v) => (JSON.stringify(v) ?? "undefined")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<ts>");

/** Ejecuta una consulta y devuelve un resultado normalizado: filas o código de error. */
async function attempt(client, sql, params) {
  try {
    const r = await client.query(sql, params);
    return { rows: (r.rows || []).map((x) => x), count: r.rowCount };
  } catch (e) {
    return process.env.R5_DEBUG ? { error: e.code, m: e.message.slice(0, 90) } : { error: e.code };
  }
}

// ------------------------------------------------------------------------------------------------------------------------- catálogo
async function catalog(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    rls: await q("select relname, relrowsecurity r, relforcerowsecurity f from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') order by 1"),
    policies: await q("select tablename, policyname, cmd, permissive, qual, with_check, array_to_string(roles, ',') roles from pg_policies where schemaname in ('public','storage') order by 1, 2"),
    tablePrivs: await q(`select c.relname, r.rolname, string_agg(a.privilege_type, ',' order by a.privilege_type) privs
      from pg_class c, aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and r.rolname in ('anon','authenticated','service_role') group by 1, 2 order by 1, 2`),
    colPrivs: await q(`select c.relname || '.' || a.attname col, string_agg(r.rolname || ':' || x.privilege_type, ',' order by r.rolname) privs
      from pg_attribute a join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace, aclexplode(a.attacl) x join pg_roles r on r.oid = x.grantee
      where a.attacl is not null and a.attnum > 0 group by 1 order by 1`),
    functions: await q(`select p.oid::regprocedure::text sig, md5(p.prosrc) body, md5(pg_get_function_result(p.oid) || pg_get_function_arguments(p.oid)) iface, p.prosecdef secdef, p.provolatile::text vol, array_to_string(p.proconfig, ',') cfg,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    defacl: await q("select pg_get_userbyid(d.defaclrole) r, d.defaclobjtype::text t, d.defaclacl::text a from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' order by 1, 2"),
    triggers: await q("select c.relname, t.tgname, t.tgfoid::regproc::text fn from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2"),
    registryRows: Number((await q("select count(*)::int c from public.import_undo_dependency_registry"))[0].c),
  };
}

// ------------------------------------------------------------------------------------------------------------------------ comportamiento
const lessonPayload = (primary, name, opId, start = "2026-10-12T21:00:00Z", end = "2026-10-12T22:00:00Z") => JSON.stringify({
  operation_id: opId, primary_student_id: primary, student_name: name, level: "B1", lesson_type: "individual", start_at: start, end_at: end, modality: "presencial",
  participants: [{ student_id: primary, student_name: name, level: "B1" }],
});
const seriesPayload = (primary, opId, ids) => JSON.stringify({
  operation_id: opId, primary_student_id: primary, rule_type: "weekly", cycle_length_weeks: 1,
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }],
  modality: "presencial", timezone: "UTC", start_date: "2026-11-02", participant_ids: ids,
});

/** Una pasada completa de la aplicación para (owner, other). Devuelve [{step, out}] normalizados. */
async function battery(pg, owner, other, tag) {
  const out = [];
  const rec = (step, v) => out.push({ step, out: norm(v) });
  const admin = pg.admin;
  await admin.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [owner, `a-${tag}@x.test`, other, `b-${tag}@x.test`]);
  const s1 = uuidOf(`${tag}-s1`), s2 = uuidOf(`${tag}-s2`), sB = uuidOf(`${tag}-sB`);
  for (const [id, o, n] of [[s1, owner, "Ana"], [s2, owner, "Beto"], [sB, other, "Carla"]]) {
    await admin.query(`insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
      values ($1, $2, $3, 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}')`, [id, o, n]);
  }
  const A = await pg.session(owner);
  const B = await pg.session(other);
  const anon = await pg.session("", "anon");

  // 1) lectura de TODAS las tablas de public: filas propias / ajenas
  const tables = (await admin.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') and relname <> 'import_undo_dependency_registry' order by 1")).rows.map((r) => r.relname);
  for (const t of tables) {
    const a = await attempt(A, `select count(*)::int c from public."${t}"`);
    const b = await attempt(B, `select count(*)::int c from public."${t}"`);
    rec(`A lee ${t}`, a.error ? a : a.rows);
    rec(`B lee ${t}`, b.error ? b : b.rows);
  }
  rec("B lee los alumnos de A", (await attempt(B, "select count(*)::int c from public.students where owner_id = $1", [owner])).rows);

  // 2) calendario (invocador): crear, idempotencia, cancelar, serie, participantes, reprogramar, dividir
  const op = uuidOf(`${tag}-op1`);
  rec("crear clase", (await attempt(A, "select (public.create_calendar_lesson($1::jsonb)).status st", [lessonPayload(s1, "Ana", op)])).rows);
  rec("crear clase (reintento)", (await attempt(A, "select (public.create_calendar_lesson($1::jsonb)).status st", [lessonPayload(s1, "Ana", op)])).rows);
  rec("clases de A", (await attempt(A, "select count(*)::int c from public.calendar_lessons")).rows);
  rec("clase con alumno ajeno", (await attempt(B, "select public.create_calendar_lesson($1::jsonb)", [lessonPayload(s1, "Ana", uuidOf(`${tag}-op9`))])));
  const lessonId = (await admin.query("select id from public.calendar_lessons where owner_id = $1 limit 1", [owner])).rows[0].id;
  rec("cancelar clase", (await attempt(A, "select (public.cancel_calendar_occurrence(jsonb_build_object('lesson_id', $1::text))).status st", [lessonId])).rows);
  rec("cancelar clase (doble toque)", (await attempt(A, "select (public.cancel_calendar_occurrence(jsonb_build_object('lesson_id', $1::text))).status st", [lessonId])).rows);
  rec("B cancela clase ajena", await attempt(B, "select public.cancel_calendar_occurrence(jsonb_build_object('lesson_id', $1::text))", [lessonId]));
  const sop = uuidOf(`${tag}-sop`);
  rec("crear serie", (await attempt(A, "select (public.create_recurrence_series($1::jsonb)).status st", [seriesPayload(s1, sop, [s1, s2])])).rows);
  const ruleId = (await admin.query("select id from public.recurrence_rules where owner_id = $1 limit 1", [owner])).rows[0].id;
  rec("participantes de la serie", await attempt(A, "select (public.apply_recurrence_participants_from_date(jsonb_build_object('rule_id', $1::text, 'primary_student_id', $2::text, 'new_participant_ids', jsonb_build_array($2::text, $3::text), 'freeze_occurrences', '[]'::jsonb))).status st", [ruleId, s1, s2]));
  rec("participante ajeno", await attempt(A, "select public.apply_recurrence_participants_from_date(jsonb_build_object('rule_id', $1::text, 'new_participant_ids', jsonb_build_array($2::text), 'freeze_occurrences', '[]'::jsonb))", [ruleId, sB]));
  rec("reprogramar ocurrencia", (await attempt(A, `select (public.reschedule_calendar_occurrence(jsonb_build_object('recurrence_id', $1::text, 'occurrence_key', $1::text || ':w0:c0:d1:t1800:s0', 'primary_student_id', $2::text, 'student_name', 'Ana', 'level', 'B1',
      'lesson_type', 'individual', 'new_start_at', '2026-11-09T21:00:00Z', 'new_end_at', '2026-11-09T22:00:00Z', 'modality', 'presencial', 'participants', jsonb_build_array(jsonb_build_object('student_id', $2::text, 'student_name', 'Ana', 'level', 'B1'))))).status st`, [ruleId, s1])).rows);
  rec("dividir serie", await attempt(A, `select (public.split_recurrence_this_and_future(jsonb_build_object('original_recurrence_id', $1::text, 'effective_date', '2026-11-16', 'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-11-09'),
      'successor_id', $2::text, 'successor_start_date', '2026-11-16', 'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
      'primary_student_id', $3::text, 'participant_ids', jsonb_build_array($3::text), 'excluded_occurrence_keys', '[]'::jsonb))).status st`, [ruleId, uuidOf(`${tag}-succ`), s1]));
  rec("series de A", (await attempt(A, "select count(*)::int c, count(*) filter (where status = 'active')::int act from public.recurrence_rules")).rows);

  // 3) niveles, perfil, disponibilidad, alumnos (escrituras directas y por columna)
  rec("nivel: insertar", await attempt(A, "insert into public.custom_levels (owner_id, name) values ($1, 'C1') returning name", [owner]).then((r) => r.error ? r : r.rows));
  const lvl = (await admin.query("select id from public.custom_levels where owner_id = $1", [owner])).rows[0].id;
  rec("nivel: renombrar (RPC)", (await attempt(A, "select (public.rename_custom_level($1::uuid, 'C2')).name n", [lvl])).rows);
  rec("nivel: B renombra el de A", await attempt(B, "select public.rename_custom_level($1::uuid, 'X')", [lvl]));
  rec("nivel: borrar", (await attempt(A, "delete from public.custom_levels where id = $1", [lvl])).count);
  rec("perfil: upsert", await attempt(A, "insert into public.teacher_profiles (owner_id, display_name) values ($1, 'Profe') on conflict (owner_id) do update set display_name = excluded.display_name returning display_name", [owner]).then((r) => r.error ? r : r.rows));
  rec("disponibilidad: upsert", await attempt(A, "insert into public.teacher_availability (owner_id, timezone, weekly_blocks, exceptions) values ($1, 'America/Argentina/Buenos_Aires', '[]', '[]') on conflict (owner_id) do update set timezone = excluded.timezone returning timezone", [owner]).then((r) => r.error ? r : r.rows));
  rec("alumno: actualizar columna permitida", (await attempt(A, "update public.students set notes = 'n' where id = $1", [s1])).count);
  rec("alumno: actualizar columna NO permitida", await attempt(A, "update public.students set owner_id = owner_id where id = $1", [s1]));
  rec("alumno ajeno: B actualiza / borra", [(await attempt(B, "update public.students set notes = 'x' where id = $1", [s1])).count, (await attempt(B, "delete from public.students where id = $1", [s1]))]);
  rec("alumno: B inserta uno a nombre de A", await attempt(B, `insert into public.students (owner_id, name, modality, category, billing_type, date_joined, price) values ($1, 'Falso', 'online', 'otro', 'mensual', '2020-01-01', 1)`, [owner]));
  rec("alumno: B lee los de A", (await attempt(B, "select count(*)::int c from public.students where owner_id = $1", [owner])).rows);

  // 4) cobros (invocador): generar cargos mensuales
  rec("cobros mensuales", (await attempt(A, "select public.ensure_monthly_charges('2026-10', $1::jsonb) n", [JSON.stringify([{ student_id: s1, amount: 1000, due_date: "2026-10-10" }])])).rows);
  rec("cargos de A / de B", [(await attempt(A, "select count(*)::int c from public.payment_charges")).rows, (await attempt(B, "select count(*)::int c from public.payment_charges")).rows]);
  rec("saldos abiertos", (await attempt(A, "select count(*)::int c from public.list_open_charge_balances()")).rows);

  // 5) el disparador set_updated_at sigue actualizando (EXECUTE revocado pero el disparador se ejecuta igual)
  const trig = (await admin.query("select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgfoid = 'public.set_updated_at'::regproc and not t.tgisinternal and c.relname = 'teacher_profiles'")).rows[0]?.relname;
  rec("teacher_profiles tiene el disparador set_updated_at", trig || "no");
  if (trig === "teacher_profiles") {
    await admin.query("update public.teacher_profiles set updated_at = '2000-01-01' where owner_id = $1", [owner]);
    await attempt(A, "update public.teacher_profiles set display_name = 'Profe 2' where owner_id = $1", [owner]);
    rec("set_updated_at dispara", (await admin.query("select updated_at > '2001-01-01' ok from public.teacher_profiles where owner_id = $1", [owner])).rows);
  }

  // 6) app móvil: sesión activa y respaldos
  rec("transfer_active_session", (await attempt(A, "select * from public.transfer_active_session('device-aaaaaaaa')")).rows);
  rec("touch_active_session", (await attempt(A, "select * from public.touch_active_session('device-aaaaaaaa')")).rows);
  rec("upload_cloud_backup", (await attempt(A, "select is_duplicate from public.upload_cloud_backup('device-aaaaaaaa', 1, 1, '1.0', '{\"a\":1}'::jsonb)")).rows);
  rec("upload_cloud_backup (igual)", (await attempt(A, "select is_duplicate from public.upload_cloud_backup('device-aaaaaaaa', 1, 1, '1.0', '{\"a\":1}'::jsonb)")).rows);
  rec("upload_cloud_backup (otro)", (await attempt(A, "select is_duplicate from public.upload_cloud_backup('device-aaaaaaaa', 1, 1, '1.0', '{\"a\":2}'::jsonb)")).rows);
  rec("fetch_latest_cloud_backup_timestamp", (await attempt(A, "select count(*)::int c from public.fetch_latest_cloud_backup_timestamp()")).rows);
  rec("fetch_latest_cloud_backup", (await attempt(A, "select checksum is not null ok, payload from public.fetch_latest_cloud_backup('device-aaaaaaaa', 1)")).rows);
  rec("fetch_recent_cloud_backups", (await attempt(A, "select count(*)::int c from public.fetch_recent_cloud_backups('device-aaaaaaaa', 1, 10)")).rows);
  rec("respaldos: otro dispositivo no autorizado", await attempt(A, "select * from public.fetch_latest_cloud_backup('device-zzzzzzzz', 1)"));
  rec("respaldos: B sin sesión de dispositivo", await attempt(B, "select * from public.fetch_latest_cloud_backup('device-bbbbbbbb', 1)"));
  rec("respaldos: B no ve los de A", (await attempt(B, "select count(*)::int c from public.cloud_backups")).rows);
  rec("end_active_session", await attempt(A, "select public.end_active_session('device-aaaaaaaa', 1)").then((r) => r.error ? r : "ok"));
  rec("cuota por ventana (R3/R4)", (await attempt(A, "select public.consume_action_quota('account_reauth')")).count);

  // 7) anónimo y metadatos: ESTO es lo que R5 cambia a propósito (se compara aparte)
  const diffs = [];
  diffs.push(["set_updated_at por la API", await attempt(A, "select public.set_updated_at()")]);
  diffs.push(["anon lee students", await attempt(anon, "select count(*)::int c from public.students")]);
  diffs.push(["anon lee payments", await attempt(anon, "select count(*)::int c from public.payments")]);
  diffs.push(["anon inserta", await attempt(anon, `insert into public.custom_levels (owner_id, name) values ($1, 'x')`, [owner])]);
  diffs.push(["anon lee el registro", await attempt(anon, "select count(*)::int c from public.import_undo_dependency_registry")]);
  diffs.push(["authenticated lee el registro", await attempt(A, "select count(*)::int c from public.import_undo_dependency_registry")]);
  diffs.push(["anon llama una RPC", await attempt(anon, "select public.create_calendar_lesson($1::jsonb)", [lessonPayload(s1, "Ana", uuidOf(`${tag}-anon`))])]);
  diffs.push(["anon llama una RPC móvil", await attempt(anon, "select * from public.transfer_active_session('device-aaaaaaaa')")]);
  const priv = (await admin.query(`select bool_or(has_table_privilege('authenticated', c.oid, p)) any_bad from pg_class c, unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')`)).rows[0].any_bad;
  diffs.push(["authenticated con TRUNCATE/REFERENCES/TRIGGER en alguna tabla", priv]);

  // 8) eliminar la cuenta (RPC móvil): borra todo lo de A y nada de B
  rec("delete_own_account", await attempt(A, "select public.delete_own_account()").then((r) => r.error ? r : "ok"));
  rec("tras eliminar: alumnos de A / de B", [(await admin.query("select count(*)::int c from public.students where owner_id = $1", [owner])).rows[0].c, (await admin.query("select count(*)::int c from public.students where owner_id = $1", [other])).rows[0].c]);
  await A.end().catch(() => {}); await B.end().catch(() => {}); await anon.end().catch(() => {});
  return { out, diffs };
}

// -------------------------------------------------------------------------------------------------------------------------------- principal
async function runChecks(pg, label, applyR5) {
  failures = [];
  const L = (m) => `[${label}] ${m}`;
  const A1 = "a1000000-0000-4000-8000-000000000001", B1 = "b1000000-0000-4000-8000-000000000001";
  const A2 = "a2000000-0000-4000-8000-000000000002", B2 = "b2000000-0000-4000-8000-000000000002";

  const catBefore = await catalog(pg.admin);
  const pre = await battery(pg, A1, B1, "pre");
  await applyR5();
  const catAfter = await catalog(pg.admin);
  const post = await battery(pg, A2, B2, "post");

  // ---- comportamiento idéntico
  ok(pre.out.length === post.out.length && pre.out.length > 100, L(`la batería ejecutó ${pre.out.length} pasos antes y ${post.out.length} después`));
  const different = pre.out.filter((p, i) => p.step !== post.out[i].step || p.out !== post.out[i].out);
  ok(different.length === 0, L(`comportamiento de la aplicación idéntico antes/después (${different.length} diferencias: ${different.slice(0, 3).map((d) => d.step + ' ' + d.out.slice(0, 60)).join(' | ')})`));
  const ctrl = (o, step) => o.out.find((x) => x.step === step)?.out;
  const d0 = (o, name) => o.diffs.find((x) => x[0] === name)[1];
  ok(/"st":"scheduled"/.test(ctrl(post, "crear clase") || ""), L("control: la clase se crea"));
  ok(/"st":"cancelled"/.test(ctrl(post, "cancelar clase") || ""), L("control: la clase se cancela"));
  for (const step of ["crear serie", "participantes de la serie", "reprogramar ocurrencia", "dividir serie", "nivel: insertar", "nivel: renombrar (RPC)", "perfil: upsert", "disponibilidad: upsert", "cobros mensuales", "transfer_active_session", "touch_active_session", "upload_cloud_backup", "fetch_latest_cloud_backup", "fetch_recent_cloud_backups", "end_active_session", "delete_own_account"]) {
    ok(ctrl(post, step) && !/"error"/.test(ctrl(post, step)) && ctrl(post, step) !== "undefined", L(`control: «${step}» funciona (no es un error): ${ctrl(post, step)}`));
  }
  for (const step of ["clase con alumno ajeno", "B cancela clase ajena", "participante ajeno", "nivel: B renombra el de A", "alumno: actualizar columna NO permitida", "alumno: B inserta uno a nombre de A"]) {
    ok(/"error"/.test(ctrl(post, step) || ""), L(`control: «${step}» se rechaza`));
  }
  ok(/"ok":true/.test(ctrl(post, "set_updated_at dispara") || "") || /"ok":true/.test(ctrl(pre, "set_updated_at dispara") || ""), L("control: el disparador set_updated_at sigue actualizando updated_at"));
  ok(d0(post, "set_updated_at por la API").error === "42501" && d0(pre, "set_updated_at por la API").error === "0A000", L("set_updated_at: antes sólo la frenaba «sólo como disparador» (0A000); ahora ni siquiera tiene EXECUTE (42501)"));
  ok(/"error":"42501"/.test(ctrl(post, "alumno: B inserta uno a nombre de A") || ""), L("aislamiento: B no puede insertar filas a nombre de A"));
  ok(ctrl(post, "tras eliminar: alumnos de A / de B") === "[0,1]", L("delete_own_account borra lo de A y deja lo de B"));
  ok(/"c":0/.test(ctrl(post, "B lee los alumnos de A") || ""), L("aislamiento: B ve 0 alumnos de A"));

  if (process.env.R5_DUMP) for (const o of post.out.filter((x) => !/^(A|B) lee /.test(x.step))) console.log("  ·", o.step.padEnd(46), o.out.slice(0, 150));
  // ---- lo que cambia a propósito: anónimo y registro
  const d = (o, name) => o.diffs.find((x) => x[0] === name)[1];
  for (const name of ["anon lee students", "anon lee payments", "anon lee el registro", "authenticated lee el registro"]) {
    ok(!d(pre, name).error, L(`antes: «${name}» no daba error de permiso`));
    ok(d(post, name).error === "42501", L(`después: «${name}» → permission denied (42501): ${JSON.stringify(d(post, name))}`));
  }
  ok(d(post, "anon inserta").error === "42501" && d(pre, "anon inserta").error === "42501", L("anon no puede insertar (antes lo frenaba RLS, ahora también los privilegios; mismo código 42501)"));
  ok(d(pre, "anon lee students").rows[0].c === 0, L("antes el anónimo veía 0 alumnos (sólo por RLS)"));
  ok(d(post, "anon llama una RPC").error === d(pre, "anon llama una RPC").error && d(post, "anon llama una RPC móvil").error === "42501", L("el anónimo sigue sin poder ejecutar RPC"));
  ok(d(pre, "authenticated con TRUNCATE/REFERENCES/TRIGGER en alguna tabla") === true && d(post, "authenticated con TRUNCATE/REFERENCES/TRIGGER en alguna tabla") === false, L("authenticated ya no tiene TRUNCATE/REFERENCES/TRIGGER en ninguna tabla"));

  // ---- catálogo: sólo cambia lo esperado
  const keyed = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r]));
  // RLS: la única diferencia es el registro
  const rlsB = keyed(catBefore.rls, "relname"), rlsA = keyed(catAfter.rls, "relname");
  const rlsDiff = Object.keys(rlsA).filter((t) => JSON.stringify(rlsA[t]) !== JSON.stringify(rlsB[t]));
  ok(JSON.stringify(rlsDiff) === JSON.stringify(["import_undo_dependency_registry"]) && rlsB.import_undo_dependency_registry.r === false && rlsA.import_undo_dependency_registry.r === true, L(`RLS: sólo cambia el registro (${rlsDiff.join(",")})`));
  ok(Object.values(rlsA).every((r) => r.r === true) && Object.keys(rlsA).length === 48, L("tras R5 las 48 tablas de public tienen RLS"));
  // Políticas: idénticas salvo roles
  const stripRoles = (p) => JSON.stringify(p.map((x) => ({ ...x, roles: undefined })));
  ok(stripRoles(catBefore.policies) === stripRoles(catAfter.policies), L("políticas: mismas políticas, mismo comando, USING y WITH CHECK (sólo cambian los roles)"));
  const publicPolicies = catAfter.policies.filter((p) => p.roles === "public");
  ok(publicPolicies.length === 0, L(`ninguna política TO public (${publicPolicies.length})`));
  ok(catBefore.policies.filter((p) => p.roles === "public").length === 34, L(`antes había 34 políticas TO public (había ${catBefore.policies.filter((p) => p.roles === "public").length})`));
  ok(catAfter.policies.filter((p) => p.roles === "authenticated").length === catAfter.policies.length, L("todas las políticas son TO authenticated"));
  // Privilegios de tabla
  const privMap = (rows) => { const m = {}; for (const r of rows) (m[r.relname] ||= {})[r.rolname] = r.privs.split(","); return m; };
  const pB = privMap(catBefore.tablePrivs), pA = privMap(catAfter.tablePrivs);
  const DEAD = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
  let anonLeft = 0, authBad = 0, authLost = [], svcChanged = 0;
  for (const t of Object.keys(pB)) {
    if (t === "import_undo_dependency_registry") continue;
    const beforeAuth = pB[t].authenticated || [], afterAuth = (pA[t] || {}).authenticated || [];
    const expected = beforeAuth.filter((p) => !DEAD.includes(p));
    if (JSON.stringify(afterAuth) !== JSON.stringify(expected)) authLost.push(t);
    if (afterAuth.some((p) => DEAD.includes(p))) authBad += 1;
    if (((pA[t] || {}).anon || []).length) anonLeft += 1;
    if (JSON.stringify((pB[t].service_role || [])) !== JSON.stringify(((pA[t] || {}).service_role || []))) svcChanged += 1;
  }
  ok(authLost.length === 0, L(`authenticated conserva EXACTAMENTE sus SELECT/INSERT/UPDATE/DELETE en todas las tablas (diferencias: ${authLost.join(",")})`));
  ok(authBad === 0, L("authenticated sin TRUNCATE/REFERENCES/TRIGGER/MAINTAIN en ninguna tabla"));
  ok(anonLeft === 0, L(`anon sin ningún privilegio en ninguna tabla (quedan ${anonLeft})`));
  ok(svcChanged === 0, L("service_role no cambia"));
  ok(!pA.import_undo_dependency_registry || (!pA.import_undo_dependency_registry.anon && !pA.import_undo_dependency_registry.authenticated), L("el registro no tiene privilegios para anon ni authenticated"));
  ok(JSON.stringify(catBefore.colPrivs) === JSON.stringify(catAfter.colPrivs) && catAfter.colPrivs.length > 10, L("privilegios por columna (students) idénticos"));
  // Funciones
  const fB = keyed(catBefore.functions, "sig"), fA = keyed(catAfter.functions, "sig");
  ok(Object.keys(fA).length === Object.keys(fB).length, L("mismas funciones (ninguna agregada ni eliminada)"));
  ok(Object.keys(fA).every((s) => fA[s].body === fB[s].body && fA[s].iface === fB[s].iface && fA[s].secdef === fB[s].secdef && fA[s].vol === fB[s].vol), L("cuerpos, firmas, retornos, SECURITY y volatilidad de TODAS las funciones idénticos"));
  const pending = Object.keys(fA).filter((s) => !/search_path=""/.test(fA[s].cfg || ""));
  ok(pending.length === 0, L(`todas las funciones de public tienen search_path vacío (faltan: ${pending.join(", ")})`));
  const execChanged = Object.keys(fA).filter((s) => fA[s].anon !== fB[s].anon || fA[s].auth !== fB[s].auth || fA[s].svc !== fB[s].svc);
  ok(JSON.stringify(execChanged) === JSON.stringify(["set_updated_at()"]), L(`EXECUTE: sólo cambia set_updated_at (${execChanged.join(",")})`));
  ok(fA["set_updated_at()"].anon === false && fA["set_updated_at()"].auth === false, L("set_updated_at sin EXECUTE para anon ni authenticated"));
  ok(Object.keys(fA).filter((s) => fA[s].secdef && /search_path=public/.test(fA[s].cfg || "")).length === 0, L("ninguna SECURITY DEFINER con search_path=public"));
  ok(JSON.stringify(catBefore.triggers) === JSON.stringify(catAfter.triggers), L("disparadores idénticos"));
  ok(catBefore.registryRows === catAfter.registryRows && catAfter.registryRows > 40, L("el registro conserva sus filas"));
  // Privilegios por defecto
  const defAfter = JSON.stringify(catAfter.defacl);
  ok(!/anon=/.test(defAfter.replace(/\\"/g, "")), L(`privilegios por defecto: nada para anon (${defAfter.slice(0, 160)})`));
  ok(/authenticated=[a-z]*/.test(defAfter), L("authenticated conserva sus privilegios por defecto de DML"));
  // Tablas nuevas nacen sin privilegios para anon
  await pg.admin.query("create table public.r5_probe (id int)");
  const probe = (await pg.admin.query("select has_table_privilege('anon', 'public.r5_probe', 'select') a, has_table_privilege('authenticated', 'public.r5_probe', 'select') b, has_table_privilege('authenticated', 'public.r5_probe', 'truncate') t")).rows[0];
  ok(probe.a === false && probe.b === true && probe.t === false, L(`una tabla nueva nace sin privilegios para anon ni TRUNCATE para authenticated (anon=${probe.a}, auth select=${probe.b}, truncate=${probe.t})`));
  await pg.admin.query("drop table public.r5_probe");
  // Idempotencia: reaplicar no cambia nada
  const snapA = JSON.stringify(await catalog(pg.admin));
  for (const f of R5) await pg.admin.query(read(f));
  ok(JSON.stringify(await catalog(pg.admin)) === snapA, L("reaplicar las tres migraciones no cambia nada (idempotente)"));
  ok(pg.failures.length === 0, L(`todas las migraciones se aplican sin error: ${JSON.stringify(pg.failures)}`));
}

const MUTATIONS = [
  ["no habilita RLS en el registro", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("alter table public.import_undo_dependency_registry enable row level security;", "")],
  ["no revoca el registro a authenticated", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("revoke all on public.import_undo_dependency_registry from public, anon, authenticated;", "revoke all on public.import_undo_dependency_registry from public, anon;")],
  ["no revoca nada a anon en las tablas", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("execute format('revoke all on table public.%I from anon', r.relname);", "null;")],
  ["no revoca TRUNCATE/REFERENCES/TRIGGER a authenticated", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.relname);", "null;")],
  ["revoca de más: SELECT a authenticated (rompe la aplicación)", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("revoke truncate, references, trigger on table", "revoke select, truncate, references, trigger on table")],
  ["revoca de más: INSERT/UPDATE/DELETE a authenticated", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("revoke truncate, references, trigger on table", "revoke insert, update, delete, truncate, references, trigger on table")],
  ["no ajusta los privilegios por defecto", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("alter default privileges for role postgres in schema public revoke all on tables from anon;", "")],
  ["no deja las tablas nuevas sin TRUNCATE", "20261009100000_r5_grants_hygiene.sql", (s) => s.replace("alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;", "")],
  ["no cambia las políticas a authenticated", "20261009110000_r5_policies_to_authenticated.sql", (s) => s.replace("to authenticated', r.policyname", "to public', r.policyname")],
  ["cambia las políticas a anon", "20261009110000_r5_policies_to_authenticated.sql", (s) => s.replace("to authenticated', r.policyname", "to anon', r.policyname")],
  ["política sin filtro de roles (toca todas)", "20261009110000_r5_policies_to_authenticated.sql", (s) => s.replace("and p.roles = array['public']::name[]", "and p.policyname like '%_owner_all'")],
  ["no fija el search_path de las móviles", "20261009120000_r5_function_search_path.sql", (s) => s.replace("'public.delete_own_account()',", "")],
  ["fija search_path = public en vez de vacío", "20261009120000_r5_function_search_path.sql", (s) => s.replace("set search_path = %L', v_signature, '')", "set search_path = %L', v_signature, 'public')")],
  ["omite las funciones de calendario", "20261009120000_r5_function_search_path.sql", (s) => s.replace("'public.split_recurrence_this_and_future(jsonb)',", "")],
  ["no revoca EXECUTE de set_updated_at", "20261009120000_r5_function_search_path.sql", (s) => s.replace("revoke all on function public.set_updated_at() from public, anon, authenticated;", "")],
  ["revoca EXECUTE de una RPC que la web usa", "20261009120000_r5_function_search_path.sql", (s) => s.replace("revoke all on function public.set_updated_at() from public, anon, authenticated;", "revoke all on function public.set_updated_at() from public, anon, authenticated;\nrevoke all on function public.create_calendar_lesson(jsonb) from authenticated;")],
];

async function main() {
  const run = async (label, overrides = {}) => {
    const pg = await start({ port: 5460 + (process.pid % 200), upTo: LAST_BEFORE });
    try {
      try {
        await runChecks(pg, label, async () => {
        for (const f of R5) {
          try { await pg.admin.query(overrides[f] ?? read(f)); } catch (e) { ok(false, `[${label}] la migración ${f} falló: ${String(e.message).slice(0, 120)}`); }
        }
        });
      } catch (e) {
        ok(false, `[${label}] la batería se interrumpió (la aplicación dejó de funcionar o el catálogo no es el esperado): ${String((e && e.message) || e).slice(0, 120)}`);
      }
    } finally { await pg.stop(); }
    return { checks, failures: [...failures] };
  };
  const first = await run("base");
  console.log(`R5 higiene: ${first.checks} comprobaciones, ${first.failures.length} fallas`);
  for (const f of first.failures) console.log(" ✗", f);
  let bad = first.failures.length > 0;
  if (process.argv.includes("--mutations")) {
    const results = [];
    for (const [name, file, mutate] of MUTATIONS) {
      const original = read(file);
      const mutated = mutate(original);
      if (mutated === original) { results.push([name, "ERROR (el parche no encontró su patrón)"]); continue; }
      checks = 0;
      const r = await run(name, { [file]: mutated });
      results.push([name, r.failures.length > 0 ? `DETECTADA (${r.failures.length})` : "NO DETECTADA"]);
    }
    for (const [n, r] of results) console.log((r.startsWith("DETECTADA") ? "DETECTADA   " : "FALLA       ") + n + "  <- " + r);
    const missed = results.filter(([, r]) => !r.startsWith("DETECTADA"));
    console.log(`\n${results.length - missed.length}/${results.length} mutaciones detectadas`);
    if (missed.length) bad = true;
  }
  process.exitCode = bad ? 1 : 0;
}
main().catch((e) => { console.error("ERROR", e && e.stack || e); process.exit(2); });
