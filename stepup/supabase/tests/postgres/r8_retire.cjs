// R8 — Retiro de `claim_student_creation()`, `create_student_via_web(uuid, jsonb, boolean)` y de la compatibilidad `endDate` del split, en Postgres REAL (varias
// conexiones, rol `authenticated` con `auth.uid()`), datos SINTÉTICOS. Nunca toca Production.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   node supabase/tests/postgres/r8_retire.cjs                 (batería)
//   node supabase/tests/postgres/r8_retire.cjs --rehearsal     (ensayo de la migración sobre el estado ANTERIOR: BEGIN…ROLLBACK, idempotencia, compatibilidad, rollback)
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R8 = fs.readdirSync(DIR).filter((f) => /^20261012\d{6}_r8_/.test(f)).sort();
const LAST_BEFORE = fs.readdirSync(DIR).filter((f) => f < R8[0]).sort().pop();
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r8_retire_rollback.sql"), "utf8");
const A = "00000000-0000-4000-8000-0000000000a8";
const B = "00000000-0000-4000-8000-0000000000b8";
const RULE = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const SUCC = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const STU = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
async function fails(fn, pattern, name) {
  try { await fn(); check(name, false, "no falló"); return null; }
  catch (e) { check(name, pattern.test(String(e.code)) || pattern.test(String(e.message)), `${e.code} ${String(e.message).slice(0, 120)}`); return e; }
}
const rows = async (c, sql, p = []) => (await c.query(sql, p)).rows;

const weeks = JSON.stringify([{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }]);
const splitPayload = (n, patch, extra = {}) => ({
  original_recurrence_id: RULE(n), effective_date: "2026-11-16", original_patch: patch, successor_id: SUCC(n), successor_start_date: "2026-11-16", successor_end_date: null,
  rule_type: "weekly", cycle_length_weeks: 1, weeks: JSON.parse(weeks), participant_ids: [STU(1)], primary_student_id: STU(1), excluded_occurrence_keys: [], ...extra,
});
const split = (s, payload) => s.query(`select public.split_recurrence_this_and_future($1::jsonb)`, [JSON.stringify(payload)]);
const studentPayload = (name) => JSON.stringify({ name, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [] });
const createStudent = (s, op, name, confirm = false) => s.query(`select * from public.create_student_with_operation($1::uuid, $2::jsonb, $3)`, [op, studentPayload(name), confirm]);

