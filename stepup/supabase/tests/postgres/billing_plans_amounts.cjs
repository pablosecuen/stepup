// Planes de cobro, monto mensual y cargos por período (migración 20261028100000). Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/billing_plans_amounts.cjs
//
// Cubre: validaciones del plan (por tipo), la regla «el monto de un plan mensual sólo cambia con Modificar monto mensual», el monto mensual «este mes» (cargo existente, sin cargo, saldado, pago parcial,
// pago previo mayor al nuevo importe, importe exacto a lo pagado) y «próximo mes» (nunca toca el cargo, cruza diciembre), pagos y asignaciones intactos, cargos semanales/quincenales idempotentes (también con dos
// conexiones a la vez), alumnos ajenos, auditoría y aislamiento entre dueñas.
const { start } = require("./load.cjs");

const A = "f9000000-0000-0000-0000-000000000001";
const B = "f9000000-0000-0000-0000-000000000002";
const S_MONTHLY = "f9100000-0000-0000-0000-000000000001";
const S_PERCLASS = "f9100000-0000-0000-0000-000000000002";
const S_FOREIGN = "f9100000-0000-0000-0000-000000000003";
const S_LEGACY = "f9100000-0000-0000-0000-000000000004"; // mensual SIN billing_plan explícito (alumno viejo)

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
async function call(session, fn, ...args) {
  try {
    const params = args.map((_, i) => `$${i + 1}`).join(", ");
    const types = args.map((a) => (typeof a === "string" ? "text" : "jsonb")).join(",");
    const { rows } = await session.query(
      `select to_jsonb(public.${fn}(${args.map((a, i) => (typeof a === "string" ? `$${i + 1}::text` : `$${i + 1}::jsonb`)).join(", ")})) as r`,
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    );
    void params;
    void types;
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}

async function seed(admin) {
  await admin.query("truncate public.students cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  const student = (id, owner, name, billingType, price, plan) =>
    admin.query(
      `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price, billing_plan) values ($1, $2, $3, 'presencial', 'otro', $4, '2026-01-01', $5, $6::jsonb)`,
      [id, owner, name, billingType, price, plan === null ? null : JSON.stringify(plan)]
    );
  await student(S_MONTHLY, A, "F9 mensual", "mensual", 50000, { type: "monthly", amount: 50000, dueDay: 10 });
  await student(S_PERCLASS, A, "F9 por clase", "por_clase", 8000, null);
  await student(S_FOREIGN, B, "F9 ajeno", "mensual", 70000, { type: "monthly", amount: 70000, dueDay: 10 });
  await student(S_LEGACY, A, "F9 legado", "mensual", 36000, null);
}
async function charge(admin, id, owner, student, period, amount, due = null) {
  await admin.query(
    `insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values ($1, $2, $3, 'mensual', $4, $5, $6)`,
    [id, owner, student, amount, due ?? `${period}-10`, period]
  );
}
const CH = (n) => `f9200000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
async function pay(admin, owner, student, chargeId, amount, voided = false) {
  const { rows } = await admin.query(
    `insert into public.payments (owner_id, student_id, amount, method, paid_at, recorded_at, operation_id, voided_at) values ($1, $2, $3, 'efectivo', '2026-10-05', now(), gen_random_uuid(), $4) returning id`,
    [owner, student, amount, voided ? new Date().toISOString() : null]
  );
  await admin.query(`insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1, $2, $3, $4, $5)`, [owner, rows[0].id, chargeId, student, amount]);
}
const plan = async (admin, id) => (await admin.query("select billing_plan, billing_type from public.students where id = $1", [id])).rows[0];
const chargeAmount = async (admin, id) => Number((await admin.query("select original_amount from public.payment_charges where id = $1", [id])).rows[0]?.original_amount);

async function main() {
  const pg = await start({ port: 5772 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    for (const fn of ["set_student_billing_plan(jsonb)", "change_student_monthly_amount(jsonb)", "ensure_periodic_charges(text, jsonb)"]) {
      const acl = (await admin.query("select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth", [`public.${fn}`])).rows[0];
      check(`${fn}: sólo la usuaria autenticada puede ejecutarla`, acl.auth === true && acl.anon === false);
    }
    await seed(admin);
    const sa = await pg.session(A);
    const sb = await pg.session(B);

    // ---- Plan de cobro
    let r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "weekly", amount: 12000, dueWeekday: 5 } });
    check("plan semanal: se guarda con su día de vencimiento", r.ok && r.value.billing_plan.type === "weekly" && r.value.billing_plan.amount === 12000 && r.value.billing_plan.dueWeekday === 5, JSON.stringify(r));
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "weekly", amount: 12000, dueWeekday: 9 } });
    check("plan semanal con día inválido: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "biweekly", amount: 20000.5, anchorDate: "2026-10-12" } });
    check("plan quincenal: conserva los centavos y la fecha de referencia", r.ok && r.value.billing_plan.amount === 20000.5 && r.value.billing_plan.anchorDate === "2026-10-12", JSON.stringify(r));
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "biweekly", amount: 100, anchorDate: "2026-02-31" } });
    check("fecha de referencia inexistente: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "class_package", amount: 90000, includedClasses: 10, validFrom: "2026-10-01", validUntil: "2026-12-31" } });
    check("plan de paquete: clases incluidas, vigencia y precio", r.ok && r.value.billing_plan.includedClasses === 10 && r.value.billing_plan.validUntil === "2026-12-31", JSON.stringify(r));
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "class_package", amount: 90000, includedClasses: 0, validFrom: "2026-10-01" } });
    check("paquete con 0 clases: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "class_package", amount: 90000, includedClasses: 5, validFrom: "2026-10-10", validUntil: "2026-10-01" } });
    check("paquete con fin anterior al inicio: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "per_class", amount: 0 } });
    check("importe 0: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "complimentary" } });
    check("sin cargo: plan sin importe", r.ok && r.value.billing_plan.type === "complimentary" && !("amount" in r.value.billing_plan));
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "inventado", amount: 5 } });
    check("tipo desconocido: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "monthly", amount: 15000 } });
    check("pasar A mensual desde otro plan: vence el día 10 y el tipo de cobro queda mensual", r.ok && r.value.billing_plan.dueDay === 10 && r.value.billing_type === "mensual", JSON.stringify(r));
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "monthly", amount: 16000 } });
    check("cambiar el monto de un plan YA mensual por esta vía: se rechaza (22023) y no cambia", !r.ok && r.code === "22023" && (await plan(admin, S_PERCLASS)).billing_plan.amount === 15000, JSON.stringify(r));
    await admin.query("update public.students set billing_plan = jsonb_set(billing_plan, '{pendingAmount}', '20000') || '{\"pendingAmountEffectiveFrom\":\"2026-12\"}'::jsonb where id = $1", [S_PERCLASS]);
    r = await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "monthly", amount: 15000 } });
    check("repetir el mismo plan mensual conserva la vigencia pendiente ya programada", r.ok && r.value.billing_plan.pendingAmount === 20000);
    r = await call(sa, "set_student_billing_plan", { student_id: S_FOREIGN, current_period: "2026-10", plan: { type: "per_class", amount: 1 } });
    check("alumno de OTRA dueña: no existe a sus ojos (P0002) y no cambia", !r.ok && r.code === "P0002" && (await plan(admin, S_FOREIGN)).billing_plan.type === "monthly");
    const audits = Number((await admin.query("select count(*) from public.student_billing_audit where kind = 'plan_change' and student_id = $1", [S_PERCLASS])).rows[0].count);
    check("cada cambio de plan queda auditado (antes y después)", audits >= 6, String(audits));
    const sibling = (await plan(admin, S_MONTHLY)).billing_plan;
    check("otros alumnos no cambian", sibling.type === "monthly" && sibling.amount === 50000);

    // ---- Monto mensual
    await seed(admin);
    await charge(admin, CH(1), A, S_MONTHLY, "2026-10", 50000);
    const amt = (extra = {}) => ({ student_id: S_MONTHLY, new_amount: 60000, effective_from: "this_month", current_period: "2026-10", due_date: "2026-10-10", ...extra });
    r = await call(sa, "change_student_monthly_amount", amt());
    check("este mes con cargo vigente sin pagos: corrige el cargo y el plan", r.ok && r.value.charge_updated === true && r.value.charge_created === false && (await chargeAmount(admin, CH(1))) === 60000 && (await plan(admin, S_MONTHLY)).billing_plan.amount === 60000, JSON.stringify(r));
    check("…no deja vigencia pendiente y no crea un segundo cargo", !("pendingAmount" in (await plan(admin, S_MONTHLY)).billing_plan) && Number((await admin.query("select count(*) from public.payment_charges where student_id = $1", [S_MONTHLY])).rows[0].count) === 1);
    r = await call(sa, "change_student_monthly_amount", amt());
    check("repetir el mismo cambio: idempotente (mismo importe, sin duplicar)", r.ok && (await chargeAmount(admin, CH(1))) === 60000);
    await pay(admin, A, S_MONTHLY, CH(1), 20000);
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 75000 }));
    check("pago parcial previo: subir el importe recalcula el saldo contra el importe nuevo y no toca el pago", r.ok && (await chargeAmount(admin, CH(1))) === 75000 && Number((await admin.query("select sum(amount) from public.payment_allocations where charge_id = $1", [CH(1)])).rows[0].sum) === 20000);
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 15000 }));
    check("bajar por debajo de lo ya pagado: se rechaza (22023) y no cambia nada", !r.ok && r.code === "22023" && (await chargeAmount(admin, CH(1))) === 75000 && (await plan(admin, S_MONTHLY)).billing_plan.amount === 75000, JSON.stringify(r));
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 20000 }));
    check("bajar exactamente a lo ya pagado se acepta (saldo 0, nunca negativo)", r.ok && (await chargeAmount(admin, CH(1))) === 20000);
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 30000 }));
    check("período ya saldado: «este mes» se rechaza (22023): nunca reescribe un período cerrado", !r.ok && r.code === "22023" && (await chargeAmount(admin, CH(1))) === 20000, JSON.stringify(r));
    await pay(admin, A, S_MONTHLY, CH(1), 99, true); // un pago anulado no cuenta como pagado
    await admin.query("update public.payments set amount = 20000 where voided_at is null");
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 30000, effective_from: "next_month" }));
    check("«próximo mes» sobre un período saldado: se acepta y NO toca el cargo del mes", r.ok && r.value.charge_updated === false && (await chargeAmount(admin, CH(1))) === 20000, JSON.stringify(r));
    let p = (await plan(admin, S_MONTHLY)).billing_plan;
    check("…deja el importe pendiente desde el período siguiente y conserva el actual", p.pendingAmount === 30000 && p.pendingAmountEffectiveFrom === "2026-11" && p.amount === 20000, JSON.stringify(p));
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 31000, effective_from: "next_month", current_period: "2026-12" }));
    p = (await plan(admin, S_MONTHLY)).billing_plan;
    check("«próximo mes» cruza diciembre → enero", r.ok && p.pendingAmountEffectiveFrom === "2027-01" && p.pendingAmount === 31000, JSON.stringify(p));
    // sin cargo vigente
    r = await call(sa, "change_student_monthly_amount", amt({ current_period: "2026-11", due_date: "2026-11-10", new_amount: 52000 }));
    check("sin cargo del período, «este mes»: se CREA en el acto con el importe nuevo y su vencimiento", r.ok && r.value.charge_created === true && Number((await admin.query("select original_amount from public.payment_charges where student_id = $1 and billing_period = '2026-11' and charge_type = 'mensual'", [S_MONTHLY])).rows[0].original_amount) === 52000, JSON.stringify(r));
    r = await call(sa, "change_student_monthly_amount", amt({ current_period: "2026-11", due_date: "2026-11-10", new_amount: 52000 }));
    check("repetir la creación: no duplica el cargo", r.ok && r.value.charge_created === false && Number((await admin.query("select count(*) from public.payment_charges where student_id = $1 and billing_period = '2026-11'", [S_MONTHLY])).rows[0].count) === 1, JSON.stringify(r));
    r = await call(sa, "change_student_monthly_amount", amt({ current_period: "2026-12", due_date: "2027-01-10", new_amount: 52000 }));
    check("vencimiento fuera del período: se rechaza (22023)", !r.ok && r.code === "22023");
    await admin.query("update public.payment_charges set voided_at = now(), void_reason = 'prueba' where student_id = $1 and billing_period = '2026-11'", [S_MONTHLY]);
    r = await call(sa, "change_student_monthly_amount", amt({ current_period: "2026-11", due_date: "2026-11-10", new_amount: 53000 }));
    check("un cargo ANULADO del mismo período no se confunde con el vigente: se crea otro (el anulado queda como estaba)", r.ok && r.value.charge_created === true || (!r.ok && r.code === "40001"), JSON.stringify(r));
    r = await call(sa, "change_student_monthly_amount", { student_id: S_PERCLASS, new_amount: 1000, effective_from: "this_month", current_period: "2026-10", due_date: "2026-10-10" });
    check("alumno sin plan mensual: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "change_student_monthly_amount", amt({ new_amount: 0 }));
    check("importe 0: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "change_student_monthly_amount", amt({ effective_from: "ayer" }));
    check("vigencia inválida: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sb, "change_student_monthly_amount", amt());
    check("alumno de OTRA dueña: P0002", !r.ok && r.code === "P0002");
    check("auditoría del monto mensual", Number((await admin.query("select count(*) from public.student_billing_audit where kind = 'monthly_amount_change' and student_id = $1", [S_MONTHLY])).rows[0].count) >= 6);

    // alumno viejo sin plan explícito: se deriva mensual con el precio
    await charge(admin, CH(5), A, S_LEGACY, "2026-10", 36000);
    r = await call(sa, "change_student_monthly_amount", { student_id: S_LEGACY, new_amount: 40000, effective_from: "this_month", current_period: "2026-10", due_date: "2026-10-10" });
    p = (await plan(admin, S_LEGACY)).billing_plan;
    check("alumno mensual sin plan explícito: se deriva del precio, cambia el cargo y queda un plan explícito", r.ok && (await chargeAmount(admin, CH(5))) === 40000 && p.type === "monthly" && p.amount === 40000 && p.dueDay === 10, JSON.stringify([r, p]));

    // dos conexiones a la vez: el último estado es coherente (un cargo, un plan, importes iguales)
    await seed(admin);
    await charge(admin, CH(7), A, S_MONTHLY, "2026-10", 50000);
    const [c1, c2] = await Promise.all([
      call(await pg.session(A), "change_student_monthly_amount", amt({ new_amount: 61000 })),
      call(await pg.session(A), "change_student_monthly_amount", amt({ new_amount: 62000 })),
    ]);
    const finalCharge = await chargeAmount(admin, CH(7));
    p = (await plan(admin, S_MONTHLY)).billing_plan;
    check("dos cambios simultáneos: ambos terminan bien y el cargo y el plan quedan con el MISMO importe (sin divergir)", c1.ok && c2.ok && finalCharge === p.amount && [61000, 62000].includes(finalCharge), JSON.stringify([c1, c2, finalCharge, p.amount]));

    // ---- Transiciones entre planes: nunca borran ni reescriben cargos ni pagos; el solapamiento exige confirmación explícita
    await seed(admin);
    const snapshot = async () => {
      const c = (await admin.query("select id, charge_type, original_amount::text as a, voided_at is not null as v, due_date::text as d from public.payment_charges order by id")).rows;
      const pm = (await admin.query("select id, amount::text as a, voided_at is not null as v from public.payments order by id")).rows;
      const al = (await admin.query("select id, charge_id, amount::text as a from public.payment_allocations order by id")).rows;
      return JSON.stringify([c, pm, al]);
    };
    const T = (student, planObj, extra = {}) => call(sa, "set_student_billing_plan", { student_id: student, current_period: "2026-10", plan: planObj, ...extra });
    // alumno por clase con un cobro por clase del mes (parcialmente pagado) y otro de septiembre
    const perClass = async (id, student, due, voided = false) => {
      const reg = (await admin.query("insert into public.lesson_registrations (owner_id) values ($1) returning id", [A])).rows[0].id;
      await admin.query(
        `insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id, voided_at, void_reason) values ($1, $2, $3, 'por_clase', 8000, $4, $5, $6, $7)`,
        [id, A, student, due, reg, voided ? new Date().toISOString() : null, voided ? "prueba" : null]
      );
    };
    await perClass(CH(20), S_PERCLASS, "2026-10-06");
    await perClass(CH(21), S_PERCLASS, "2026-09-29");
    await pay(admin, A, S_PERCLASS, CH(20), 3000);
    let before = await snapshot();
    r = await T(S_PERCLASS, { type: "weekly", amount: 12000, dueWeekday: 5 });
    check("por clase → semanal con un cobro por clase del mes: se exige confirmación (22023) y no cambia nada", !r.ok && r.code === "22023" && /1 cobro/.test(r.message) && (await plan(admin, S_PERCLASS)).billing_plan === null && (await snapshot()) === before, JSON.stringify(r));
    r = await T(S_PERCLASS, { type: "weekly", amount: 12000, dueWeekday: 5 }, { acknowledge_overlap: true });
    check("…confirmado: cambia el plan, y cargos, pagos y asignaciones quedan EXACTAMENTE igual (sin borrar historial ni duplicar deuda)", r.ok && r.value.billing_plan.type === "weekly" && (await snapshot()) === before, JSON.stringify(r));
    check("…la auditoría guarda cuántos cobros había y que se confirmó", Number((await admin.query("select count(*) from public.student_billing_audit where student_id = $1 and detail->>'acknowledged' = 'true' and (detail->>'overlap_count')::int = 1", [S_PERCLASS])).rows[0].count) === 1);
    r = await T(S_PERCLASS, { type: "weekly", amount: 13000, dueWeekday: 2 });
    check("semanal → semanal (otro día/importe) no es una transición: no pide confirmación", r.ok && r.value.billing_plan.dueWeekday === 2);
    r = await T(S_PERCLASS, { type: "per_class", amount: 8000 });
    check("semanal → por clase sin cobros semanales del mes: no hay solapamiento, no pide confirmación (los cobros por clase propios no cuentan)", r.ok, JSON.stringify(r));
    // por clase → mensual: el mes ya tiene un cobro por clase → elegir desde cuándo empieza
    r = await T(S_PERCLASS, { type: "monthly", amount: 40000 });
    check("por clase → mensual con cobro por clase del mes: se exige confirmación", !r.ok && r.code === "22023");
    r = await T(S_PERCLASS, { type: "monthly", amount: 40000 }, { acknowledge_overlap: true, monthly_start: "next_period" });
    p = (await plan(admin, S_PERCLASS)).billing_plan;
    check("…«empieza el mes próximo»: el plan lleva startPeriod = mes siguiente; cargos y pagos intactos", r.ok && p.startPeriod === "2026-11" && p.type === "monthly" && (await snapshot()) === before, JSON.stringify([r, p]));
    r = await T(S_PERCLASS, { type: "monthly", amount: 40000 }, { monthly_start: "mañana" });
    check("«desde cuándo» inválido: se rechaza (22023)", !r.ok && r.code === "22023");
    // mensual con startPeriod futuro: «este mes» no crea cargo (no empezó) y sólo actualiza el plan; «próximo mes» queda programado
    r = await call(sa, "change_student_monthly_amount", { student_id: S_PERCLASS, new_amount: 45000, effective_from: "this_month", current_period: "2026-10", due_date: "2026-10-10" });
    p = (await plan(admin, S_PERCLASS)).billing_plan;
    check("mensualidad que todavía no empezó: «este mes» NO crea cargo en el período vigente y actualiza el importe del plan", r.ok && r.value.charge_created === false && r.value.charge_updated === false && p.amount === 45000 && p.startPeriod === "2026-11" && (await snapshot()) === before, JSON.stringify([r, p]));
    // mensual → por clase con la mensualidad del mes (parcialmente paga): se exige confirmación y no se toca nada
    await seed(admin);
    await charge(admin, CH(30), A, S_MONTHLY, "2026-10", 50000);
    await pay(admin, A, S_MONTHLY, CH(30), 20000);
    before = await snapshot();
    r = await T(S_MONTHLY, { type: "per_class", amount: 9000 });
    check("mensual → por clase con la mensualidad del mes: se exige confirmación y no cambia nada", !r.ok && r.code === "22023" && (await snapshot()) === before);
    r = await T(S_MONTHLY, { type: "per_class", amount: 9000 }, { acknowledge_overlap: true });
    check("…confirmado: la mensualidad y su pago parcial quedan intactos, el tipo de cobro vuelve a por clase", r.ok && (await snapshot()) === before && r.value.billing_type === "por_clase", JSON.stringify(r));
    // un cobro ANULADO o de otro mes no cuenta como solapamiento
    await seed(admin);
    await perClass(CH(40), S_PERCLASS, "2026-10-06", true);
    await perClass(CH(41), S_PERCLASS, "2026-11-03");
    r = await T(S_PERCLASS, { type: "biweekly", amount: 20000, anchorDate: "2026-10-12" });
    check("cobros anulados o de otro mes no cuentan como solapamiento: cambia sin pedir confirmación", r.ok, JSON.stringify(r));
    r = await T(S_PERCLASS, { type: "complimentary" });
    check("a «sin cargo» nunca pide confirmación y no toca cargos", r.ok);
    r = await T(S_PERCLASS, { type: "weekly", amount: 12000, dueWeekday: 1 }, { current_period: "2026-13" });
    check("período inválido en una transición: se rechaza (22023)", !r.ok && r.code === "22023");
    // generación posterior: las transiciones conviven con los cargos existentes y la clave natural (alumno, período) sigue siendo única
    await seed(admin);
    await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "weekly", amount: 12000, dueWeekday: 5 } });
    const g1 = await call(sa, "ensure_periodic_charges", "semanal", [{ student_id: S_PERCLASS, amount: 12000, period_key: "2026-W44", due_date: "2026-10-30" }]);
    await call(sa, "set_student_billing_plan", { student_id: S_PERCLASS, current_period: "2026-10", plan: { type: "weekly", amount: 15000, dueWeekday: 2 } });
    const g2 = await call(sa, "ensure_periodic_charges", "semanal", [{ student_id: S_PERCLASS, amount: 15000, period_key: "2026-W44", due_date: "2026-10-27" }]);
    check("cambiar importe/día del plan semanal a mitad de semana no duplica ni reescribe el cargo ya generado de esa semana", g1.ok && g1.value === 1 && g2.ok && g2.value === 0 && Number((await admin.query("select original_amount from public.payment_charges where student_id = $1 and charge_type = 'semanal'", [S_PERCLASS])).rows[0].original_amount) === 12000);

    // ---- Cargos semanales y quincenales
    await seed(admin);
    const cand = [
      { student_id: S_MONTHLY, amount: 12000, period_key: "2026-W44", due_date: "2026-10-30" },
      { student_id: S_PERCLASS, amount: 0, period_key: "2026-W44", due_date: "2026-10-30" }, // importe inválido: se omite
      { student_id: S_FOREIGN, amount: 9000, period_key: "2026-W44", due_date: "2026-10-30" }, // alumno ajeno: se ignora
    ];
    r = await call(sa, "ensure_periodic_charges", "semanal", cand);
    check("semanal: crea sólo el cargo válido de un alumno propio (omite importe 0 y alumno ajeno)", r.ok && r.value === 1 && Number((await admin.query("select count(*) from public.payment_charges where charge_type = 'semanal'")).rows[0].count) === 1, JSON.stringify(r));
    r = await call(sa, "ensure_periodic_charges", "semanal", cand);
    check("repetir: idempotente (0 nuevos)", r.ok && r.value === 0);
    const [d1, d2] = await Promise.all([call(await pg.session(A), "ensure_periodic_charges", "quincenal", [{ student_id: S_MONTHLY, amount: 25000, period_key: "2026-10-12", due_date: "2026-10-12" }]), call(await pg.session(A), "ensure_periodic_charges", "quincenal", [{ student_id: S_MONTHLY, amount: 25000, period_key: "2026-10-12", due_date: "2026-10-12" }])]);
    check("quincenal con dos conexiones a la vez: un solo cargo en total", d1.ok && d2.ok && d1.value + d2.value === 1 && Number((await admin.query("select count(*) from public.payment_charges where charge_type = 'quincenal'")).rows[0].count) === 1, JSON.stringify([d1, d2]));
    r = await call(sa, "ensure_periodic_charges", "mensual", cand);
    check("tipo de cargo inválido: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "ensure_periodic_charges", "semanal", [{ student_id: S_MONTHLY, amount: 12000, period_key: "2026-W45", due_date: "2026-11-06" }]);
    check("otra semana: crea un cargo nuevo para el mismo alumno", r.ok && r.value === 1);
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones correctas`);
  if (failures.length) {
    console.log("FALLAS:\n- " + failures.join("\n- "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
