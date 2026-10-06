// R2 — `list_open_charge_balances()` sobre el esquema REAL (todas las migraciones) en PGlite, con DOS propietarias (A y B) de más de
// 1.700 cargos cada una: exactitud frente a un cálculo INDEPENDIENTE, aislamiento A/B, sólo lectura, atributos de seguridad y
// equivalencia con el motor de TypeScript (`buildCollectionsCenterEntries`). Con `--mutations` rompe la función a propósito y exige que
// cada rotura sea detectada.
//
//   NODE_PATH=<carpeta con @electric-sql/pglite>/node_modules node supabase/tests/pglite/r2_open_charge_balances.cjs [--mutations]
const path = require("path");
const { pathToFileURL } = require("url");
const { load } = require("./load.cjs");

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const TODAY = "2026-10-06";
const PERIODS = 29; // 60 alumnos × 29 períodos = 1.740 cargos por propietaria

const FUNCTION_SQL = (mutation = "") => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "..", "migrations", "20261006100000_r2_list_open_charge_balances.sql"), "utf8");
  let sql = src.slice(src.indexOf("create or replace function"), src.indexOf("comment on function"));
  if (mutation === "sin-anuladas-del-cargo") sql = sql.replace("and c.voided_at is null\n", "\n");
  if (mutation === "cuenta-pagos-anulados") sql = sql.replace("      and pay.voided_at is null\n", "\n");
  if (mutation === "incluye-saldadas") sql = sql.replace("c.original_amount - coalesce(p.paid, 0) > 0", "c.original_amount - coalesce(p.paid, 0) >= 0");
  if (mutation === "sin-propietaria") sql = sql.replace("c.owner_id = (select auth.uid())", "true");
  if (mutation === "propietaria-por-parametro") sql = sql.replace("returns table", "returns table").replace("public.list_open_charge_balances()", "public.list_open_charge_balances()");
  if (mutation === "security-definer") sql = sql.replace("security invoker", "security definer");
  if (mutation === "paga-doble-asignaciones") sql = sql.replace("select sum(a.amount) as paid", "select sum(a.amount) * 2 as paid");
  if (mutation === "ignora-asignaciones-parciales") sql = sql.replace("select sum(a.amount) as paid", "select max(a.amount) as paid");
  return sql;
};

let failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); return cond; };

