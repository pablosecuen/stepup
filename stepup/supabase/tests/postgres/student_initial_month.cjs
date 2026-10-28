// Situación mensual inicial, «marcar mes pagado», retomar el cobro y alta con edad/objetivos (migración 20261031120000). Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/student_initial_month.cjs
//
// Cubre: pago declarado único y con su asignación, reintento con la misma clave (sin segundo pago), segundo pago con otra clave rechazado, saldo parcial preexistente, período obsoleto, fecha futura,
// alumno por clase, alumno ajeno / otra cuenta / anon, cargo anulado que no se vuelve a generar, retomar el cobro (este mes / el próximo, repetido sin duplicar), dos llamadas simultáneas (un solo pago),
// alta con la situación del primer mes en la MISMA transacción (pagado, pendiente, empieza el mes próximo, por clase sin cargo), reintento del alta, alta inválida sin restos, recorte contra el vencimiento
// sólo en el alta, auditoría y que ningún pago ni cargo preexistente cambie.
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");

const A = "fc000000-0000-0000-0000-000000000001";
const B = "fc000000-0000-0000-0000-000000000002";
const S = (n) => `fc100000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OP = (n) => `fc200000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function call(session, sql, params = []) {
  try {
    const { rows } = await session.query(sql, params);
    return { ok: true, value: rows[0]?.r, rows };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}
const markPaid = (session, payload) => call(session, "select public.mark_current_month_paid($1::jsonb) as r", [JSON.stringify(payload)]);
const resume = (session, payload) => call(session, "select public.resume_monthly_billing($1::jsonb) as r", [JSON.stringify(payload)]);
const createStudent = (session, op, payload, confirm = false) => call(session, "select to_jsonb(t) as r from public.create_student_with_operation($1::uuid, $2::jsonb, $3) t", [op, JSON.stringify(payload), confirm]);

async function main() {
  const pg = await start({ port: 5779 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    const today = (await admin.query("select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as d")).rows[0].d;
    const period = today.slice(0, 7);
    const next = (await admin.query("select to_char(($1::text || '-01')::date + interval '1 month', 'YYYY-MM') as p", [period])).rows[0].p;
    const due = `${period}-01`;

    await admin.query("truncate public.students cascade");
    await admin.query("delete from public.student_creation_claims");
    await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
    const student = (n, owner, billing, plan = null, status = "activo") =>
      admin.query(
        `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price, billing_plan, status)
         values ($1, $2, $3, 'presencial', 'otro', $4, '2026-01-01', 10000, $5::jsonb, $6)`,
        [S(n), owner, `Alumno ${n}`, billing, plan ? JSON.stringify(plan) : null, status]
      );
    await student(1, A, "mensual"); // plan derivado, sin cargo
    await student(2, A, "mensual"); // con cargo parcialmente pagado
    await student(3, A, "por_clase");
    await student(4, A, "mensual"); // cargo anulado
    await student(5, A, "mensual"); // retomar el cobro
    await student(6, A, "mensual"); // dos llamadas simultáneas
    await student(7, B, "mensual"); // otra cuenta
    await student(8, A, "mensual", null, "archivado"); // inactivo para generar cargos

    const sa = await pg.session(A);
    const sb = await pg.session(B);
    const anon = await pg.session(null, "anon");
    const count = async (sql, params) => Number((await admin.query(sql, params)).rows[0].n);
    const payload = (n, op, extra = {}) => ({ operation_id: op, student_id: S(n), current_period: period, due_date: due, ...extra });

    // ---- Marcar mes actual como pagado
    const first = await markPaid(sa, payload(1, OP(1)));
    check("marcar pagado crea el cargo del mes y UN pago con su asignación", first.ok && first.value.charge_created === true && first.value.replayed === false, first.message);
    const pay1 = (await admin.query("select * from public.payments where student_id = $1", [S(1)])).rows;
    check("el pago es completo, en efectivo y queda marcado como situación inicial declarada", pay1.length === 1 && Number(pay1[0].amount) === 10000 && pay1[0].method === "efectivo" && pay1[0].source === "initial_student_setup");
    check("la asignación cubre exactamente el cargo", (await count("select count(*) n from public.payment_allocations where student_id = $1 and amount = 10000", [S(1)])) === 1);
    check("«marcar pagado» NO recorta la fecha real (la confirmación es de hoy)", String(pay1[0].paid_at.toISOString?.().slice(0, 10) ?? pay1[0].paid_at).slice(0, 10) === today);
    const replay = await markPaid(sa, payload(1, OP(1)));
    check("repetir con la MISMA clave devuelve el mismo pago, sin un segundo pago", replay.ok && replay.value.replayed === true && replay.value.payment_id === first.value.payment_id && (await count("select count(*) n from public.payments where student_id = $1", [S(1)])) === 1);
    const again = await markPaid(sa, payload(1, OP(2)));
    check("otra clave sobre un período ya saldado se rechaza con un mensaje claro y no duplica", !again.ok && /ya está saldado/.test(again.message) && (await count("select count(*) n from public.payments where student_id = $1", [S(1)])) === 1);
    check("no se creó una segunda mensualidad", (await count("select count(*) n from public.payment_charges where student_id = $1 and charge_type = 'mensual'", [S(1)])) === 1);

    // ---- Saldo preexistente
    await admin.query("insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values ($1, $2, $3, 'mensual', 10000, $4, $5)", ["fc300000-0000-0000-0000-000000000002", A, S(2), due, period]);
    await admin.query("insert into public.payments (id, owner_id, operation_id, student_id, amount, method, paid_at) values ($1, $2, $3, $4, 3000, 'transferencia', $5)", ["fc400000-0000-0000-0000-000000000002", A, OP(50), S(2), due]);
    await admin.query("insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1, $2, $3, $4, 3000)", [A, "fc400000-0000-0000-0000-000000000002", "fc300000-0000-0000-0000-000000000002", S(2)]);
    const partial = await markPaid(sa, payload(2, OP(3)));
    const paid2 = (await admin.query("select amount from public.payments where student_id = $1 and operation_id = $2", [S(2), OP(3)])).rows[0];
    check("con un pago parcial previo paga SÓLO el saldo (7.000), sin tocar el pago anterior", partial.ok && partial.value.charge_created === false && Number(paid2.amount) === 7000 && (await count("select count(*) n from public.payments where student_id = $1 and voided_at is null", [S(2)])) === 2);

    // ---- Validaciones y permisos
    check("un período obsoleto (cambio de mes con la pantalla abierta) se rechaza", !(await markPaid(sa, payload(5, OP(4), { current_period: "2020-01" }))).ok);
    check("una fecha de pago futura se rechaza", !(await markPaid(sa, payload(5, OP(5), { paid_at: "2999-01-01" }))).ok);
    const byClass = await markPaid(sa, payload(3, OP(6)));
    check("un alumno por clase no tiene mensualidad que marcar", !byClass.ok && /plan de cobro mensual/.test(byClass.message));
    const foreign = await markPaid(sa, payload(7, OP(7)));
    check("el alumno de otra cuenta no existe para quien llama (nada se crea)", !foreign.ok && foreign.code === "P0002" && (await count("select count(*) n from public.payments where student_id = $1", [S(7)])) === 0);
    check("la otra cuenta no puede operar sobre un alumno ajeno", !(await markPaid(sb, payload(1, OP(8)))).ok);
    check("sin sesión (anon) la función no se puede ejecutar", !(await markPaid(anon, payload(5, OP(9)))).ok);
    const inactive = await markPaid(sa, payload(8, OP(10)));
    check("a un alumno archivado no se le genera una mensualidad nueva", !inactive.ok && /alumno activo/.test(inactive.message) && (await count("select count(*) n from public.payment_charges where student_id = $1", [S(8)])) === 0);

    // ---- Cargo anulado: no se regenera
    await admin.query("insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period, voided_at, void_reason) values ($1, $2, 'mensual', 10000, $3, $4, now(), 'x')", [A, S(4), due, period]);
    const voided = await markPaid(sa, payload(4, OP(11)));
    check("con la mensualidad del mes anulada no se crea otra ni se registra un pago", !voided.ok && /fue anulada/.test(voided.message) && (await count("select count(*) n from public.payments where student_id = $1", [S(4)])) === 0 && (await count("select count(*) n from public.payment_charges where student_id = $1", [S(4)])) === 1);

    // ---- Retomar el cobro
    const next5 = await resume(sa, { student_id: S(5), choice: "next_month", current_period: period });
    const plan5 = (await admin.query("select billing_plan from public.students where id = $1", [S(5)])).rows[0].billing_plan;
    check("retomar el próximo mes: la mensualidad empieza el período siguiente y no se genera deuda", next5.ok && plan5.startPeriod === next && (await count("select count(*) n from public.payment_charges where student_id = $1", [S(5)])) === 0);
    const this5 = await resume(sa, { student_id: S(5), choice: "this_month", current_period: period, due_date: due });
    const plan5b = (await admin.query("select billing_plan from public.students where id = $1", [S(5)])).rows[0].billing_plan;
    check("después elegir «desde este mes» genera exactamente un cargo y mueve el inicio al período vigente", this5.ok && this5.value.charge_created === true && plan5b.startPeriod === period && Number(plan5b.amount) === 10000);
    const this5b = await resume(sa, { student_id: S(5), choice: "this_month", current_period: period, due_date: due });
    check("repetir «desde este mes» no duplica el cargo", this5b.ok && this5b.value.charge_created === false && (await count("select count(*) n from public.payment_charges where student_id = $1 and charge_type = 'mensual'", [S(5)])) === 1);
    const keep = await resume(sa, { student_id: S(5), choice: "next_month", current_period: period });
    check("elegir el próximo mes con el cargo ya generado lo conserva tal cual (no se anula ni se borra)", keep.ok && (await count("select count(*) n from public.payment_charges where student_id = $1 and charge_type = 'mensual' and voided_at is null", [S(5)])) === 1);
    check("una opción inválida se rechaza", !(await resume(sa, { student_id: S(5), choice: "ayer", current_period: period })).ok);

    // ---- Concurrencia: dos «marcar pagado» simultáneos con claves distintas
    const sa2 = await pg.session(A);
    const [r1, r2] = await Promise.all([markPaid(sa, payload(6, OP(20))), markPaid(sa2, payload(6, OP(21)))]);
    check("dos llamadas simultáneas: exactamente UNA registra el pago y la otra se rechaza", [r1, r2].filter((r) => r.ok).length === 1 && (await count("select count(*) n from public.payments where student_id = $1", [S(6)])) === 1);
    check("…y queda una sola mensualidad", (await count("select count(*) n from public.payment_charges where student_id = $1 and charge_type = 'mensual'", [S(6)])) === 1);

    // ---- Alta con la situación del primer mes (misma transacción)
    const base = (extra = {}) => ({ name: "Alta Nueva", modality: "online", category: "otro", billingType: "mensual", dateJoined: today, price: 25000, levels: ["B1"], birthDate: "2000-01-01", currentGoals: ["IELTS", "Speaking"], ...extra });
    const paid = await createStudent(sa, OP(30), base({ firstMonth: { situation: "paid", currentPeriod: period, dueDate: due, paidAt: today } }));
    const paidId = paid.rows?.[0]?.r?.student_id;
    check("alta con «este mes ya está pago»: alumno, cargo, pago y asignación juntos", paid.ok && paid.value.status === "created" && (await count("select count(*) n from public.payment_charges where student_id = $1", [paidId])) === 1 && (await count("select count(*) n from public.payments where student_id = $1 and source = 'initial_student_setup' and amount = 25000", [paidId])) === 1);
    const stored = (await admin.query("select birth_date::text, current_goals from public.students where id = $1", [paidId])).rows[0];
    check("el alta guarda la edad (fecha estimada) y los objetivos", stored.birth_date === "2000-01-01" && stored.current_goals.join("|") === "IELTS|Speaking");
    const paidRow = (await admin.query("select paid_at::text from public.payments where student_id = $1", [paidId])).rows[0];
    check("en el alta la fecha de pago nunca queda después del vencimiento (no es una mora real)", paidRow.paid_at <= due, paidRow.paid_at);
    const replayAlta = await createStudent(sa, OP(30), base({ firstMonth: { situation: "paid", currentPeriod: period, dueDate: due, paidAt: today } }));
    check("reintentar el alta con la misma clave devuelve el mismo alumno sin segundo pago ni segundo cargo", replayAlta.ok && replayAlta.value.replayed === true && replayAlta.value.student_id === paidId && (await count("select count(*) n from public.payments where student_id = $1", [paidId])) === 1 && (await count("select count(*) n from public.payment_charges where student_id = $1", [paidId])) === 1);

    const pending = await createStudent(sa, OP(31), base({ name: "Alta Pendiente", firstMonth: { situation: "pending", currentPeriod: period, dueDate: due } }));
    const pendingId = pending.rows?.[0]?.r?.student_id;
    check("alta «este mes está pendiente»: cargo del mes y ningún pago", pending.ok && (await count("select count(*) n from public.payment_charges where student_id = $1", [pendingId])) === 1 && (await count("select count(*) n from public.payments where student_id = $1", [pendingId])) === 0);
    const nextAlta = await createStudent(sa, OP(32), base({ name: "Alta Proxima", firstMonth: { situation: "starts_next_month", currentPeriod: period } }));
    const nextId = nextAlta.rows?.[0]?.r?.student_id;
    const nextPlan = nextId ? (await admin.query("select billing_plan from public.students where id = $1", [nextId])).rows[0].billing_plan : null;
    check("alta «desde el próximo mes»: sin cargo ni pago y la mensualidad empieza el período siguiente", nextAlta.ok && nextPlan?.startPeriod === next && nextPlan.type === "monthly" && (await count("select count(*) n from public.payment_charges where student_id = $1", [nextId])) === 0);
    const byClassAlta = await createStudent(sa, OP(33), base({ name: "Alta Por Clase", billingType: "por_clase" }));
    const byClassId = byClassAlta.rows?.[0]?.r?.student_id;
    check("alta por clase: sin cargo ni pago", byClassAlta.ok && (await count("select count(*) n from public.payment_charges where student_id = $1", [byClassId])) === 0);

    const noFirst = await createStudent(sa, OP(40), base({ name: "Sin Situacion" }));
    const noFirstId = noFirst.rows?.[0]?.r?.student_id;
    check("un alta mensual sin «situación del primer mes» (compatibilidad) no genera cargo ni toca el plan", noFirst.ok && (await count("select count(*) n from public.payment_charges where student_id = $1", [noFirstId])) === 0 && (await admin.query("select billing_plan from public.students where id = $1", [noFirstId])).rows[0].billing_plan === null);

    const before = {
      students: await count("select count(*) n from public.students"),
      claims: await count("select count(*) n from public.student_creation_claims"),
      payments: await count("select count(*) n from public.payments"),
    };
    const bad = await createStudent(sa, OP(34), base({ name: "Alta Rota", firstMonth: { situation: "paid", currentPeriod: "2020-01", dueDate: due, paidAt: today } }));
    check("si la situación del primer mes no se puede aplicar, NO queda ni el alumno ni el claim ni pago alguno", !bad.ok && (await count("select count(*) n from public.students")) === before.students && (await count("select count(*) n from public.student_creation_claims")) === before.claims && (await count("select count(*) n from public.payments")) === before.payments);
    check("precio cero se rechaza en el alta (como el original)", !(await createStudent(sa, OP(35), base({ name: "Precio Cero", price: 0 }))).ok);
    check("frecuencia semanal mayor a 14, duración mayor a 480 y correo mal escrito se rechazan también en la base", !(await createStudent(sa, OP(36), base({ name: "F", weeklyFrequency: 15 }))).ok && !(await createStudent(sa, OP(37), base({ name: "D", usualDurationMinutes: 481 }))).ok && !(await createStudent(sa, OP(38), base({ name: "E", email: "no-es-correo" }))).ok);
    check("una edad fuera de rango (fecha de nacimiento en el futuro) se rechaza", !(await createStudent(sa, OP(39), base({ name: "Futuro", birthDate: "2999-01-01" }))).ok);

    // ---- Edad al editar, auditoría y aislamiento
    const upd = await call(sa, "update public.students set birth_date = '1990-01-01' where id = $1 returning birth_date::text as r", [S(1)]);
    check("la profesora puede actualizar la edad de su alumno", upd.ok && upd.value === "1990-01-01");
    check("…pero no la de uno ajeno", (await call(sb, "update public.students set birth_date = '1990-01-01' where id = $1 returning 1 as r", [S(1)])).value === undefined);
    check("la auditoría registra la situación inicial y el retomar cobro", (await count("select count(*) n from public.student_billing_audit where owner_id = $1 and kind = 'initial_month_situation'", [A])) >= 4 && (await count("select count(*) n from public.student_billing_audit where owner_id = $1 and kind = 'monthly_billing_resume'", [A])) >= 3);
    check("la otra cuenta no ve la auditoría de esta", (await call(sb, "select count(*)::int as r from public.student_billing_audit")).value === 0);
    // ---- Comparación directa con el original: `planEnsureMonthlyChargeSituation` ejecutado con la misma situación de partida que la base real.
    const orig = await import(pathToFileURL(path.join(__dirname, "..", "..", "..", "lib", "original-core", "features", "payments", "utils", "initialMonthlyBillingPlan.ts")).href);
    const emptyState = { charges: [], payments: [], allocations: [], adjustments: [] };
    const origCharge = (amount) => ({ id: "oc", studentId: "o", type: "mensual", originalAmount: amount, currency: "ARS", dueDate: due, createdAt: `${period}-01T12:00:00.000Z`, billingPeriod: period, voidedAt: null });
    const origRun = (situation, state, extra = {}) =>
      orig.planEnsureMonthlyChargeSituation({ studentId: "o", situation, amount: 10000, billingPeriod: period, dueDay: 10, paidAt: today, method: "efectivo", todayDateKey: today, createdAt: `${today}T12:00:00.000Z`, recordedAt: `${today}T12:00:00.000Z`, chargeId: "oc", paymentId: "op", allocationId: "oa", state, ...extra });
    const o1 = origRun("paid", emptyState, { clampPaidAtToDueDate: false });
    check("original = base: sin cargo, «pagado» crea el cargo y un pago por el importe completo", o1.chargeToCreate !== null && o1.payment.amount === 10000 && first.value.charge_created === true && Number(pay1[0].amount) === o1.payment.amount);
    const origPartialState = { ...emptyState, charges: [origCharge(10000)], payments: [{ id: "pp", studentId: "o", amount: 3000, currency: "ARS", method: "transferencia", paidAt: due, recordedAt: `${due}T12:00:00.000Z`, voidedAt: null }], allocations: [{ id: "aa", paymentId: "pp", chargeId: "oc", studentId: "o", amount: 3000 }] };
    const o2 = origRun("paid", origPartialState, { clampPaidAtToDueDate: false });
    check("original = base: con un pago parcial previo paga SÓLO el saldo", o2.chargeToCreate === null && o2.payment.amount === 7000 && Number(paid2.amount) === o2.payment.amount);
    const settledState = { ...emptyState, charges: [origCharge(10000)], payments: [{ id: "pp", studentId: "o", amount: 10000, currency: "ARS", method: "efectivo", paidAt: due, recordedAt: `${due}T12:00:00.000Z`, voidedAt: null }], allocations: [{ id: "aa", paymentId: "pp", chargeId: "oc", studentId: "o", amount: 10000 }] };
    let origSettledError = null;
    try { origRun("paid", settledState, { clampPaidAtToDueDate: false }); } catch (error) { origSettledError = String(error.message); }
    check("original = base: un período ya saldado se rechaza con el mismo mensaje", origSettledError !== null && again.message.includes(origSettledError), `${origSettledError} | ${again.message}`);
    const oClamp = origRun("paid", { ...emptyState, charges: [origCharge(10000)] }, { clampPaidAtToDueDate: true });
    check("original = base: en el alta la fecha de pago se recorta al vencimiento", oClamp.payment.paidAt === due && paidRow.paid_at === oClamp.payment.paidAt);
    const oNoClamp = origRun("paid", { ...emptyState, charges: [origCharge(10000)] }, { clampPaidAtToDueDate: false });
    check("original = base: al marcar el mes pagado la fecha real NO se recorta", oNoClamp.payment.paidAt === today && String(pay1[0].paid_at.toISOString?.().slice(0, 10) ?? pay1[0].paid_at).slice(0, 10) === oNoClamp.payment.paidAt);
    const oNext = origRun("starts_next_month", emptyState);
    check("original = base: «desde el próximo mes» no crea cargo ni pago y empieza el período siguiente", oNext.chargeToCreate === null && oNext.payment === null && oNext.billingPeriodStart === next && nextPlan?.startPeriod === oNext.billingPeriodStart);
    const oPending = origRun("pending", emptyState);
    check("original = base: «pendiente» crea el cargo y ningún pago", oPending.chargeToCreate !== null && oPending.payment === null && (await count("select count(*) n from public.payments where student_id = $1", [pendingId])) === 0);


    // Reactivation and billing must roll back together, including history and the charge.
    await student(9,A,'mensual',null,'pausado');
    const reactivate=(session,choice='this_month',p=period)=>call(session,'select (public.reactivate_student_with_billing($1,$2,null,null,$3,$4,$5)).status as r',[S(9),today,choice,p,due]);
    check('reactivar mensual exige la elección también en servidor',!(await reactivate(sa,null)).ok&&(await admin.query('select status from students where id=$1',[S(9)])).rows[0].status==='pausado');
    check('error financiero revierte el cambio de estado',!(await reactivate(sa,'this_month','2000-01')).ok&&(await count('select count(*) n from student_status_history where student_id=$1',[S(9)]))===0);
    await admin.query(`create function public.qa_fail_resume() returns trigger language plpgsql as $$begin if new.student_id='${S(9)}'::uuid and new.kind='monthly_billing_resume' then raise exception 'QA failure';end if;return new;end $$;create trigger qa_fail_resume before insert on student_billing_audit for each row execute function public.qa_fail_resume();`);
    check('fallo intermedio revierte alumno, historial y cargo',!(await reactivate(sa)).ok&&(await admin.query('select status from students where id=$1',[S(9)])).rows[0].status==='pausado'&&(await count('select count(*) n from payment_charges where student_id=$1',[S(9)]))===0&&(await count('select count(*) n from student_status_history where student_id=$1',[S(9)]))===0);
    await admin.query('drop trigger qa_fail_resume on student_billing_audit;drop function qa_fail_resume()');
    const restored=await Promise.all([reactivate(sa),reactivate(sa2)]);
    check('reactivaciones simultáneas dejan un estado, un historial y un cargo',restored.every(r=>r.ok)&&(await count('select count(*) n from student_status_history where student_id=$1',[S(9)]))===1&&(await count('select count(*) n from payment_charges where student_id=$1',[S(9)]))===1);
    check('otra cuenta no reactiva un alumno ajeno',!(await reactivate(sb)).ok);
    check('anon no puede reactivar',!(await reactivate(anon)).ok);

    const preexisting = (await admin.query("select amount from public.payments where id = $1", ["fc400000-0000-0000-0000-000000000002"])).rows[0];
    check("el pago preexistente no cambió", Number(preexisting.amount) === 3000);
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
