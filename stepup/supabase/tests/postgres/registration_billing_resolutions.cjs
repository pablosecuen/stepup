// Decisión explícita de cobro de una sesión de entrenamiento (migración 20261101120000) y su relación con los cargos por clase persistidos.
// Postgres REAL aislado (binarios de embedded-postgres, fuera del repo), datos SINTÉTICOS, nunca la cuenta real.
//
//   set NODE_PATH=C:\Users\joaqu\tf-design\epg\node_modules
//   node supabase/tests/postgres/registration_billing_resolutions.cjs
//
// Cubre: esquema y privilegios (sin escritura directa, lectura sólo propia), validaciones de la RPC (dueña, tipo de actividad, participante, acuerdo ajeno, decisión inválida), idempotencia
// (repetir no cambia nada; cambiar de idea actualiza la misma fila), y —sobre cargos y pagos persistidos— que sync_per_class_charge no duplica al guardar/finalizar/editar/reintentar, que
// retira sólo un cobro SIN pagos y que un cobro con pagos jamás se anula ni se reasigna. La migración no toca cargos, pagos ni asignaciones existentes.
const { start } = require("./load.cjs");

const A = "f9000000-0000-0000-0000-000000000001";
const B = "f9000000-0000-0000-0000-000000000002";
const ANA = "f9100000-0000-0000-0000-000000000001";
const BEA = "f9100000-0000-0000-0000-000000000002";
const OUT = "f9100000-0000-0000-0000-000000000003";
const AG_A = "f9200000-0000-0000-0000-00000000000a";
const AG_B = "f9200000-0000-0000-0000-00000000000b";
const AG_FOREIGN = "f9200000-0000-0000-0000-00000000000f";
const REG_TRAINING = "f9300000-0000-0000-0000-000000000001";
const REG_CLASS = "f9300000-0000-0000-0000-000000000002";
const REG_FOREIGN = "f9300000-0000-0000-0000-000000000003";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function resolve(session, registration, student, decision, agreement) {
  try {
    const { rows } = await session.query("select public.resolve_registration_billing($1, $2, $3, $4) as r", [registration, student, decision, agreement]);
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}
async function sync(session, registration, participants) {
  const { rows } = await session.query("select public.sync_per_class_charge($1, $2::jsonb) as n", [registration, JSON.stringify(participants)]);
  return rows[0].n;
}

async function seed(admin) {
  await admin.query("truncate public.students cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await admin.query(
    `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
     ($1, $4, 'F9 Ana', 'presencial', 'otro', 'por_clase', '2026-01-01', 27500),
     ($2, $4, 'F9 Bea', 'presencial', 'otro', 'por_clase', '2026-01-01', 20000),
     ($3, $5, 'F9 Ajena', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000)`,
    [ANA, BEA, OUT, A, B]
  );
  await admin.query(
    `insert into public.training_billing_agreements (id, owner_id, monthly_fee, start_period) values ($1, $4, 80000, '2026-09'), ($2, $4, 60000, '2026-09'), ($3, $5, 50000, '2026-09')`,
    [AG_A, AG_B, AG_FOREIGN, A, B]
  );
  const reg = (id, owner, kind) => admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status) values ($1, $2, null, $3, true, now(), 'completed')`, [id, owner, kind]);
  await reg(REG_TRAINING, A, "training");
  await reg(REG_CLASS, A, "class");
  await reg(REG_FOREIGN, B, "training");
  const part = (registration, student, owner) => admin.query(`insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id) values ($1, $2, $3)`, [owner, registration, student]);
  await part(REG_TRAINING, ANA, A);
  await part(REG_TRAINING, BEA, A);
  await part(REG_CLASS, ANA, A);
  await part(REG_FOREIGN, OUT, B);
}

const charges = (admin, registration) =>
  admin.query("select id, student_id, original_amount, voided_at is not null as voided from public.payment_charges where saved_lesson_id = $1 and charge_type = 'por_clase' order by student_id, created_at", [registration]).then((r) => r.rows);

async function main() {
  const pg = await start({ port: 5779 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;

    // ---- esquema y privilegios
    const acl = (await admin.query("select has_function_privilege('anon', 'public.resolve_registration_billing(uuid,uuid,text,uuid)', 'execute') as anon, has_function_privilege('authenticated', 'public.resolve_registration_billing(uuid,uuid,text,uuid)', 'execute') as auth")).rows[0];
    check("resolve_registration_billing: sólo la usuaria autenticada puede ejecutarla (no anon)", acl.auth === true && acl.anon === false);
    const grants = (await admin.query("select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'lesson_registration_billing_resolutions' and grantee = 'authenticated' order by 1")).rows.map((r) => r.privilege_type);
    check("la tabla sólo se puede LEER desde la API (sin insert/update/delete directos)", grants.length === 1 && grants[0] === "SELECT", JSON.stringify(grants));
    check("la tabla tiene RLS activa", (await admin.query("select relrowsecurity as r from pg_class where oid = 'public.lesson_registration_billing_resolutions'::regclass")).rows[0].r === true);

    await seed(admin);
    const sa = await pg.session(A);
    const sb = await pg.session(B);

    // ---- validaciones
    let r = await resolve(sa, REG_TRAINING, ANA, "covered", null);
    check("«cubierta» sin acuerdo: se rechaza (22023)", !r.ok && r.code === "22023", JSON.stringify(r));
    r = await resolve(sa, REG_TRAINING, ANA, "own_regime", AG_A);
    check("«clase suelta» con acuerdo: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await resolve(sa, REG_TRAINING, ANA, "otra", null);
    check("decisión desconocida: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await resolve(sa, REG_CLASS, ANA, "own_regime", null);
    check("una clase común no admite la decisión (22023)", !r.ok && r.code === "22023");
    r = await resolve(sa, REG_TRAINING, OUT, "own_regime", null);
    check("un alumno que no participa del registro: se rechaza (P0002)", !r.ok && r.code === "P0002");
    r = await resolve(sa, REG_TRAINING, ANA, "covered", AG_FOREIGN);
    check("un acuerdo de otra dueña: se rechaza (P0002)", !r.ok && r.code === "P0002");
    r = await resolve(sa, REG_FOREIGN, OUT, "own_regime", null);
    check("el registro de otra dueña no se puede tocar (P0002)", !r.ok && r.code === "P0002");
    check("ninguna validación dejó filas", Number((await admin.query("select count(*) as n from public.lesson_registration_billing_resolutions")).rows[0].n) === 0);

    // ---- decisión guardada, idempotente, cambiable
    r = await resolve(sa, REG_TRAINING, ANA, "covered", AG_A);
    check("ana: «cubierta por A» se guarda", r.ok && r.value.decision === "covered" && r.value.changed === true, JSON.stringify(r));
    r = await resolve(sa, REG_TRAINING, ANA, "covered", AG_A);
    check("repetir el mismo pedido no cambia nada (changed:false)", r.ok && r.value.changed === false);
    r = await resolve(sa, REG_TRAINING, ANA, "covered", AG_B);
    check("cambiar de idea actualiza la MISMA fila (a B)", r.ok && r.value.changed === true);
    r = await resolve(sa, REG_TRAINING, BEA, "own_regime", null);
    check("bea: «clase suelta» se guarda", r.ok && r.value.decision === "own_regime" && r.value.agreement_id === null);
    const rows = (await admin.query("select student_id, decision, training_billing_agreement_id as ag from public.lesson_registration_billing_resolutions order by student_id")).rows;
    check("una sola fila por participante y registro, con la última decisión", rows.length === 2 && rows[0].decision === "covered" && rows[0].ag === AG_B && rows[1].decision === "own_regime" && rows[1].ag === null, JSON.stringify(rows));

    // ---- lectura sólo propia y sin escritura directa
    check("la dueña lee sus decisiones", Number((await sa.query("select count(*) as n from public.lesson_registration_billing_resolutions")).rows[0].n) === 2);
    check("otra dueña no ve decisiones ajenas (RLS)", Number((await sb.query("select count(*) as n from public.lesson_registration_billing_resolutions")).rows[0].n) === 0);
    let denied = false;
    try { await sa.query("insert into public.lesson_registration_billing_resolutions (owner_id, lesson_registration_id, student_id, decision) values ($1, $2, $3, 'own_regime')", [A, REG_TRAINING, ANA]); } catch { denied = true; }
    check("insertar directo desde la API está denegado", denied);
    denied = false;
    try { await sa.query("update public.lesson_registration_billing_resolutions set decision = 'own_regime', training_billing_agreement_id = null"); } catch { denied = true; }
    check("actualizar directo desde la API está denegado", denied);

    // ---- cargos y pagos persistidos: guardar → finalizar → editar → reintentar no duplica
    const base = (await admin.query("select (select count(*) from public.payment_charges) as c, (select count(*) from public.payments) as p, (select count(*) from public.payment_allocations) as a")).rows[0];
    check("resolver decisiones no creó cargos, pagos ni asignaciones", base.c === "0" && base.p === "0" && base.a === "0", JSON.stringify(base));

    // bea (clase suelta explícita) → se cobra: tres veces (finalizar, editar, reintentar) = UN solo cargo
    for (let i = 0; i < 3; i += 1) await sync(sa, REG_TRAINING, [{ student_id: BEA, amount: 20000 }]);
    let list = await charges(admin, REG_TRAINING);
    check("finalizar + editar + reintentar: UN solo cargo por clase para bea", list.length === 1 && Number(list[0].original_amount) === 20000 && !list[0].voided, JSON.stringify(list));
    await sync(sa, REG_TRAINING, [{ student_id: BEA, amount: 22000 }]);
    list = await charges(admin, REG_TRAINING);
    check("editar el importe corrige el MISMO cargo (sin duplicar)", list.length === 1 && Number(list[0].original_amount) === 22000);

    // ana (cubierta) → nunca tiene cargo por clase; si quedó uno viejo SIN pagos se retira
    await sync(sa, REG_TRAINING, [{ student_id: ANA, amount: 27500 }]);
    check("ana tenía un cargo viejo sin pagos", (await charges(admin, REG_TRAINING)).filter((c) => c.student_id === ANA && !c.voided).length === 1);
    await sync(sa, REG_TRAINING, [{ student_id: ANA, amount: null }]);
    list = await charges(admin, REG_TRAINING);
    check("al quedar cubierta se retira el cargo SIN pagos (anulado, no borrado)", list.filter((c) => c.student_id === ANA).length === 1 && list.find((c) => c.student_id === ANA).voided === true);
    await sync(sa, REG_TRAINING, [{ student_id: ANA, amount: null }]);
    check("repetir el retiro es inofensivo", (await charges(admin, REG_TRAINING)).filter((c) => c.student_id === ANA).length === 1);

    // un cargo CON pagos jamás se anula ni se reasigna
    const chargeId = list.find((c) => c.student_id === BEA).id;
    const payment = (await admin.query("insert into public.payments (owner_id, student_id, amount, method, paid_at) values ($1, $2, 22000, 'efectivo', current_date) returning id", [A, BEA])).rows[0].id;
    await admin.query("insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1, $2, $3, $4, 22000)", [A, payment, chargeId, BEA]);
    await sync(sa, REG_TRAINING, [{ student_id: BEA, amount: null }]);
    await sync(sa, REG_TRAINING, [{ student_id: BEA, amount: 99999 }]);
    const after = (await admin.query("select voided_at is not null as voided, original_amount from public.payment_charges where id = $1", [chargeId])).rows[0];
    check("un cargo con pago registrado NO se anula (aunque la clase quede cubierta)", after.voided === false);
    check("ni se modifica su importe", Number(after.original_amount) === 22000);
    const alloc = (await admin.query("select count(*) as n, sum(amount) as s from public.payment_allocations where charge_id = $1", [chargeId])).rows[0];
    check("el pago y su asignación siguen intactos", alloc.n === "1" && Number(alloc.s) === 22000);
    check("sigue habiendo un solo cargo vigente para bea", (await charges(admin, REG_TRAINING)).filter((c) => c.student_id === BEA && !c.voided).length === 1);

    // la clase común de la MISMA alumna conserva su propio cobro, independiente del entrenamiento
    await sync(sa, REG_CLASS, [{ student_id: ANA, amount: 27500 }]);
    list = await charges(admin, REG_CLASS);
    check("la clase suelta de ana tiene su propio cargo, separado del entrenamiento", list.length === 1 && Number(list[0].original_amount) === 27500 && !list[0].voided);
    await sync(sa, REG_TRAINING, [{ student_id: ANA, amount: null }]);
    check("retirar el cargo del entrenamiento no toca el de la clase suelta", (await charges(admin, REG_CLASS)).filter((c) => !c.voided).length === 1);

    // borrar el registro (deshacer una importación) arrastra sus decisiones sin dejar huérfanas
    await admin.query("delete from public.lesson_registrations where id = $1", [REG_FOREIGN]);
    check("las decisiones de un registro eliminado no quedan huérfanas", Number((await admin.query("select count(*) as n from public.lesson_registration_billing_resolutions where lesson_registration_id = $1", [REG_FOREIGN])).rows[0].n) === 0);

    await sa.end();
    await sb.end();
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones`);
  if (failures.length) {
    console.log("FALLAS:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