async function seed(db) {
  await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
  for (const [owner, tag] of [[A, "a"], [B, "b"]]) {
    await db.query(
      `insert into public.students (id, owner_id, name, modality, status, category, billing_type, date_joined, price, initial_level, levels)
       select (md5($2 || 'st' || s))::uuid, $1::uuid, 'Alumno ' || lpad(s::text, 3, '0'), 'online', 'activo', 'otro', 'mensual', '2020-01-01', 1000, 'A1', '{}'
       from generate_series(1, 60) s`, [owner, tag]);
    // Estados por (alumno + período) mod 8 — ver el comentario de cada caso.
    await db.query(
      `do $$
       declare s int; p int; st int; orig numeric; cid uuid; sid uuid; pid uuid;
         v_owner uuid := '${owner}'; v_tag text := '${tag}';
       begin
         for s in 1..60 loop
           sid := md5(v_tag || 'st' || s)::uuid;
           for p in 0..${PERIODS - 1} loop
             st := (s + p) % 8;
             orig := 1000 + 100 * ((s + p) % 7);
             cid := md5(v_tag || 'ch' || s || '-' || p)::uuid;
             insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period, voided_at, void_reason)
             values (cid, v_owner, sid, 'mensual', orig, (date '2020-01-10' + (p || ' month')::interval)::date,
                     to_char(date '2020-01-01' + (p || ' month')::interval, 'YYYY-MM'),
                     case when st = 5 then now() end, case when st = 5 then 'x' end);
             -- 0: sin pagos | 1: saldada | 2: pago parcial | 3: sólo un pago ANULADO | 4: dos parciales que saldan | 5: cargo anulado
             -- 6: parcial vigente + otro pago anulado | 7: asignado de más (saldada)
             if st in (1, 2, 4, 6, 7, 3) then
               pid := md5(v_tag || 'pa' || s || '-' || p)::uuid;
               insert into public.payments (id, owner_id, student_id, amount, method, paid_at, voided_at, void_reason)
               values (pid, v_owner, sid,
                       case st when 1 then orig when 2 then orig / 2 when 3 then orig when 4 then orig / 2 when 6 then orig / 2 else orig + 100 end,
                       'efectivo', date '2020-01-12' + p, case when st = 3 then now() end, case when st = 3 then 'anulado' end);
               insert into public.payment_allocations (id, owner_id, payment_id, charge_id, student_id, amount)
               values (md5(v_tag || 'al' || s || '-' || p)::uuid, v_owner, pid, cid, sid,
                       case st when 1 then orig when 2 then orig / 2 when 3 then orig when 4 then orig / 2 when 6 then orig / 2 else orig + 100 end);
             end if;
             if st = 4 then
               pid := md5(v_tag || 'pb' || s || '-' || p)::uuid;
               insert into public.payments (id, owner_id, student_id, amount, method, paid_at) values (pid, v_owner, sid, orig / 2, 'transferencia', date '2020-01-13' + p);
               insert into public.payment_allocations (id, owner_id, payment_id, charge_id, student_id, amount) values (md5(v_tag || 'bl' || s || '-' || p)::uuid, v_owner, pid, cid, sid, orig / 2);
             end if;
             if st = 6 then
               pid := md5(v_tag || 'pc' || s || '-' || p)::uuid;
               insert into public.payments (id, owner_id, student_id, amount, method, paid_at, voided_at, void_reason) values (pid, v_owner, sid, 300, 'otro', date '2020-01-14' + p, now(), 'anulado');
               insert into public.payment_allocations (id, owner_id, payment_id, charge_id, student_id, amount) values (md5(v_tag || 'cl' || s || '-' || p)::uuid, v_owner, pid, cid, sid, 300);
             end if;
           end loop;
         end loop;
       end $$;`);
  }
  await db.exec("grant select, insert, update, delete on all tables in schema public to authenticated");
}

const cents = (x) => Math.round(Number(x) * 100);

/** Cálculo INDEPENDIENTE (JavaScript puro, en centavos) de los cargos abiertos de una propietaria a partir de las filas crudas. */
async function independent(db, owner) {
  const charges = (await db.query("select id, student_id, charge_type, due_date::text due_date, original_amount, voided_at from public.payment_charges where owner_id = $1", [owner])).rows;
  const payments = new Map((await db.query("select id, voided_at from public.payments where owner_id = $1", [owner])).rows.map((p) => [p.id, p]));
  const allocations = (await db.query("select charge_id, payment_id, amount from public.payment_allocations where owner_id = $1", [owner])).rows;
  const paid = new Map();
  for (const a of allocations) {
    const payment = payments.get(a.payment_id);
    if (!payment || payment.voided_at !== null) continue;
    paid.set(a.charge_id, (paid.get(a.charge_id) ?? 0) + cents(a.amount));
  }
  const open = new Map();
  for (const c of charges) {
    if (c.voided_at !== null) continue;
    const remaining = cents(c.original_amount) - (paid.get(c.id) ?? 0);
    if (remaining > 0) open.set(c.id, { ...c, paidCents: paid.get(c.id) ?? 0 });
  }
  return { open, charges, allocations, payments };
}

async function asUser(db, uid, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
}

async function fingerprint(db) {
  await db.exec("reset role");
  const out = {};
  for (const t of ["payment_charges", "payments", "payment_allocations", "students"]) {
    out[t] = (await db.query(`select count(*)::int c, coalesce(md5(string_agg(t::text, '|' order by id)), '') h from public.${t} t`)).rows[0];
  }
  return JSON.stringify(out);
}

