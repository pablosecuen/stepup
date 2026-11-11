// «cannot delete from scalar» al modificar el monto mensual (migración 20261111100000). Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=C:\Users\joaqu\tf-design\epg\node_modules
//   node supabase/tests/postgres/student_plan_json_null.cjs            (con la corrección)
//   node supabase/tests/postgres/student_plan_json_null.cjs --before   (sólo hasta la migración anterior: reproduce el error real; termina con error A PROPÓSITO)
//
// Alumnos con billing_plan = jsonb 'null' (el JSON null del traslado, distinto del NULL de SQL): «este mes» y «próximo mes», cargo pendiente, pago parcial, mes saldado, centavos exactos,
// otra dueña, por clase, un valor escalar no reconocido, el NULL de SQL de siempre, y las otras funciones que resuelven el plan (plan de cobro, marcar mes pagado, reactivar).
const { start } = require("./load.cjs");

const BEFORE = process.argv.includes("--before");
const A = "fa000000-0000-0000-0000-000000000001";
const B = "fa000000-0000-0000-0000-000000000002";
const S_NULLJSON = "fa100000-0000-0000-0000-000000000001"; // mensual, plan = jsonb 'null'
const S_PARTIAL = "fa100000-0000-0000-0000-000000000002"; // mensual, plan = jsonb 'null', pago parcial
const S_PAID = "fa100000-0000-0000-0000-000000000003"; // mensual, plan = jsonb 'null', mes saldado
const S_PERCLASS = "fa100000-0000-0000-0000-000000000004"; // por clase, plan = jsonb 'null'
const S_STRING = "fa100000-0000-0000-0000-000000000005"; // plan = '"monthly"' (escalar no reconocido)
const S_SQLNULL = "fa100000-0000-0000-0000-000000000006"; // mensual, NULL de SQL
const S_FOREIGN = "fa100000-0000-0000-0000-000000000007"; // otra dueña
const S_OBJECT = "fa100000-0000-0000-0000-000000000008"; // mensual con plan objeto (sin regresión)
const S_MARK = "fa100000-0000-0000-0000-000000000009"; // mensual, plan = jsonb 'null', sin cargo del mes
const PERIOD = "2026-11";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
async function rpc(session, fn, payload) {
  try {
    const { rows } = await session.query(`select to_jsonb(public.${fn}($1::jsonb)) as r`, [JSON.stringify(payload)]);
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}
const amount = (student, value, effective, extra = {}) => ({ student_id: student, new_amount: value, effective_from: effective, current_period: PERIOD, due_date: `${PERIOD}-10`, ...extra });

async function seed(admin) {
  await admin.query("truncate public.students cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  const student = (id, owner, name, type, price, plan) =>
    admin.query(`insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price, billing_plan) values ($1, $2, $3, 'presencial', 'otro', $4, '2026-01-01', $5, $6::jsonb)`, [id, owner, name, type, price, plan]);
  await student(S_NULLJSON, A, "FA nulo", "mensual", 185000, "null");
  await student(S_PARTIAL, A, "FA parcial", "mensual", 100000, "null");
  await student(S_PAID, A, "FA saldado", "mensual", 90000, "null");
  await student(S_PERCLASS, A, "FA por clase", "por_clase", 8000, "null");
  await student(S_STRING, A, "FA escalar", "mensual", 50000, '"monthly"');
  await student(S_SQLNULL, A, "FA sql null", "mensual", 36000, null);
  await student(S_FOREIGN, B, "FA ajeno", "mensual", 70000, "null");
  await student(S_OBJECT, A, "FA objeto", "mensual", 60000, JSON.stringify({ type: "monthly", amount: 60000, dueDay: 10 }));
  await student(S_MARK, A, "FA marcar", "mensual", 45000, "null");
  const charge = (id, owner, student, amountValue) =>
    admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values ($1, $2, $3, 'mensual', $4, $5, $6)`, [id, owner, student, amountValue, `${PERIOD}-10`, PERIOD]);
  await charge("fb000000-0000-0000-0000-000000000001", A, S_NULLJSON, 185000);
  await charge("fb000000-0000-0000-0000-000000000002", A, S_PARTIAL, 100000);
  await charge("fb000000-0000-0000-0000-000000000003", A, S_PAID, 90000);
  await charge("fb000000-0000-0000-0000-000000000004", A, S_SQLNULL, 36000);
  await charge("fb000000-0000-0000-0000-000000000005", A, S_OBJECT, 60000);
  await admin.query(`insert into public.payments (id, owner_id, student_id, amount, method, paid_at) values ('fc000000-0000-0000-0000-000000000001', $1, $2, 40000, 'efectivo', current_date), ('fc000000-0000-0000-0000-000000000002', $1, $3, 90000, 'efectivo', current_date)`, [A, S_PARTIAL, S_PAID]);
  await admin.query(`insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1, 'fc000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000002', $2, 40000), ($1, 'fc000000-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-000000000003', $3, 90000)`, [A, S_PARTIAL, S_PAID]);
}
const plan = async (admin, id) => (await admin.query("select billing_plan as p, jsonb_typeof(billing_plan) as t from public.students where id = $1", [id])).rows[0];
const chargeAmount = async (admin, id) => Number((await admin.query("select original_amount as a from public.payment_charges where id = $1", [id])).rows[0].a);

async function main() {
  const pg = await start({ port: 5783, ...(BEFORE ? { upTo: "20261104120000_public_pricing_v2.sql" } : {}) });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await seed(admin);
    const sa = await pg.session(A);
    const sb = await pg.session(B);
    const snapshot = async () => JSON.stringify([(await admin.query("select id, original_amount, voided_at from public.payment_charges order by id")).rows, (await admin.query("select id, amount, voided_at from public.payments order by id")).rows, (await admin.query("select id, charge_id, amount from public.payment_allocations order by id")).rows]);

    // ---- el caso del video: $185.000 → $195.000 «este mes» de un alumno con plan = jsonb 'null'
    let r = await rpc(sa, "change_student_monthly_amount", amount(S_NULLJSON, 195000, "this_month"));
    if (BEFORE) {
      check("REPRODUCCIÓN: «este mes» con plan JSON null falla con «cannot delete from scalar»", !r.ok && /cannot delete from scalar/.test(r.message), JSON.stringify(r));
      console.log(`\n${total - failures.length}/${total} comprobaciones (modo --before: el error está reproducido)`);
      process.exit(failures.length ? 1 : 2);
    }
    check("$185.000 → $195.000 «este mes» con plan JSON null: se guarda", r.ok && r.value.charge_updated === true && Number(r.value.previous_charge_amount) === 185000, JSON.stringify(r));
    check("el cargo del mes quedó en $195.000 exactos", (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000001")) === 195000);
    let p = await plan(admin, S_NULLJSON);
    check("el plan pasó a ser un objeto completo: monthly, 195000, vencimiento día 10", p.t === "object" && p.p.type === "monthly" && Number(p.p.amount) === 195000 && p.p.dueDay === 10, JSON.stringify(p));
    const audit = (await admin.query("select before_state, after_state, detail from public.student_billing_audit where student_id = $1 and kind = 'monthly_amount_change'", [S_NULLJSON])).rows;
    check("la auditoría registra el plan DERIVADO de antes (185000) y el de después (195000)", audit.length === 1 && Number(audit[0].before_state.amount) === 185000 && Number(audit[0].after_state.amount) === 195000, JSON.stringify(audit));
    // reintento / guardar de nuevo con el mismo valor
    r = await rpc(sa, "change_student_monthly_amount", amount(S_NULLJSON, 195000, "this_month"));
    check("guardar de nuevo lo mismo no duplica ni rompe", r.ok && (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000001")) === 195000);

    // ---- «próximo mes»: no toca el cargo; deja la vigencia pendiente
    const before = await snapshot();
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PARTIAL, 120000, "next_month"));
    check("«próximo mes» con plan JSON null: se guarda sin tocar el cargo, pagos ni asignaciones", r.ok && before === (await snapshot()), JSON.stringify(r));
    p = await plan(admin, S_PARTIAL);
    check("queda pendiente 120000 desde 2026-12 y el importe actual no cambia", p.t === "object" && Number(p.p.pendingAmount) === 120000 && p.p.pendingAmountEffectiveFrom === "2026-12" && Number(p.p.amount) === 100000, JSON.stringify(p));

    // ---- pago parcial: no se puede bajar de lo ya pagado; igual a lo pagado sí
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PARTIAL, 30000, "this_month"));
    check("pago parcial de $40.000: bajar a $30.000 se rechaza con su mensaje", !r.ok && r.code === "22023" && /no puede ser menor a lo ya pagado/.test(r.message), JSON.stringify(r));
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PARTIAL, 40000.5, "this_month"));
    check("con centavos exactos ($40.000,50, mayor a lo pagado) se aplica", r.ok && (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000002")) === 40000.5, JSON.stringify(r));

    // ---- mes saldado
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PAID, 95000, "this_month"));
    check("mes ya pagado en su totalidad: «este mes» se rechaza", !r.ok && r.code === "22023" && /ya está pagado/.test(r.message), JSON.stringify(r));
    check("…y el cargo, el plan y el pago quedan intactos", (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000003")) === 90000 && (await plan(admin, S_PAID)).t === "null");
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PAID, 95000, "next_month"));
    check("mes pagado: «próximo mes» sí se puede", r.ok && (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000003")) === 90000, JSON.stringify(r));

    // ---- alumno sin cargo del mes: lo crea (JSON null)
    r = await rpc(sa, "change_student_monthly_amount", amount(S_MARK, 47000.25, "this_month"));
    check("sin cargo del mes: se crea con el importe exacto", r.ok && r.value.charge_created === true && Number((await admin.query("select original_amount as a from public.payment_charges where student_id = $1 and billing_period = $2", [S_MARK, PERIOD])).rows[0].a) === 47000.25, JSON.stringify(r));

    // ---- otros casos de plan
    r = await rpc(sa, "change_student_monthly_amount", amount(S_PERCLASS, 9000, "this_month"));
    check("por clase con plan JSON null: «no tiene un plan de cobro mensual» (no un error técnico)", !r.ok && r.code === "22023" && /no tiene un plan de cobro mensual/.test(r.message), JSON.stringify(r));
    r = await rpc(sa, "change_student_monthly_amount", amount(S_STRING, 55000, "this_month"));
    check("un valor escalar no reconocido se rechaza con un mensaje claro y no se modifica", !r.ok && r.code === "22023" && /formato no reconocido/.test(r.message) && (await plan(admin, S_STRING)).t === "string", JSON.stringify(r));
    r = await rpc(sa, "change_student_monthly_amount", amount(S_SQLNULL, 38000, "this_month"));
    check("el NULL de SQL de siempre sigue funcionando", r.ok && (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000004")) === 38000, JSON.stringify(r));
    r = await rpc(sa, "change_student_monthly_amount", amount(S_OBJECT, 65000, "this_month"));
    check("un plan objeto sigue funcionando (sin regresión)", r.ok && (await chargeAmount(admin, "fb000000-0000-0000-0000-000000000005")) === 65000, JSON.stringify(r));
    r = await rpc(sa, "change_student_monthly_amount", amount(S_FOREIGN, 80000, "this_month"));
    check("un alumno de otra dueña: no se encuentra", !r.ok && r.code === "P0002", JSON.stringify(r));
    r = await rpc(sb, "change_student_monthly_amount", amount(S_NULLJSON, 1000, "this_month"));
    check("y la otra dueña tampoco puede tocar el mío", !r.ok && r.code === "P0002");
    check("el alumno ajeno quedó intacto", (await plan(admin, S_FOREIGN)).t === "null");

    // ---- las otras funciones que resolvían el plan con el mismo coalesce
    r = await rpc(sa, "set_student_billing_plan", { student_id: S_PERCLASS, plan: { type: "monthly", amount: 8500, dueDay: 12 }, current_period: PERIOD });
    check("set_student_billing_plan sobre un plan JSON null no falla por el formato", r.ok || !/scalar|array/.test(r.message ?? ""), JSON.stringify(r));
    r = await rpc(sa, "mark_current_month_paid", { operation_id: "fd000000-0000-0000-0000-000000000001", student_id: S_MARK, current_period: PERIOD, due_date: `${PERIOD}-10`, paid_at: "2026-11-02" });
    check("mark_current_month_paid sobre un plan JSON null resuelve el importe del plan derivado", r.ok || /pagad|vencimiento|importe/.test(r.message ?? ""), JSON.stringify(r));
    check("ningún plan quedó convertido en arreglo ni escalar", (await admin.query("select count(*) as n from public.students where billing_plan is not null and jsonb_typeof(billing_plan) in ('array','number','boolean')")).rows[0].n === "0");

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
