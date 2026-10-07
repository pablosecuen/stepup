// R3 — Cuotas y límites de uso, sobre Postgres REAL con varias conexiones simultáneas (todas las migraciones reales).
//   NODE_PATH=<epg>/node_modules node supabase/tests/postgres/r3_quotas.cjs [--mutations]
// Con `--mutations` se rompe cada control a propósito (sin lock, límite +1, sin filtro de propietaria, disparador BEFORE, sin filtro de
// categoría, sin override…) y se exige que las pruebas lo detecten.
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";
const MIG = path.join(__dirname, "..", "..", "migrations");
const INFRA = fs.readFileSync(path.join(MIG, "20261007100000_r3_quota_infrastructure.sql"), "utf8");

let failures = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) failures.push(msg); return !!cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function expectError(promise, { code, message, detail }, label) {
  try {
    await promise;
    ok(false, `${label}: debía fallar con ${message} (${detail}) y no falló`);
    return false;
  } catch (e) {
    const good = e.code === code && (message === undefined || e.message === message) && (detail === undefined || e.detail === detail);
    ok(good, `${label}: error ${e.code}/${e.message}/${e.detail} (esperado ${code}/${message}/${detail})`);
    return good;
  }
}
const QUOTA = (detail, message = "quota_exceeded") => ({ code: "53400", message, detail });

const studentInsert = (name) => `insert into public.students (owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
  values (auth.uid(), '${name}', 'online', 'activo', 'otro', 'mensual', '2026-01-01', 1000, 'A1', '{}')`;
const adminStudent = (owner, name) => ({ text: `insert into public.students (owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels) values ($1, $2, 'online','activo','otro','mensual','2026-01-01',1000,'A1','{}') returning id`, values: [owner, name] });
const payload = (name) => JSON.stringify({ name, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [] });