async function runChecks(db, label) {
  failures = [];
  const expected = { A: await independent(db, A), B: await independent(db, B) };
  ok(expected.A.charges.length >= 1700 && expected.B.charges.length >= 1700, `[${label}] cada propietaria tiene más de 1.700 cargos (${expected.A.charges.length}/${expected.B.charges.length})`);
  const before = await fingerprint(db);

  for (const [name, uid, other] of [["A", A, "B"], ["B", B, "A"]]) {
    await asUser(db, uid);
    const rows = (await db.query("select charge_id, student_id, charge_type, due_date::text as due_date, original_amount, paid_amount from public.list_open_charge_balances()")).rows;
    const exp = expected[name].open;
    const otherIds = new Set(expected[other].open.keys());
    ok(rows.length === exp.size, `[${label}] ${name}: ${rows.length} cargos abiertos devueltos, esperados ${exp.size}`);
    ok(rows.every((r) => !otherIds.has(r.charge_id)), `[${label}] ${name}: ningún cargo de ${other}`);
    ok(new Set(rows.map((r) => r.charge_id)).size === rows.length, `[${label}] ${name}: sin repetidos`);
    let wrong = 0;
    for (const r of rows) {
      const e = exp.get(r.charge_id);
      if (!e || cents(r.paid_amount) !== e.paidCents || cents(r.original_amount) !== cents(e.original_amount) || r.student_id !== e.student_id || r.charge_type !== e.charge_type || r.due_date !== e.due_date) wrong += 1;
    }
    ok(wrong === 0, `[${label}] ${name}: ${wrong} filas con importe pagado/original/alumno/vencimiento distinto del cálculo independiente`);
    // Total pendiente exacto
    const sqlTotal = rows.reduce((s, r) => s + cents(r.original_amount) - cents(r.paid_amount), 0);
    const indTotal = [...exp.values()].reduce((s, e) => s + cents(e.original_amount) - e.paidCents, 0);
    ok(sqlTotal === indTotal, `[${label}] ${name}: total pendiente ${sqlTotal / 100} vs ${indTotal / 100}`);
  }

  // La función filtra por auth.uid() POR SÍ MISMA, aun sin RLS (rol dueño de las tablas, que la omite): defensa en profundidad real.
  await db.exec("reset role");
  for (const [name, uid] of [["A", A], ["B", B]]) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    const sinRls = (await db.query("select charge_id from public.list_open_charge_balances()")).rows;
    ok(sinRls.length === expected[name].open.size && sinRls.every((r) => expected[name].open.has(r.charge_id)), `[${label}] ${name}: sin RLS (superusuario) igual devuelve SOLO sus cargos (${sinRls.length})`);
  }

  // Sin sesión / otra identidad
  await asUser(db, "");
  let n = (await db.query("select count(*)::int c from public.list_open_charge_balances()")).rows[0].c;
  ok(n === 0, `[${label}] sin auth.uid(): ${n} filas (esperadas 0)`);
  await asUser(db, "c0000000-0000-4000-8000-00000000000c");
  n = (await db.query("select count(*)::int c from public.list_open_charge_balances()")).rows[0].c;
  ok(n === 0, `[${label}] propietaria sin datos: ${n} filas (esperadas 0)`);
  await db.exec("reset role");

  // anon no puede ejecutarla
  await asUser(db, A, "anon");
  let denied = false;
  try { await db.query("select * from public.list_open_charge_balances()"); } catch (e) { denied = /permission denied/i.test(e.message); }
  ok(denied, `[${label}] anon: permiso denegado`);
  await db.exec("reset role");

  // Atributos de seguridad
  const meta = (await db.query(`select p.prosecdef, p.provolatile, p.proconfig, pg_get_function_arguments(p.oid) args,
      has_function_privilege('anon', p.oid, 'execute') anon_exec, has_function_privilege('authenticated', p.oid, 'execute') auth_exec
      from pg_proc p where p.oid = 'public.list_open_charge_balances()'::regprocedure`)).rows[0];
  ok(meta.prosecdef === false, `[${label}] SECURITY INVOKER`);
  ok(meta.args === "", `[${label}] no recibe ningún parámetro (el propietario sale de auth.uid())`);
  ok(Array.isArray(meta.proconfig) && meta.proconfig.some((c) => /search_path=("")?$/.test(c) || c === "search_path=\"\""), `[${label}] search_path vacío (${JSON.stringify(meta.proconfig)})`);
  ok(meta.anon_exec === false && meta.auth_exec === true, `[${label}] EXECUTE sólo para authenticated`);

  // Sólo lectura: las tablas no cambian
  ok((await fingerprint(db)) === before, `[${label}] las tablas no cambiaron (huella antes/después)`);

  // Equivalencia con el motor de TypeScript (mismas tarjetas que `buildCollectionsCenterEntries` sobre listas completas)
  const engine = await import(pathToFileURL(path.join(__dirname, "..", "..", "..", "lib", "payments", "collections-center.ts")).href);
  const students = (await db.query("select id, name, status from public.students where owner_id = $1 order by name, id", [A])).rows;
  const toCharge = (c) => ({ id: c.id, studentId: c.student_id, chargeType: c.charge_type, originalAmount: Number(c.original_amount), dueDate: c.due_date, voidedAt: c.voided_at ? "x" : null });
  const exA = expected.A;
  const fromLists = engine.buildCollectionsCenterEntries({
    charges: exA.charges.map(toCharge),
    allocations: exA.allocations.map((a) => ({ chargeId: a.charge_id, amount: Number(a.amount), paymentVoidedAt: exA.payments.get(a.payment_id)?.voided_at ? "x" : null })),
    students, todayDateKey: TODAY,
  });
  await asUser(db, A);
  const rpc = (await db.query("select charge_id, student_id, charge_type, due_date::text as due_date, original_amount, paid_amount from public.list_open_charge_balances()")).rows;
  await db.exec("reset role");
  const fromRpc = engine.buildCollectionsCenterEntriesFromBalances({
    balances: rpc.map((r) => ({ charge: { id: r.charge_id, studentId: r.student_id, chargeType: r.charge_type, originalAmount: Number(r.original_amount), dueDate: r.due_date, voidedAt: null }, paidAmount: Number(r.paid_amount) })),
    students, todayDateKey: TODAY,
  });
  ok(fromLists.length === fromRpc.length, `[${label}] motor TS: ${fromLists.length} tarjetas (listas completas) vs ${fromRpc.length} (RPC)`);
  ok(JSON.stringify(fromLists) === JSON.stringify(fromRpc), `[${label}] motor TS: las tarjetas (y su ORDEN) son idénticas por las dos vías`);
  return failures.slice();
}