async function seed(admin) {
  for (const id of [A, B]) {
    await admin.query(`delete from auth.users where id = $1`, [id]);
    await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.invalid`]);
  }
  await admin.query(`insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values ($1, $2, 'Alumno Uno', 'presencial', 'otro', 'mensual', '2026-01-01', 10000)`, [STU(1), A]);
  for (let n = 1; n <= 6; n += 1) {
    await admin.query(`insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values ($1, $2, $3, 'weekly', 1, $4::jsonb, 'presencial', 'UTC', '2026-10-05', 'active')`, [RULE(n), A, STU(1), weeks]);
    await admin.query(`insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values ($1, $2, $3)`, [A, RULE(n), STU(1)]);
  }
}

async function battery(pg) {
  const admin = pg.admin;
  await seed(admin);
  const sA = await pg.session(A);
  const sB = await pg.session(B);

  // ---- Funciones retiradas ----
  const gone = await rows(admin, `select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_student_creation', 'create_student_via_web')`);
  check("las dos funciones del alta por borrador ya no existen", gone.length === 0, JSON.stringify(gone));
  await fails(() => sA.query(`select * from public.claim_student_creation()`), /42883|does not exist/, "llamar a claim_student_creation() falla (la función no existe)");
  await fails(() => sA.query(`select * from public.create_student_via_web(gen_random_uuid(), '{}'::jsonb, false)`), /42883|does not exist/, "llamar a create_student_via_web() falla (la función no existe)");
  const dep = await rows(admin, `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.prosrc ilike '%claim_student_creation%' or p.prosrc ilike '%create_student_via_web%')`);
  check("ninguna función restante las referencia", dep.length === 0, JSON.stringify(dep));

  // ---- El alta nueva y la tabla de claims no se tocaron ----
  check("create_student_with_operation sigue existiendo: authenticated sí, anon no", (await rows(admin, `select has_function_privilege('authenticated', 'public.create_student_with_operation(uuid,jsonb,boolean)', 'execute') a, has_function_privilege('anon', 'public.create_student_with_operation(uuid,jsonb,boolean)', 'execute') n`))[0].a === true
    && (await rows(admin, `select has_function_privilege('anon', 'public.create_student_with_operation(uuid,jsonb,boolean)', 'execute') n`))[0].n === false);
  check("la tabla student_creation_claims y su índice por operación siguen", (await rows(admin, `select count(*)::int n from pg_indexes where schemaname = 'public' and indexname = 'student_creation_claims_owner_operation_uidx'`))[0].n === 1);
  const op = "11111111-1111-4111-8111-111111111111";
  const r1 = (await createStudent(sA, op, "Alta Nueva")).rows[0];
  check("alta nueva: crea el alumno", r1.status === "created" && r1.replayed === false && !!r1.student_id, JSON.stringify(r1));
  const r2 = (await createStudent(sA, op, "Alta Nueva")).rows[0];
  check("alta nueva: respuesta perdida y reintento devuelven el MISMO alumno, sin duplicar", r2.replayed === true && r2.student_id === r1.student_id && (await rows(admin, `select count(*)::int n from public.students where owner_id = $1 and name = 'Alta Nueva'`, [A]))[0].n === 1);
  const rb = (await createStudent(sB, op, "Alta de B")).rows[0];
  check("alta nueva: la MISMA clave en otra propietaria es otra operación (aislamiento)", rb.status === "created" && rb.student_id !== r1.student_id && (await rows(admin, `select count(*)::int n from public.students where owner_id = $1`, [B]))[0].n === 1);
  const beforeClaims = (await rows(admin, `select count(*)::int n from public.student_creation_claims`))[0].n;
  await fails(() => sA.query(`select * from public.create_student_with_operation($1::uuid, '{"name":""}'::jsonb, false)`, ["22222222-2222-4222-8222-222222222222"]), /./, "alta nueva: un payload inválido se rechaza");
  check("alta nueva: el rechazo no deja ningún claim huérfano", (await rows(admin, `select count(*)::int n from public.student_creation_claims`))[0].n === beforeClaims);

  // ---- split: sólo `end_date` ----
  check("split: conserva privilegios (authenticated sí, anon no) y el search_path vacío de R5", (await rows(admin, `select has_function_privilege('anon', 'public.split_recurrence_this_and_future(jsonb)', 'execute') a, has_function_privilege('authenticated', 'public.split_recurrence_this_and_future(jsonb)', 'execute') u, coalesce(p.proconfig @> array['search_path=""'], false) sp from pg_proc p where p.oid = 'public.split_recurrence_this_and_future(jsonb)'::regprocedure`))
    .every((r) => r.a === false && r.u === true && r.sp === true));
  await split(sA, splitPayload(1, { status: "active", end_date: "2026-11-15" }));
  const o1 = (await rows(admin, `select end_date::text d, status from public.recurrence_rules where id = $1`, [RULE(1)]))[0];
  check("split con end_date (canónica): la original queda activa con su fin", o1.d === "2026-11-15" && o1.status === "active");
  check("split con end_date: nace la sucesora y la original apunta a ella", (await rows(admin, `select superseded_by_recurrence_id::text s from public.recurrence_rules where id = $1`, [RULE(1)]))[0].s === SUCC(1));

  const e2 = await fails(() => split(sA, splitPayload(2, { status: "active", endDate: "2026-11-15" })), /22023|No se puede determinar la fecha de fin/, "split con SÓLO endDate (clave retirada): se rechaza (22023)");
  void e2;
  const o2 = (await rows(admin, `select end_date::text d, status, superseded_by_recurrence_id::text s from public.recurrence_rules where id = $1`, [RULE(2)]))[0];
  check("split con SÓLO endDate: no se escribe nada (la original intacta, sin sucesora)", o2.d === null && o2.status === "active" && o2.s === null && (await rows(admin, `select count(*)::int n from public.recurrence_rules where id = $1`, [SUCC(2)]))[0].n === 0);

  await split(sA, splitPayload(3, { status: "active", end_date: "2026-11-15", endDate: "2026-11-01" }));
  check("split con las dos claves: gana end_date y endDate se ignora", (await rows(admin, `select end_date::text d from public.recurrence_rules where id = $1`, [RULE(3)]))[0].d === "2026-11-15");

  await fails(() => split(sA, splitPayload(4, { status: "active" })), /22023/, "split sin ninguna fecha de fin y original activa: se rechaza (22023)");
  await fails(() => split(sA, splitPayload(4, { status: "active", end_date: "2026-11-16" })), /22023/, "el fin igual a la fecha efectiva se rechaza");
  await fails(() => split(sA, splitPayload(4, { status: "active", end_date: "2026-09-30" })), /22023/, "el fin anterior al inicio de la serie se rechaza");
  await fails(() => split(sA, splitPayload(4, { status: "paused", end_date: "2026-11-15" })), /22023/, "un status distinto de active/ended se rechaza");
  check("los rechazos no escribieron nada", (await rows(admin, `select count(*)::int n from public.recurrence_rules where id = $1 or superseded_by_recurrence_id is not null and id = $1`, [SUCC(4)]))[0].n === 0 && (await rows(admin, `select end_date from public.recurrence_rules where id = $1`, [RULE(4)]))[0].end_date === null);
  await split(sA, splitPayload(5, { status: "ended", end_date: null }, { effective_date: "2026-11-30", successor_start_date: "2026-11-30" }));
  check("status ended sin end_date: se acepta y la original queda finalizada", (await rows(admin, `select status from public.recurrence_rules where id = $1`, [RULE(5)]))[0].status === "ended");
  const again = await split(sA, splitPayload(1, { status: "active", end_date: "2026-11-15" }, { successor_id: SUCC(99) }));
  check("split repetido (misma sucesora existente): idempotente, no crea otra", again.rowCount === 1 && (await rows(admin, `select count(*)::int n from public.recurrence_rules where supersedes_recurrence_id = $1`, [RULE(1)]))[0].n === 1);
  await fails(() => split(sB, splitPayload(6, { status: "active", end_date: "2026-11-15" })), /P0002|no encontrada|no te pertenece/i, "otra propietaria no puede dividir la serie ajena (aislamiento)");
  check("…y la serie ajena quedó intacta", (await rows(admin, `select end_date from public.recurrence_rules where id = $1`, [RULE(6)]))[0].end_date === null);

  await sA.end();
  await sB.end();
}

const PUBLIC_BEFORE = ["claim_student_creation", "create_student_via_web", "split_recurrence_this_and_future"];

async function inventory(admin) {
  const one = async (sql) => (await admin.query(sql)).rows;
  const tables = await one(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const data = {};
  for (const { table_name: t } of tables) data[t] = (await one(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h from public.${t} x`))[0];
  const funcs = Object.fromEntries((await one(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig, md5(replace(pg_get_functiondef(p.oid), chr(13), '') || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || p.prosecdef::text) h from pg_proc p where p.pronamespace = 'public'::regnamespace`)).map((r) => [r.sig, r.h]));
  const meta = {
    triggers: (await one(`select md5(string_agg(tgrelid::regclass::text || tgname || tgenabled::text, '|' order by tgrelid::regclass::text, tgname)) h from pg_trigger where not tgisinternal`))[0],
    policies: (await one(`select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) h from pg_policies where schemaname = 'public'`))[0],
    indexes: (await one(`select md5(string_agg(indexdef, '|' order by indexname)) h from pg_indexes where schemaname = 'public'`))[0],
    tableAcl: (await one(`select md5(string_agg(c.relname || coalesce(c.relacl::text, ''), '|' order by c.relname)) h from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`))[0],
  };
  return { data, funcs, meta };
}
const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

async function rehearsal() {
  const pg = await start({ port: 5801, upTo: LAST_BEFORE });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  check("hay 1 migración R8 y la base de partida es la anterior a R8 (todas las migraciones previas)", R8.length === 1 && !!LAST_BEFORE, `${R8.length} / ${LAST_BEFORE}`);
  await seed(admin);
  const sA = await pg.session(A);
  // Con el código ANTERIOR: un claim y un alta por el camino viejo, y un split con sólo `endDate` (la compatibilidad vigente).
  const old = (await sA.query(`select * from public.claim_student_creation()`)).rows[0];
  const oldCreate = (await sA.query(`select * from public.create_student_via_web($1::uuid, $2::jsonb, false)`, [old.claim_id, studentPayload("Viejo Camino")])).rows[0];
  check("estado de partida: el alta por borrador funciona", oldCreate.status === "created");
  await split(sA, splitPayload(2, { status: "active", endDate: "2026-11-15" }));
  check("estado de partida: el split acepta endDate", (await rows(admin, `select end_date::text d from public.recurrence_rules where id = $1`, [RULE(2)]))[0].d === "2026-11-15");
  const baseline = await inventory(admin);

  await admin.query("begin");
  for (const f of R8) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const inside = await inventory(admin);
  const changed = diffKeys(baseline.funcs, inside.funcs);
  check("ensayo: los DATOS quedan idénticos (todas las tablas: conteo y huella)", diffKeys(baseline.data, inside.data).length === 0, diffKeys(baseline.data, inside.data).join(","));
  check("ensayo: sólo cambian las 3 funciones previstas (2 desaparecen, el split se redefine) y ninguna otra", JSON.stringify(changed.map((k) => k.split("(")[0]).sort()) === JSON.stringify([...PUBLIC_BEFORE].sort()), changed.join(","));
  check("ensayo: disparadores, políticas, índices y privilegios de tablas idénticos", JSON.stringify(baseline.meta) === JSON.stringify(inside.meta));
  await admin.query("rollback");
  const reverted = await inventory(admin);
  check("ensayo REVERTIDO: la base vuelve EXACTAMENTE a la huella inicial", JSON.stringify(reverted) === JSON.stringify(baseline));

  for (const f of R8) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const once = await inventory(admin);
  for (const f of R8) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const twice = await inventory(admin);
  check("aplicada dos veces: nada cambia (idempotente)", JSON.stringify(once) === JSON.stringify(twice));
  check("aplicada: los datos siguen idénticos (los alumnos creados por el camino viejo y sus claims se conservan)", diffKeys(baseline.data, once.data).length === 0 && (await rows(admin, `select count(*)::int n from public.students where name = 'Viejo Camino'`))[0].n === 1);
  // Lo creado antes sigue funcionando con la versión nueva.
  const sA2 = await pg.session(A);
  const op = "33333333-3333-4333-8333-333333333333";
  const nuevo = (await createStudent(sA2, op, "Después de R8")).rows[0];
  check("compatibilidad: el alta nueva funciona sobre una base que ya tenía claims del camino viejo", nuevo.status === "created");
  await fails(() => split(sA2, splitPayload(3, { status: "active", endDate: "2026-11-15" })), /22023/, "el split ya no acepta endDate");
  await sA2.end();

  await admin.query(ROLLBACK);
  const rolled = await inventory(admin);
  const stillDiff = Object.entries(baseline.funcs).filter(([k, h]) => rolled.funcs[k] !== h).map(([k]) => k);
  check("rollback: las 3 funciones vuelven a su cuerpo, privilegios y configuración ANTERIORES exactos", stillDiff.length === 0, stillDiff.join(","));
  const sA3 = await pg.session(A);
  const c3 = (await sA3.query(`select * from public.claim_student_creation()`)).rows[0];
  check("rollback: con las funciones anteriores el alta por borrador vuelve a funcionar", !!c3.claim_id);
  await split(sA3, splitPayload(4, { status: "active", endDate: "2026-11-15" }));
  check("rollback: …y el split vuelve a aceptar endDate", (await rows(admin, `select end_date::text d from public.recurrence_rules where id = $1`, [RULE(4)]))[0].d === "2026-11-15");
  await sA.end(); await sA3.end();
  await pg.stop();
}

async function main() {
  if (process.argv.includes("--rehearsal")) {
    await rehearsal();
  } else {
    const pg = await start({ port: 5802 });
    if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
    await battery(pg);
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