async function count(admin, table, owner, where = "true") {
  return Number((await admin.query(`select count(*)::int c from public.${table} where owner_id = $1 and (${where})`, [owner])).rows[0].c);
}
async function setOverride(admin, owner, key, field, value) {
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, ${field}) values ($1, $2, $3)
    on conflict (owner_id, quota_key) do update set ${field} = excluded.${field}`, [owner, key, value]);
}
async function clearOverrides(admin) { await admin.query("delete from public.account_quota_overrides"); }
async function wipe(admin) {
  await admin.query(`truncate public.report_records, public.student_creation_claims, public.calendar_lessons, public.payment_allocations, public.payments, public.payment_charges,
    public.lesson_registrations, public.custom_levels, public.account_action_events, public.import_previews restart identity cascade`);
  await admin.query("delete from public.students");
}
async function fingerprint(admin, owner) {
  const out = {};
  for (const t of ["students", "student_creation_claims", "calendar_lessons", "payments", "payment_charges", "payment_allocations", "custom_levels", "report_records", "lesson_registrations", "account_action_events", "student_status_history"]) {
    const col = t === "account_action_events" ? "owner_id" : "owner_id";
    out[t] = (await admin.query(`select count(*)::int c, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public.${t} x where ${col} = $1`, [owner])).rows[0];
  }
  return JSON.stringify(out);
}

async function runChecks(pg, label) {
  failures = [];
  const { admin } = pg;
  await wipe(admin);
  await clearOverrides(admin);
  const L = (msg) => `[${label}] ${msg}`;

  // ------------------------------------------------------------------------------------------------------------- límite -1 / exacto / +1
  await setOverride(admin, A, "students", "max_total", 5);
  const a1 = await pg.session(A);
  for (let i = 1; i <= 4; i += 1) await a1.query(studentInsert(`Alumno ${i}`));
  ok((await count(admin, "students", A)) === 4, L("límite-1: 4 alumnos"));
  await a1.query(studentInsert("Alumno 5"));
  ok((await count(admin, "students", A)) === 5, L("límite exacto: el 5º entra"));
  await expectError(a1.query(studentInsert("Alumno 6")), QUOTA("students"), L("límite+1 (INSERT directo como authenticated)"));
  ok((await count(admin, "students", A)) === 5, L("límite+1: no quedó ninguna fila (rollback)"));

  // ------------------------------------------------------------------------------------------------------------- RPC, rollback, idempotencia
  const before = await fingerprint(admin, A);
  const op1 = "11111111-1111-4111-8111-111111111111";
  await expectError(a1.query("select * from public.create_student_with_operation($1::uuid, $2::jsonb, false)", [op1, payload("Nuevo RPC")]), QUOTA("students"), L("RPC create_student_with_operation en el tope"));
  ok((await fingerprint(admin, A)) === before, L("RPC rechazada: huellas idénticas — ningún claim ni alumno quedó (rollback completo, cero residuos)"));
  ok((await count(admin, "student_creation_claims", A)) === 0, L("RPC rechazada: 0 claims"));

  await setOverride(admin, A, "students", "max_total", 6);
  const r1 = (await a1.query("select * from public.create_student_with_operation($1::uuid, $2::jsonb, false)", [op1, payload("Alumno Seis")])).rows[0];
  ok(r1.status === "created" && r1.replayed === false, L("RPC con 1 lugar libre: crea (6 de 6)"));
  const fpAtLimit = await fingerprint(admin, A);
  const r1b = (await a1.query("select * from public.create_student_with_operation($1::uuid, $2::jsonb, false)", [op1, payload("Alumno Seis")])).rows[0];
  ok(r1b.replayed === true && r1b.student_id === r1.student_id, L("reintento con la MISMA clave en el tope: devuelve el mismo alumno (no consume ni falla)"));
  ok((await fingerprint(admin, A)) === fpAtLimit, L("reintento idempotente: huellas idénticas (no consumió cuota)"));
  await expectError(a1.query("select * from public.create_student_with_operation($1::uuid, $2::jsonb, false)", ["22222222-2222-4222-8222-222222222222", payload("Otro Distinto")]), QUOTA("students"), L("clave NUEVA en el tope"));

  // ------------------------------------------------------------------------------------------------------------- otra categoría y otra cuenta
  const customs = await a1.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel X') returning id");
  ok(customs.rows.length === 1, L("una categoría agotada (alumnos) no bloquea otra (niveles)"));
  const readable = (await a1.query("select count(*)::int c from public.students")).rows[0].c;
  ok(readable === 6, L("con la cuota agotada las lecturas siguen funcionando"));
  await a1.query("update public.students set notes = 'editado' where owner_id = auth.uid()");
  ok(true, L("con la cuota agotada las ediciones siguen funcionando"));
  const b1 = await pg.session(B);
  for (let i = 1; i <= 8; i += 1) await b1.query(studentInsert(`B Alumno ${i}`));
  ok((await count(admin, "students", B)) === 8, L("la cuenta B (sin override) no comparte contador con A"));
  ok((await count(admin, "students", A)) === 6, L("A sigue en 6"));

  // ------------------------------------------------------------------------------------------------------------- cuenta por encima de un límite nuevo
  await setOverride(admin, A, "students", "max_total", 3); // A ya tiene 6
  await expectError(a1.query(studentInsert("Alumno 7")), QUOTA("students"), L("cuenta por encima del límite nuevo: no puede crear más alumnos"));
  ok((await a1.query("select count(*)::int c from public.students")).rows[0].c === 6, L("cuenta por encima del límite: conserva y lee todo lo que ya tiene"));
  ok((await a1.query("update public.students set notes = 'otra edición' where owner_id = auth.uid() returning id")).rowCount === 6, L("cuenta por encima del límite: puede seguir editando"));
  await a1.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel Y')");
  ok(true, L("cuenta por encima del límite de alumnos: puede crear en otras categorías"));

  // niveles personalizados (se pueden borrar): bajar bajo el tope vuelve a permitir exactamente hasta el tope
  await setOverride(admin, A, "custom_levels", "max_total", 3);
  await a1.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel Z')");
  ok((await count(admin, "custom_levels", A)) === 3, L("niveles: llegó al tope exacto (3)"));
  await expectError(a1.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel W')"), QUOTA("custom_levels"), L("niveles: +1"));
  await a1.query("delete from public.custom_levels where owner_id = auth.uid() and name = 'Nivel Z'");
  await a1.query("insert into public.custom_levels (owner_id, name) values (auth.uid(), 'Nivel W')");
  ok((await count(admin, "custom_levels", A)) === 3, L("niveles: al borrar uno se puede crear otro (la cuota se libera)"));

  // ------------------------------------------------------------------------------------------------------------- concurrencia: la última unidad
  await clearOverrides(admin);
  await wipe(admin);
  await setOverride(admin, A, "students", "max_total", 5);
  for (let i = 1; i <= 4; i += 1) await admin.query(adminStudent(A, `Pre ${i}`));
  const c1 = await pg.session(A);
  const c2 = await pg.session(A);
  const tx = async (client, name, holdMs) => {
    await client.query("begin");
    try {
      await client.query(studentInsert(name));
      await sleep(holdMs);
      await client.query("commit");
      return "ok";
    } catch (e) {
      await client.query("rollback");
      return e.code === "53400" ? "cuota" : `error:${e.code}`;
    }
  };
  const [r_a, r_b] = await Promise.all([tx(c1, "Carrera 1", 700), sleep(150).then(() => tx(c2, "Carrera 2", 0))]);
  ok([r_a, r_b].sort().join() === "cuota,ok", L(`dos conexiones por la última unidad: exactamente una entra (${r_a}/${r_b})`));
  ok((await count(admin, "students", A)) === 5, L("tras la carrera: 5 alumnos (nunca 6)"));

  // 8 conexiones por las 3 últimas unidades
  await wipe(admin);
  await setOverride(admin, A, "students", "max_total", 7);
  for (let i = 1; i <= 4; i += 1) await admin.query(adminStudent(A, `Pre ${i}`));
  const many = await Promise.all(Array.from({ length: 8 }, () => pg.session(A)));
  const outcomes = await Promise.all(many.map((c, i) => tx(c, `Par ${i}`, 300)));
  ok(outcomes.filter((x) => x === "ok").length === 3 && outcomes.filter((x) => x === "cuota").length === 5, L(`8 conexiones por 3 lugares: 3 entran y 5 reciben cuota (${outcomes.join(",")})`));
  ok((await count(admin, "students", A)) === 7, L("8 conexiones: 7 alumnos en total"));
  for (const c of many) await c.end();

  // dos propietarias en paralelo: A en el tope, B libre, sin bloquearse
  await wipe(admin);
  await clearOverrides(admin);
  await setOverride(admin, A, "students", "max_total", 2);
  await setOverride(admin, B, "students", "max_total", 50);
  const pa = await Promise.all(Array.from({ length: 4 }, () => pg.session(A)));
  const pb = await Promise.all(Array.from({ length: 4 }, () => pg.session(B)));
  const t0 = Date.now();
  const res = await Promise.all([...pa.map((c, i) => tx(c, `PA ${i}`, 500)), ...pb.map((c, i) => tx(c, `PB ${i}`, 500))]);
  const elapsed = Date.now() - t0;
  ok(res.slice(0, 4).filter((x) => x === "ok").length === 2 && res.slice(4).every((x) => x === "ok"), L(`A (límite 2) y B en paralelo: A ${res.slice(0, 4).join(",")}; B ${res.slice(4).join(",")}`));
  ok(elapsed < 3200, L(`B no esperó a A: ${elapsed} ms en total con 8 transacciones de 500 ms (A y B en paralelo ≈ 2 s; serializadas serían ≥ 4 s)`));
  ok((await count(admin, "students", A)) === 2 && (await count(admin, "students", B)) === 4, L("conteos finales A=2, B=4"));
  for (const c of [...pa, ...pb]) await c.end();

  // Una cuenta con una transacción larga que tiene su lock NO frena a otra cuenta
  await wipe(admin);
  await clearOverrides(admin);
  const slowB = await pg.session(B);
  const fastA = await pg.session(A);
  const holder = (async () => { await slowB.query("begin"); await slowB.query(studentInsert("B lento")); await sleep(1800); await slowB.query("commit"); })();
  await sleep(250);
  const tA = Date.now();
  await fastA.query(studentInsert("A rápido"));
  const waitedA = Date.now() - tA;
  await holder;
  ok(waitedA < 700, L(`otra cuenta no espera el lock de B: A tardó ${waitedA} ms mientras B retenía su transacción 1,8 s`));
  await slowB.end(); await fastA.end();

  // ------------------------------------------------------------------------------------------------------------- ON CONFLICT DO NOTHING (reintento de ensure_monthly_charges) en el tope
  await wipe(admin);
  await clearOverrides(admin);
  const s1 = (await admin.query(adminStudent(A, "Cobro 1"))).rows[0].id;
  const s2 = (await admin.query(adminStudent(A, "Cobro 2"))).rows[0].id;
  const s3 = (await admin.query(adminStudent(A, "Cobro 3"))).rows[0].id;
  const ensure = (c, ids) => c.query("select public.ensure_monthly_charges('2026-10', $1::jsonb) as n", [JSON.stringify(ids.map((id) => ({ student_id: id, amount: 1000, due_date: "2026-10-10" })))]);
  const e1 = await pg.session(A);
  const first = await ensure(e1, [s1, s2]);
  ok(first.rows[0].n === 2, L("ensure_monthly_charges crea 2 cargos"));
  await setOverride(admin, A, "payment_charges", "max_total", 2);
  const again = await ensure(e1, [s1, s2]);
  ok(again.rows[0].n === 0, L("ensure_monthly_charges repetido EN el tope: 0 nuevos y SIN error (el reintento idempotente no consume ni falla)"));
  await expectError(ensure(e1, [s1, s2, s3]), QUOTA("payment_charges"), L("ensure_monthly_charges con un candidato nuevo en el tope"));
  ok((await count(admin, "payment_charges", A)) === 2, L("ensure rechazado: sigue habiendo 2 cargos (rollback)"));

  // ------------------------------------------------------------------------------------------------------------- categorías con filtro y límites por hora
  await wipe(admin);
  await clearOverrides(admin);
  const st = (await admin.query(adminStudent(A, "Clases"))).rows[0].id;
  const lesson = (start, status) => ({ text: `insert into public.calendar_lessons (owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color) values ($1, $2, 'X', 'A1', 'individual', $3::timestamptz, $3::timestamptz + interval '1 hour', 'online', $4, '#DDEEFF')`, values: [A, st, start, status] });
  await setOverride(admin, A, "calendar_lessons_future", "max_total", 2);
  const future = (n) => new Date(Date.now() + (n + 1) * 86400000).toISOString();
  await admin.query(lesson(future(1), "scheduled"));
  await admin.query(lesson(future(2), "scheduled"));
  await expectError(admin.query(lesson(future(3), "scheduled")), QUOTA("calendar_lessons_future"), L("clases futuras: la 3ª programada falla en el tope de 2"));
  await admin.query(lesson("2026-01-05T10:00:00Z", "completed"));
  ok((await count(admin, "calendar_lessons", A)) === 3, L("clases futuras: una clase PASADA entra aunque el tope de futuras esté lleno"));
  await setOverride(admin, A, "calendar_lessons_future", "max_total", 1); // ahora hay 2 futuras > 1
  await admin.query(lesson("2026-01-06T10:00:00Z", "completed"));
  ok(true, L("cuenta con más futuras que el límite nuevo: puede registrar clases pasadas"));
  await expectError(admin.query(lesson(future(9), "scheduled")), QUOTA("calendar_lessons_future"), L("cuenta por encima del límite de futuras: no puede programar otra futura"));

  // claims pendientes
  await setOverride(admin, A, "student_creation_claims_pending", "max_total", 2);
  const pending = (expires) => ({ text: `insert into public.student_creation_claims (owner_id, status, operation_id, expires_at) values ($1, 'pending', gen_random_uuid(), $2::timestamptz)`, values: [A, expires] });
  const inFuture = new Date(Date.now() + 600000).toISOString();
  await admin.query(pending(inFuture));
  await admin.query(pending(inFuture));
  await expectError(admin.query(pending(inFuture)), QUOTA("student_creation_claims_pending"), L("claims pendientes: el 3º vigente falla"));
  await admin.query(pending(new Date(Date.now() - 600000).toISOString()));
  ok(true, L("claims pendientes: uno YA VENCIDO no cuenta contra el límite de vigentes"));
  const creat = (await admin.query({ text: `insert into public.student_creation_claims (owner_id, status, student_id, operation_id) values ($1, 'created', $2, gen_random_uuid()) returning id`, values: [A, st] })).rowCount;
  ok(creat === 1, L("claims: crear uno ya 'creado' no cuenta como pendiente"));

  // límite por hora en reportes
  await wipe(admin);
  await clearOverrides(admin);
  const sr = (await admin.query(adminStudent(A, "Reportes"))).rows[0].id;
  const report = (genAt) => ({ text: `insert into public.report_records (owner_id, student_id, title, period_start, period_end, snapshot, generated_at) values ($1, $2, 'R', '2026-09-01', '2026-09-30', '{}'::jsonb, $3::timestamptz)`, values: [A, sr, genAt] });
  await setOverride(admin, A, "report_records", "max_per_hour", 3);
  for (let i = 0; i < 3; i += 1) await admin.query(report(new Date().toISOString()));
  await expectError(admin.query(report(new Date().toISOString())), QUOTA("report_records", "quota_rate_exceeded"), L("reportes: el 4º en una hora falla (por hora)"));
  await admin.query(report(new Date(Date.now() - 2 * 3600 * 1000).toISOString()));
  ok(true, L("reportes: uno con generated_at de hace 2 h no cuenta en la ventana de la hora (pero sí en el total)"));
  ok((await count(admin, "report_records", A)) === 4, L("reportes: 3 recientes + 1 antiguo"));

  // ------------------------------------------------------------------------------------------------------------- tamaño de fila
  const big = (bytes) => `'{"x":"${"a".repeat(bytes)}"}'::jsonb`;
  await expectError(admin.query({ text: `insert into public.report_records (owner_id, student_id, title, period_start, period_end, snapshot) values ($1, $2, 'Grande', '2026-09-01', '2026-09-30', ${big(3 * 1024 * 1024)})`, values: [A, sr] }), QUOTA("report_records", "quota_row_too_large"), L("fila de 3 MB en report_records (tope 512 KB)"));
  await admin.query({ text: `insert into public.report_records (owner_id, student_id, title, period_start, period_end, snapshot, generated_at) values ($1, $2, 'Mediano', '2026-09-01', '2026-09-30', ${big(400 * 1024)}, now() - interval '5 hours')`, values: [A, sr] });
  ok(true, L("fila de 400 KB en report_records entra"));
  await setOverride(admin, A, "report_records", "max_row_bytes", 1000);
  await admin.query({ text: `update public.report_records set title = 'M' where owner_id = $1 and title = 'Mediano'`, values: [A] });
  ok(true, L("una fila que ya superaba el tope nuevo puede editarse si no crece"));
  await expectError(admin.query({ text: `update public.report_records set snapshot = ${big(2000 * 1024)} where owner_id = $1 and title = 'M'`, values: [A] }), QUOTA("report_records", "quota_row_too_large"), L("UPDATE que agranda la fila por encima del tope"));

  // ------------------------------------------------------------------------------------------------------------- acciones costosas (límite por ventana)
  await wipe(admin);
  await clearOverrides(admin);
  await setOverride(admin, A, "action:report_pdf", "max_total", 3);
  const act = await pg.session(A);
  for (let i = 0; i < 3; i += 1) await act.query("select public.consume_action_quota('report_pdf')");
  await expectError(act.query("select public.consume_action_quota('report_pdf')"), QUOTA("report_pdf", "quota_rate_exceeded"), L("acción: la 4ª en la ventana falla"));
  ok((await count(admin, "account_action_events", A, "action_key = 'report_pdf'")) === 3, L("acción rechazada: no inserta eventos (la tabla no se infla)"));
  const actB = await pg.session(B);
  await actB.query("select public.consume_action_quota('report_pdf')");
  ok(true, L("acción: la cuenta B tiene su propia ventana"));
  await act.query("select public.consume_action_quota('report_preview')");
  ok(true, L("acción: agotar report_pdf no afecta report_preview"));
  await admin.query("update public.account_action_events set occurred_at = now() - interval '2 hours' where owner_id = $1", [A]);
  await act.query("select public.consume_action_quota('report_pdf')");
  ok((await count(admin, "account_action_events", A, "action_key = 'report_pdf'")) === 1, L("acción: pasada la ventana se libera y los eventos vencidos se limpian solos"));
  // dos o más conexiones simultáneas por la última unidad de una acción: el lock por cuenta serializa el chequeo
  await admin.query("delete from public.account_action_events");
  await setOverride(admin, A, "action:cloud_backup_analyze", "max_total", 3);
  const racers = await Promise.all(Array.from({ length: 6 }, () => pg.session(A)));
  const raced = await Promise.all(racers.map(async (c) => {
    await c.query("begin");
    try { await c.query("select public.consume_action_quota('cloud_backup_analyze')"); await sleep(300); await c.query("commit"); return "ok"; }
    catch (e) { await c.query("rollback"); return e.code === "53400" ? "cuota" : `error:${e.code}`; }
  }));
  ok(raced.filter((x) => x === "ok").length === 3 && raced.filter((x) => x === "cuota").length === 3, L(`6 conexiones por 3 unidades de una acción: 3 entran y 3 reciben cuota (${raced.join(",")})`));
  for (const c of racers) await c.end();
  await expectError(act.query("select public.consume_action_quota('no_existe')"), { code: "22023" }, L("acción desconocida"));
  const noSession = await pg.session("", "authenticated");
  await expectError(noSession.query("select public.consume_action_quota('report_pdf')"), { code: "28000" }, L("consume_action_quota sin sesión (auth.uid() nulo)"));
  const anon = await pg.session("", "anon");
  await expectError(anon.query("select public.consume_action_quota('report_pdf')"), { code: "42501" }, L("consume_action_quota como anon: permiso denegado"));

  // ------------------------------------------------------------------------------------------------------------- anon / sin sesión / sin API de configuración
  await expectError(anon.query(studentInsert("Anon")), { code: "42501" }, L("INSERT directo como anon (sin permiso o RLS)")).catch(() => {});
  let anonInsert = null;
  try { await anon.query("insert into public.students (owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels) values ('" + A + "', 'Anon', 'online','activo','otro','mensual','2026-01-01',1000,'A1','{}')"); anonInsert = "entró"; } catch (e) { anonInsert = e.code; }
  ok(anonInsert === "42501" || anonInsert === "42501".toString(), L(`anon no puede insertar alumnos (${anonInsert})`));
  for (const table of ["quota_defaults", "account_quota_overrides", "action_quota_defaults", "account_action_events"]) {
    for (const [who, client] of [["authenticated", act], ["anon", anon]]) {
      let got = null;
      try { await client.query(`select * from public.${table} limit 1`); got = "leyó"; } catch (e) { got = e.code; }
      ok(got === "42501", L(`${who} no puede leer ${table} (${got})`));
      got = null;
      try { await client.query(`insert into public.${table} default values`); got = "escribió"; } catch (e) { got = e.code; }
      ok(got === "42501", L(`${who} no puede escribir ${table} (${got})`));
    }
  }
  const execMeta = (await admin.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') an, has_function_privilege('authenticated', p.oid, 'execute') au, p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tf_quota_after_insert', 'tf_quota_row_size', 'tf_quota_row_applies', 'tf_quota_count_filter', 'consume_action_quota') order by 1`)).rows;
  for (const f of execMeta) {
    if (f.proname === "consume_action_quota") ok(f.an === false && f.au === true && f.prosecdef === true, L("consume_action_quota: authenticated sí, anon no, SECURITY DEFINER"));
    else ok(f.an === false && f.au === false, L(`${f.proname}: no ejecutable por anon ni authenticated`));
    if (f.prosecdef) ok((f.proconfig || []).some((c) => /search_path=("")?$/.test(c)), L(`${f.proname}: search_path vacío`));
  }

  // ------------------------------------------------------------------------------------------------------------- configuración coherente
  const keys = (await admin.query("select quota_key from public.quota_defaults")).rows.map((r) => r.quota_key);
  const trig = (await admin.query(`select c.relname, t.tgname, t.tgargs from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgname = 'trg_quota_count'`)).rows;
  const argsOf = (row) => Buffer.from(row.tgargs).toString("latin1").split("\0").filter(Boolean);
  const used = new Set(trig.flatMap((t) => argsOf(t).map((a) => a.split(":")[0])));
  ok([...used].every((k) => keys.includes(k)), L(`todas las claves de los disparadores tienen valor por defecto (faltan: ${[...used].filter((k) => !keys.includes(k)).join(",") || "ninguna"})`));
  ok(keys.filter((k) => !used.has(k)).length === 0, L(`todas las categorías por defecto se aplican con algún disparador (sobran: ${keys.filter((k) => !used.has(k)).join(",") || "ninguna"})`));
  const withoutOwner = (await admin.query(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'trg_quota_count' and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'owner_id' and not a.attisdropped)`)).rows;
  ok(withoutOwner.length === 0, L("todas las tablas con cuota tienen owner_id"));
  ok(trig.length === 33, L(`33 tablas con disparador de conteo (hay ${trig.length})`));

  for (const c of [a1, b1, c1, c2, e1, act, actB, noSession, anon]) { try { await c.end(); } catch {} }
  await clearOverrides(admin);
  await wipe(admin);
  return failures.slice();
}

(async () => {
  const withMutations = process.argv.includes("--mutations");
  const pg = await start({ port: 5442 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); }
  await pg.admin.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test'),($3,'c@x.test')", [A, B, C]);
  const base = await runChecks(pg, "real");
  console.log(`función real: ${checks} comprobaciones`);
  if (base.length) { base.forEach((f) => console.log("  ✖", f)); await pg.stop(); process.exit(1); }
  console.log("función real: todas pasan");

  if (withMutations) {
    const fnSql = (re) => INFRA.match(re)[0];
    const afterInsertSrc = fnSql(/create or replace function public\.tf_quota_after_insert\(\)[\s\S]*?\n\$\$;/);
    const rowSizeSrc = fnSql(/create or replace function public\.tf_quota_row_size\(\)[\s\S]*?\n\$\$;/);
    const consumeSrc = fnSql(/create or replace function public\.consume_action_quota\(p_action text\)[\s\S]*?\n\$\$;/);
    const mutants = [
      ["sin lock por cuenta", afterInsertSrc.replace(/perform pg_advisory_xact_lock\([^;]*;/, "null;")],
      ["límite +1 (>= en vez de >... deja pasar uno más)", afterInsertSrc.replace("if v_count > v_max_total then", "if v_count > v_max_total + 1 then")],
      ["límite −1 (rechaza el exacto)", afterInsertSrc.replace("if v_count > v_max_total then", "if v_count >= v_max_total then")],
      ["sin filtro de propietaria al contar", afterInsertSrc.replace("where owner_id = $1 and (%s)'", "where true and (%s)'").replace("tg_table_name, public.tf_quota_count_filter(v_key))\n          into v_count using v_owner;", "tg_table_name, public.tf_quota_count_filter(v_key))\n          into v_count;")],
      ["lock compartido entre cuentas", afterInsertSrc.replace("hashtextextended('tf-quota:' || v_owner::text, 0)", "hashtextextended('tf-quota', 0)")],
      ["sin override por cuenta", afterInsertSrc.replace("coalesce(o.max_total, d.max_total)", "d.max_total")],
      ["sin filtro de categoría (pendientes/futuras)", afterInsertSrc.replace("if not v_applies then continue; end if;", "")],
      ["sin límite por hora", afterInsertSrc.replace("if v_max_hour is not null and v_ts is not null then", "if false then")],
      ["tamaño de fila ignorado", rowSizeSrc.replace("if v_size > v_limit and (tg_op = 'INSERT' or v_size > v_old_size) then", "if false then")],
      ["UPDATE bloquea filas viejas que no crecen", rowSizeSrc.replace("(tg_op = 'INSERT' or v_size > v_old_size)", "true")],
      ["acción sin límite por ventana", consumeSrc.replace("if v_count >= v_max then", "if false then")],
      ["acción sin lock", consumeSrc.replace(/perform pg_advisory_xact_lock\([^;]*;/, "null;")],
      ["acción sin limpiar vencidos", consumeSrc.replace(/delete from public\.account_action_events[\s\S]*?v_window\);/, "null;")],
    ];
    let undetected = 0;
    for (const [name, sql] of mutants) {
      if (sql === afterInsertSrc || sql === rowSizeSrc || sql === consumeSrc) { console.log("ERROR patrón no encontrado:", name); undetected += 1; continue; }
      await pg.admin.query(sql);
      let found;
      try { found = await runChecks(pg, name); } catch (e) { found = [`la prueba se rompió: ${e.code || ""} ${e.message}`]; }
      console.log((found.length ? "DETECTADA   " : "NO DETECTADA ") + name + (found.length ? `  <- ${found[0].slice(0, 100)}` : ""));
      if (!found.length) undetected += 1;
      await pg.admin.query(INFRA); // restaura las funciones reales
    }
    // Mutación estructural: el conteo corre BEFORE (consumiría cuota en reintentos ON CONFLICT DO NOTHING) — se simula reemplazando el disparador.
    await pg.admin.query("drop trigger trg_quota_count on public.payment_charges");
    await pg.admin.query(`create or replace function public.tf_mut_before() returns trigger language plpgsql security definer set search_path = '' as $$ declare n bigint; l int; begin select count(*) into n from public.payment_charges where owner_id = new.owner_id; select coalesce(o.max_total, d.max_total) into l from public.quota_defaults d left join public.account_quota_overrides o on o.owner_id = new.owner_id and o.quota_key = d.quota_key where d.quota_key = 'payment_charges'; if n >= l then raise exception 'quota_exceeded' using errcode='53400', detail='payment_charges'; end if; return new; end $$`);
    await pg.admin.query("create trigger trg_mut_before before insert on public.payment_charges for each row execute function public.tf_mut_before()");
    let found;
    try { found = await runChecks(pg, "disparador BEFORE"); } catch (e) { found = [`la prueba se rompió: ${e.code || ""} ${e.message}`]; }
    console.log((found.length ? "DETECTADA   " : "NO DETECTADA ") + "disparador BEFORE (el reintento idempotente consumiría/rompería)" + (found.length ? `  <- ${found[0].slice(0, 100)}` : ""));
    if (!found.length) undetected += 1;
    await pg.admin.query("drop trigger trg_mut_before on public.payment_charges");
    await pg.admin.query("create trigger trg_quota_count after insert on public.payment_charges referencing new table as new_rows for each statement execute function public.tf_quota_after_insert('payment_charges')");
    console.log(undetected === 0 ? "mutaciones: todas detectadas" : `mutaciones sin detectar: ${undetected}`);
    await pg.stop();
    process.exit(undetected === 0 ? 0 : 1);
  }
  await pg.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