(async () => {
  const withMutations = process.argv.includes("--mutations");
  const { db, failures: loadFailures } = await load();
  for (const f of loadFailures) if (!/storage|report|active_sessions|dead_write/.test(f[0] + f[1])) console.log("  ⚠ falla inesperada al cargar:", f);
  await seed(db);
  const counts = (await db.query("select (select count(*) from public.payment_charges)::int charges, (select count(*) from public.payments)::int payments, (select count(*) from public.payment_allocations)::int allocations")).rows[0];
  console.log("datos sembrados:", JSON.stringify(counts));

  const base = await runChecks(db, "función real");
  if (base.length) { console.log("FALLAS en la función real:"); base.forEach((f) => console.log("  ✖", f)); process.exit(1); }
  console.log("función real: todas las comprobaciones pasan");

  if (withMutations) {
    let undetected = 0;
    for (const mutation of ["sin-anuladas-del-cargo", "cuenta-pagos-anulados", "incluye-saldadas", "sin-propietaria", "security-definer", "paga-doble-asignaciones", "ignora-asignaciones-parciales"]) {
      await db.exec(FUNCTION_SQL(mutation));
      const found = await runChecks(db, mutation);
      console.log((found.length ? "DETECTADA   " : "NO DETECTADA ") + mutation + (found.length ? `  <- ${found[0].slice(0, 110)}` : ""));
      if (!found.length) undetected += 1;
    }
    await db.exec(FUNCTION_SQL());
    console.log(undetected === 0 ? "mutaciones SQL: todas detectadas" : `mutaciones SQL sin detectar: ${undetected}`);
    process.exit(undetected === 0 ? 0 : 1);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
