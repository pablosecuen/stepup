// Tarifa POR HORA (migración 20261124100000) sobre Postgres REAL: la base valida y calcula con la MISMA regla que `lib/payments/lesson-amount.ts`.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/hourly_rate_billing.mjs
//
// Cubre: diferencial TypeScript ↔ SQL (importes y resultado de la clase), el circuito completo de cobro (clase individual/grupal, suelta/recurrente, duración extendida o editada antes y después de
// generar el cargo, reintentos, tarifa congelada, cambio de tarifa por fecha), lo que NO debe tocarse (importe fijo, cargos con pagos, cargos anteriores a la tarifa horaria, importes personalizados),
// la corrección segura de cargos pendientes (revisión, aplicación, reversión) y el aislamiento entre cuentas.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { importLib } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
const { computeHourlyAmount } = await importLib("payments/lesson-amount.ts");
const { computePerClassBilledAmount } = await importLib("payments/adhoc-billing.ts");

const A = "a1000000-0000-4000-8000-000000000001";
const B = "b1000000-0000-4000-8000-000000000001";
const ID = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const num = (value) => Number(value);

const pg = await start({ port: 5970 + Math.floor(Math.random() * 200) });
const admin = pg.admin;
const sessions = [];
try {
  eq(JSON.stringify(pg.failures), "[]", "todas las migraciones (incluida la de tarifa por hora) cargan sin errores");
  await admin.query("insert into auth.users(id,email) values ($1,'a@example.test'),($2,'b@example.test')", [A, B]);
  const a = await pg.session(A);
  const b = await pg.session(B);
  sessions.push(a, b);

  // ---------- Fábricas ----------
  let seq = 100;
  const student = async (owner, name, { billingType = "por_clase", price = 36000, plan = null } = {}) => {
    const id = ID("5", ++seq);
    await admin.query(
      "insert into public.students (id, owner_id, name, modality, category, billing_type, billing_plan, date_joined, price) values ($1,$2,$3,'presencial','otro',$4,$5::jsonb,'2026-01-05',$6)",
      [id, owner, name, billingType, plan === null ? null : JSON.stringify(plan), price],
    );
    return id;
  };
  const iso = (date, hh, mm = 0) => `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
  const addMinutes = (isoText, minutes) => new Date(Date.parse(isoText) + minutes * 60_000).toISOString();
  /** Registro finalizado con la duración programada (calendario) y, si se indica, la real. */
  const registration = async (owner, studentId, { date = "2026-11-10", hour = 15, scheduled = 60, actual = null, outcome = "clase_dictada", counts = true, policy = null, pct = null, withCalendar = true } = {}) => {
    const regId = ID("7", ++seq);
    const startAt = iso(date, hour);
    let calId = null;
    if (withCalendar) {
      calId = ID("c", seq);
      await admin.query(
        "insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color) values ($1,$2,$3,'Alumno','A1','individual',$4,$5,'presencial','completed','#FCE4D2')",
        [calId, owner, studentId, startAt, addMinutes(startAt, scheduled)],
      );
    }
    await admin.query(
      `insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, status, counts_as_class, scheduled_start_at, scheduled_end_at, actual_started_at, actual_ended_at, outcome, late_cancellation_policy, late_cancellation_percentage)
       values ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [regId, owner, calId, counts, startAt, addMinutes(startAt, scheduled), actual ? startAt : null, actual ? addMinutes(startAt, actual) : null, outcome, policy, pct],
    );
    return regId;
  };
  const registrationRow = async (regId) => (await admin.query("select * from public.lesson_registrations where id=$1", [regId])).rows[0];
  const iso8601 = (value) => (value instanceof Date ? value.toISOString() : value);
  /** Lo MISMO que hace `syncPerClassChargesForRegistration` (lib/actions/lesson-registrations.ts) para UN alumno, con las funciones compartidas. */
  const clientAmount = async (studentId, regId) => {
    const row = (await admin.query("select * from public.students where id=$1", [studentId])).rows[0];
    const plan = row.billing_plan && row.billing_plan !== null && typeof row.billing_plan === "object" ? row.billing_plan : row.billing_type === "mensual" ? { type: "monthly", amount: num(row.price) } : { type: "per_class", amount: num(row.price) };
    if (plan.type !== "per_class") return null;
    const reg = await registrationRow(regId);
    const calendar = reg.calendar_lesson_id ? (await admin.query("select start_at, end_at from public.calendar_lessons where id=$1", [reg.calendar_lesson_id])).rows[0] : null;
    // Los MISMOS horarios que arma `syncPerClassChargesForRegistration` (lib/actions/lesson-registrations.ts).
    const lessonTimes = {
      actualStartedAt: iso8601(reg.actual_started_at),
      actualEndedAt: iso8601(reg.actual_ended_at),
      ...(reg.scheduled_start_at && reg.scheduled_end_at ? { scheduledStartAt: iso8601(reg.scheduled_start_at), scheduledEndAt: iso8601(reg.scheduled_end_at) } : { scheduledStartAt: iso8601(calendar?.start_at ?? null), scheduledEndAt: iso8601(calendar?.end_at ?? null) }),
    };
    const common = { outcome: reg.outcome, isClassHeld: reg.counts_as_class, lateCancellationPolicy: reg.late_cancellation_policy, lateCancellationPercentage: reg.late_cancellation_percentage === null ? null : num(reg.late_cancellation_percentage) };
    const amount = computePerClassBilledAmount({ perClassAmount: plan.amount, rateBasis: plan.rateBasis === "hour" ? "hour" : "class", lessonTimes, ...common });
    return amount > 0 ? amount : null;
  };
  const sync = (session, regId, participants) => session.query("select public.sync_per_class_charge($1, $2::jsonb) as n", [regId, JSON.stringify(participants.map((p) => ({ student_id: p.studentId, amount: p.amount })))]);
  const syncReal = async (session, regId, studentIds) => {
    const participants = [];
    for (const studentId of studentIds) participants.push({ studentId, amount: await clientAmount(studentId, regId) });
    return sync(session, regId, participants);
  };
  const charge = async (studentId, regId) => (await admin.query("select * from public.payment_charges where student_id=$1 and saved_lesson_id=$2 and charge_type='por_clase'", [studentId, regId])).rows[0];
  const chargeCount = async () => num((await admin.query("select count(*) from public.payment_charges")).rows[0].count);
  const setPlan = (session, studentId, plan) => session.query("select public.set_student_billing_plan($1::jsonb)", [JSON.stringify({ student_id: studentId, plan, current_period: "2026-11", acknowledge_overlap: true, monthly_start: "this_period" })]);
  const pay = async (owner, studentId, chargeId, amount) => {
    const paymentId = ID("9", ++seq);
    await admin.query("insert into public.payments (id, owner_id, student_id, amount, method, paid_at) values ($1,$2,$3,$4,'efectivo',current_date)", [paymentId, owner, studentId, amount]);
    await admin.query("insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1,$2,$3,$4,$5)", [owner, paymentId, chargeId, studentId, amount]);
    return paymentId;
  };

  // ---------- 1) Diferencial TypeScript ↔ SQL ----------
  {
    const rates = [36000, 27500.5, 10000, 0.01, 1.01, 8333.33, 99999.99, 12345.67, 500, 250000];
    let compared = 0;
    for (const rate of rates) {
      for (let minutes = 1; minutes <= 300; minutes += 1) {
        const sql = num((await admin.query("select public.lesson_hourly_amount($1::numeric, $2::int) as v", [rate, minutes])).rows[0].v);
        if (sql !== computeHourlyAmount(rate, minutes)) assert.fail(`tarifa ${rate} × ${minutes} min: SQL ${sql} ≠ TS ${computeHourlyAmount(rate, minutes)}`);
        compared += 1;
      }
    }
    ok(compared === rates.length * 300, `${compared} combinaciones tarifa×minutos idénticas en TypeScript y SQL`);
    const outcomes = [
      { outcome: "clase_dictada", held: true, policy: null, pct: null },
      { outcome: "cancelada_tarde", held: false, policy: "cobrar_100", pct: null },
      { outcome: "cancelada_tarde", held: false, policy: "cobrar_porcentaje", pct: 50 },
      { outcome: "cancelada_tarde", held: false, policy: "cobrar_porcentaje", pct: 33 },
      { outcome: "cancelada_tarde", held: false, policy: "cobrar_porcentaje", pct: 12.5 },
      { outcome: "cancelada_tarde", held: false, policy: "cobrar_porcentaje", pct: 0 },
      { outcome: "cancelada_tarde", held: false, policy: "no_cobrar", pct: null },
      { outcome: "cancelada_tarde", held: false, policy: "descontar_del_paquete", pct: null },
      { outcome: "alumno_ausente", held: false, policy: null, pct: null },
      { outcome: "reprogramada", held: false, policy: null, pct: null },
      { outcome: "feriado", held: true, policy: null, pct: null },
    ];
    let combos = 0;
    for (const o of outcomes) {
      for (const rate of [36000, 27500.5, 8333.33, 12345.67]) {
        for (const minutes of [45, 60, 75, 90, 120, 135, 50, 40]) {
          const lessonTimes = { scheduledStartAt: "2026-11-10T15:00:00.000Z", scheduledEndAt: new Date(Date.parse("2026-11-10T15:00:00.000Z") + minutes * 60_000).toISOString() };
          const expectedHour = computePerClassBilledAmount({ perClassAmount: rate, rateBasis: "hour", lessonTimes, outcome: o.outcome, isClassHeld: o.held, lateCancellationPolicy: o.policy, lateCancellationPercentage: o.pct });
          const sqlHour = num((await admin.query("select public.lesson_billed_amount(public.lesson_hourly_amount($1::numeric,$2::int), $3, $4, $5, $6::numeric) as v", [rate, minutes, o.outcome, o.held, o.policy, o.pct])).rows[0].v);
          if (sqlHour !== expectedHour) assert.fail(`hora ${JSON.stringify(o)} tarifa ${rate} ${minutes} min: SQL ${sqlHour} ≠ TS ${expectedHour}`);
          const expectedFixed = computePerClassBilledAmount({ perClassAmount: rate, outcome: o.outcome, isClassHeld: o.held, lateCancellationPolicy: o.policy, lateCancellationPercentage: o.pct });
          const sqlFixed = num((await admin.query("select public.lesson_billed_amount($1::numeric, $2, $3, $4, $5::numeric) as v", [rate, o.outcome, o.held, o.policy, o.pct])).rows[0].v);
          if (sqlFixed !== expectedFixed) assert.fail(`fija ${JSON.stringify(o)} importe ${rate}: SQL ${sqlFixed} ≠ TS ${expectedFixed}`);
          combos += 1;
        }
      }
    }
    ok(combos > 0, `${combos} combinaciones resultado×tarifa×minutos idénticas (tarifa por hora y importe fijo)`);
  }

  // ---------- 2) Plan de cobro: la base se declara expresamente y se conserva ----------
  const hourly = await student(A, "Hora Uno", { plan: null, price: 36000 }); // alumno ANTIGUO: sin base declarada
  {
    const before = (await admin.query("select billing_plan from public.students where id=$1", [hourly])).rows[0].billing_plan;
    eq(before, null, "un alumno antiguo no cambia por correr la migración");
    await assert.rejects(setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "weekly" }), /La base de la tarifa no es válida/); checks += 1;
    await setPlan(a, hourly, { type: "per_class", amount: 36000 });
    eq((await admin.query("select billing_plan from public.students where id=$1", [hourly])).rows[0].billing_plan.rateBasis, undefined, "sin base declarada queda importe fijo");
    await setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "hour" });
    const plan = (await admin.query("select billing_plan from public.students where id=$1", [hourly])).rows[0].billing_plan;
    eq(plan.rateBasis, "hour", "el plan por hora conserva rateBasis");
    eq(num(plan.amount), 36000, "y su tarifa");
    await setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "class" });
    eq((await admin.query("select billing_plan from public.students where id=$1", [hourly])).rows[0].billing_plan.rateBasis, undefined, "volver a importe fijo borra la base");
    await setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "hour" });
    await setPlan(a, hourly, { type: "weekly", amount: 20000, dueWeekday: 2 });
    eq((await admin.query("select billing_plan from public.students where id=$1", [hourly])).rows[0].billing_plan.rateBasis, undefined, "otro tipo de plan no lleva la base");
    await setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "hour" });
  }
  // Auditoría con el cambio hecho a una fecha antigua: el alumno es por hora «desde siempre» para las clases de noviembre.
  await admin.query(
    "with ordered as (select id, row_number() over (order by created_at, id) as n from public.student_billing_audit where student_id=$1) update public.student_billing_audit a set created_at = timestamptz '2026-01-10 12:00:00+00' + (o.n || ' minutes')::interval from ordered o where a.id = o.id",
    [hourly],
  );

  // ---------- 3) Los seis ejemplos de duración, clase individual suelta ----------
  const expected = new Map([[45, 27000], [60, 36000], [75, 45000], [90, 54000], [120, 72000], [135, 81000]]);
  const regsByMinutes = new Map();
  for (const [minutes, amount] of expected) {
    const regId = await registration(A, hourly, { date: { 45: "2026-11-06", 60: "2026-11-07", 75: "2026-11-08", 90: "2026-11-09", 120: "2026-11-10", 135: "2026-11-11" }[minutes], scheduled: minutes });
    regsByMinutes.set(minutes, regId);
    await syncReal(a, regId, [hourly]);
    const row = await charge(hourly, regId);
    eq(num(row.original_amount), amount, `${minutes} min con $36.000 por hora ⇒ ${amount}`);
    eq(num(row.rate_per_hour), 36000, "la tarifa queda congelada en el cargo");
    eq(row.billed_minutes, minutes, "los minutos facturados quedan en el cargo");
  }
  eq(num((await charge(hourly, regsByMinutes.get(90))).original_amount), 54000, "caso informado: $36.000/h × 90 min = $54.000");

  // ---------- 4) Reintento / recarga: ningún cargo duplicado ----------
  {
    const before = await chargeCount();
    for (let i = 0; i < 3; i += 1) for (const regId of regsByMinutes.values()) await syncReal(a, regId, [hourly]);
    eq(await chargeCount(), before, "repetir la sincronización no crea cargos nuevos");
    eq(num((await charge(hourly, regsByMinutes.get(90))).original_amount), 54000, "ni cambia el importe");
    // Dos sincronizaciones simultáneas de la misma clase.
    const regId = await registration(A, hourly, { date: "2026-11-21", scheduled: 90 });
    const second = await pg.session(A);
    sessions.push(second);
    await Promise.all([syncReal(a, regId, [hourly]), syncReal(second, regId, [hourly])]);
    eq(num((await admin.query("select count(*) from public.payment_charges where saved_lesson_id=$1", [regId])).rows[0].count), 1, "dos reintentos simultáneos dejan un único cargo");
  }

  // ---------- 5) Cambiar sólo el horario de inicio no cambia el importe ----------
  {
    const regId = await registration(A, hourly, { date: "2026-11-22", hour: 9, scheduled: 90 });
    const regLate = await registration(A, hourly, { date: "2026-11-23", hour: 20, scheduled: 90 });
    await syncReal(a, regId, [hourly]);
    await syncReal(a, regLate, [hourly]);
    eq(num((await charge(hourly, regId)).original_amount), num((await charge(hourly, regLate)).original_amount), "misma duración, distinto horario ⇒ mismo importe");
  }

  // ---------- 6) Extensión ANTES de generar el cargo (la clase ya extendida es la que se factura) ----------
  {
    const regId = await registration(A, hourly, { date: "2026-11-24", scheduled: 60 });
    await admin.query("update public.calendar_lessons set end_at = end_at + interval '30 minutes' where id=(select calendar_lesson_id from public.lesson_registrations where id=$1)", [regId]);
    await admin.query("update public.lesson_registrations set scheduled_end_at = scheduled_end_at + interval '30 minutes' where id=$1", [regId]);
    await syncReal(a, regId, [hourly]);
    eq(num((await charge(hourly, regId)).original_amount), 54000, "60 + 30 min extendidos antes de registrar ⇒ 54.000");
  }

  // ---------- 7) Edición de la duración DESPUÉS de generar el cargo (sin pagos) ----------
  {
    const regId = await registration(A, hourly, { date: "2026-11-25", scheduled: 60, actual: 60 });
    await syncReal(a, regId, [hourly]);
    eq(num((await charge(hourly, regId)).original_amount), 36000, "arranca en 60 min");
    await admin.query("update public.lesson_registrations set actual_ended_at = actual_started_at + interval '90 minutes' where id=$1", [regId]);
    await syncReal(a, regId, [hourly]);
    const row = await charge(hourly, regId);
    eq(num(row.original_amount), 54000, "se corrige a 90 min");
    eq(row.billed_minutes, 90, "con los minutos nuevos");
    ok((await admin.query("select count(*) from public.payment_charges where saved_lesson_id=$1", [regId])).rows[0].count === "1", "sin duplicar");
    await admin.query("update public.lesson_registrations set actual_ended_at = actual_started_at + interval '45 minutes' where id=$1", [regId]);
    await syncReal(a, regId, [hourly]);
    eq(num((await charge(hourly, regId)).original_amount), 27000, "y se puede acortar");
  }

  // ---------- 8) Tarifa congelada y cambio de tarifa por FECHA ----------
  {
    const regOld = await registration(A, hourly, { date: "2026-11-26", scheduled: 60 });
    await syncReal(a, regOld, [hourly]); // 36.000/h generado
    // La profesora sube la tarifa a 50.000/h: queda auditado HOY (después de las clases ya dadas).
    await setPlan(a, hourly, { type: "per_class", amount: 50000, rateBasis: "hour" });
    // (a) El cargo ya generado conserva SU tarifa aunque se edite su duración.
    await admin.query("update public.lesson_registrations set scheduled_end_at = scheduled_start_at + interval '90 minutes' where id=$1", [regOld]);
    await admin.query("update public.calendar_lessons set end_at = start_at + interval '90 minutes' where id=(select calendar_lesson_id from public.lesson_registrations where id=$1)", [regOld]);
    await syncReal(a, regOld, [hourly]);
    eq(num((await charge(hourly, regOld)).original_amount), 54000, "editar la duración de un cargo viejo usa SU tarifa congelada (36.000), no la nueva (50.000)");
    eq(num((await charge(hourly, regOld)).rate_per_hour), 36000, "la tarifa congelada no cambia");
    // (b) Una clase ANTERIOR al cambio que se registra DESPUÉS del cambio usa la tarifa de su fecha.
    const regBefore = await registration(A, hourly, { date: "2026-11-05", scheduled: 60 });
    await admin.query("update public.student_billing_audit set created_at = '2026-11-15T12:00:00Z' where student_id=$1 and (after_state->>'amount')::numeric = 50000", [hourly]);
    await syncReal(a, regBefore, [hourly]);
    eq(num((await charge(hourly, regBefore)).original_amount), 36000, "clase del 05/11 (antes del cambio del 15/11) registrada después ⇒ 36.000/h");
    eq(num((await charge(hourly, regBefore)).rate_per_hour), 36000, "con la tarifa de su fecha");
    // (c) Una clase POSTERIOR al cambio usa la nueva.
    const regAfter = await registration(A, hourly, { date: "2026-11-18", scheduled: 60 });
    await syncReal(a, regAfter, [hourly]);
    eq(num((await charge(hourly, regAfter)).original_amount), 50000, "clase del 18/11 (después del cambio) ⇒ 50.000/h");
    // (d) Una clase del MISMO día del cambio usa la nueva tarifa (un cambio hecho durante el día vale para todo el día).
    const regSameDay = await registration(A, hourly, { date: "2026-11-15", hour: 8, scheduled: 60 });
    await syncReal(a, regSameDay, [hourly]);
    eq(num((await charge(hourly, regSameDay)).original_amount), 50000, "misma fecha del cambio ⇒ tarifa nueva");
    await setPlan(a, hourly, { type: "per_class", amount: 36000, rateBasis: "hour" });
    await admin.query("update public.student_billing_audit set created_at = '2026-11-16T12:00:00Z' where student_id=$1 and (after_state->>'amount')::numeric = 36000 and created_at > '2026-11-20'", [hourly]);
  }

  // ---------- 9) Importe FIJO (alumno antiguo): intacto, no depende de la duración ----------
  const fixed = await student(A, "Fijo Dos", { plan: null, price: 36000 });
  {
    const amounts = [];
    for (const minutes of [45, 90, 135]) {
      const regId = await registration(A, fixed, { date: `2026-11-${10 + minutes / 45}`, scheduled: minutes });
      await syncReal(a, regId, [fixed]);
      const row = await charge(fixed, regId);
      amounts.push(num(row.original_amount));
      eq(row.rate_per_hour, null, "el importe fijo no congela tarifa horaria");
      eq(row.billed_minutes, null, "ni minutos");
    }
    eq(JSON.stringify(amounts), JSON.stringify([36000, 36000, 36000]), "45, 90 y 135 min con importe fijo ⇒ siempre $36.000, como siempre");
  }

  // ---------- 10) El servidor de aplicación NO es la autoridad: una cifra alterada se corrige ----------
  {
    const regId = await registration(A, hourly, { date: "2026-11-27", scheduled: 90 });
    await sync(a, regId, [{ studentId: hourly, amount: 1 }]);
    eq(num((await charge(hourly, regId)).original_amount), 54000, "tarifa por hora: la base recalcula y descarta un importe enviado a mano");
    const regFixed = await registration(A, fixed, { date: "2026-11-27", scheduled: 90 });
    await sync(a, regFixed, [{ studentId: fixed, amount: 36000 }]);
    eq(num((await charge(fixed, regFixed)).original_amount), 36000, "importe fijo sin cambios de tarifa: igual que siempre");
  }

  // ---------- 11) Grupal con tarifas distintas por alumno, y resultado de la clase ----------
  {
    const g1 = await student(A, "Grupo Uno", { plan: { type: "per_class", amount: 36000, rateBasis: "hour" } });
    const g2 = await student(A, "Grupo Dos", { plan: { type: "per_class", amount: 20000, rateBasis: "hour" } });
    const g3 = await student(A, "Grupo Tres", { plan: { type: "per_class", amount: 25000 } });
    const g4 = await student(A, "Grupo Cuatro", { billingType: "mensual", plan: { type: "monthly", amount: 90000, dueDay: 10 } });
    const regId = await registration(A, g1, { date: "2026-11-12", scheduled: 90 });
    await syncReal(a, regId, [g1, g2, g3, g4]);
    eq(num((await charge(g1, regId)).original_amount), 54000, "alumno 1: 36.000/h × 90 min");
    eq(num((await charge(g2, regId)).original_amount), 30000, "alumno 2: 20.000/h × 90 min");
    eq(num((await charge(g3, regId)).original_amount), 25000, "alumno 3 (importe fijo): 25.000");
    eq(await charge(g4, regId), undefined, "alumno mensual: ningún cargo por clase");
    // Cancelada tarde: 50 % del valor de ESA clase (90 min).
    const regLate = await registration(A, g1, { date: "2026-11-13", scheduled: 90, outcome: "cancelada_tarde", counts: false, policy: "cobrar_porcentaje", pct: 50 });
    await syncReal(a, regLate, [g1]);
    eq(num((await charge(g1, regLate)).original_amount), 27000, "cancelada tarde con 50 % ⇒ 27.000");
    const regAbsent = await registration(A, g1, { date: "2026-11-14", scheduled: 90, outcome: "alumno_ausente", counts: false });
    await syncReal(a, regAbsent, [g1]);
    eq(await charge(g1, regAbsent), undefined, "clase no dictada ni cobrable ⇒ sin cargo");
  }

  // ---------- 12) Entrenamiento cubierto por cuota: nunca genera cargo por clase ni lo prorratea ----------
  {
    const t = await student(A, "Cuota Tres", { plan: { type: "per_class", amount: 36000, rateBasis: "hour" } });
    const regId = await registration(A, t, { date: "2026-11-16", scheduled: 90 });
    await sync(a, regId, [{ studentId: t, amount: null }]); // lo que envía la acción cuando la sesión está cubierta por la cuota
    eq(await charge(t, regId), undefined, "sesión cubierta por la cuota: sin cargo adicional");
    await syncReal(a, regId, [t]);
    ok(await charge(t, regId), "como clase suelta sí cobra");
    await sync(a, regId, [{ studentId: t, amount: null }]);
    ok((await charge(t, regId)).voided_at !== null, "al pasar a «cubierta» se retira el cargo SIN pagos (sin borrarlo)");
  }

  // ---------- 13) Cargos con pagos y cargos anteriores a la tarifa horaria NO se tocan ----------
  {
    const regPaid = await registration(A, hourly, { date: "2026-11-17", scheduled: 60, actual: 60 });
    await syncReal(a, regPaid, [hourly]);
    const row = await charge(hourly, regPaid);
    await pay(A, hourly, row.id, 10000); // pago PARCIAL
    await admin.query("update public.lesson_registrations set actual_ended_at = actual_started_at + interval '120 minutes' where id=$1", [regPaid]);
    await syncReal(a, regPaid, [hourly]);
    const after = await charge(hourly, regPaid);
    eq(num(after.original_amount), 36000, "pago parcial: el cargo NO se recalcula");
    eq(after.billed_minutes, 60, "ni sus minutos");
    // Cargo legado (sin tarifa congelada) de un alumno que hoy paga por hora: no se reescribe solo.
    const regLegacy = await registration(A, hourly, { date: "2026-11-19", scheduled: 90 });
    await admin.query("insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id) values ($1,$2,'por_clase',40000,'2026-11-19',$3)", [A, hourly, regLegacy]);
    await syncReal(a, regLegacy, [hourly]);
    eq(num((await charge(hourly, regLegacy)).original_amount), 40000, "importe personalizado/anterior: el reintento no lo pisa");
  }

  // ---------- 14) Corrección segura de cargos pendientes (revisión, aplicación y reversión) ----------
  {
    const owner = B;
    const sB = await student(owner, "Revisión Uno", { plan: { type: "per_class", amount: 36000, rateBasis: "hour" } });
    const mk = async (date, minutes, amount, { partial = 0, voided = false } = {}) => {
      const regId = await registration(owner, sB, { date, scheduled: minutes });
      const id = ID("d", ++seq);
      await admin.query("insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id, voided_at) values ($1,$2,$3,'por_clase',$4,$5,$6,$7)", [id, owner, sB, amount, date, regId, voided ? new Date().toISOString() : null]);
      if (partial > 0) await pay(owner, sB, id, partial);
      return id;
    };
    const auto90 = await mk("2026-11-02", 90, 36000); // automático, sin pagos: la regla anterior daba 36.000
    const auto45 = await mk("2026-11-03", 45, 36000); // automático (45 min ⇒ debía ser 27.000)
    const alreadyOk = await mk("2026-11-04", 60, 36000); // 60 min ⇒ 36.000: ya es correcto
    const withPay = await mk("2026-11-05", 120, 36000, { partial: 5000 }); // pago parcial
    const custom = await mk("2026-11-06", 90, 41000); // importe personalizado
    const voidedOne = await mk("2026-11-07", 90, 36000, { voided: true });
    const snapshot = async () => JSON.stringify((await admin.query("select id, original_amount, rate_per_hour, billed_minutes, voided_at is not null as v from public.payment_charges where student_id=$1 order by id", [sB])).rows);
    const before = await snapshot();
    const bSession = b;
    const review = (await bSession.query("select * from public.hourly_charge_review()")).rows;
    eq(await snapshot(), before, "la revisión es de SÓLO LECTURA");
    const byId = new Map(review.map((r) => [r.charge_id, r]));
    eq(byId.get(auto90).category, "automatico_sin_pagos", "90 min a 36.000 sin pagos: corregible");
    eq(num(byId.get(auto90).expected_amount), 54000, "debería valer 54.000");
    eq(byId.get(auto45).category, "automatico_sin_pagos", "45 min: corregible");
    eq(num(byId.get(auto45).expected_amount), 27000, "debería valer 27.000 (baja)");
    eq(byId.get(withPay).category, "con_pagos", "con pago parcial: revisión humana");
    eq(num(byId.get(withPay).paid_amount), 5000, "informa lo pagado");
    eq(byId.get(custom).category, "personalizado", "importe distinto de la regla automática: revisión humana");
    ok(!byId.has(alreadyOk), "el que ya es correcto no figura");
    ok(!byId.has(voidedOne), "el anulado no figura");
    eq(review.length, 4, "alcance: 4 cargos con diferencia (2 corregibles, 1 con pagos, 1 personalizado)");

    // Otra cuenta no puede ver ni reparar los cargos de esta.
    eq((await a.query("select * from public.hourly_charge_review()")).rows.filter((r) => byId.has(r.charge_id)).length, 0, "otra cuenta no ve estos cargos");
    eq(num((await a.query("select public.apply_hourly_charge_repairs($1::uuid[]) as n", [[auto90]])).rows[0].n), 0, "otra cuenta no puede repararlos");
    eq(await snapshot(), before, "y no cambió nada");
    // Intentar reparar los que NO son automáticos: se ignoran.
    eq(num((await bSession.query("select public.apply_hourly_charge_repairs($1::uuid[]) as n", [[withPay, custom, alreadyOk, voidedOne]])).rows[0].n), 0, "pedir corregir con pagos/personalizado/correcto/anulado no hace nada");
    eq(await snapshot(), before, "sin ningún cambio");
    // Aplicar a los corregibles.
    eq(num((await bSession.query("select public.apply_hourly_charge_repairs($1::uuid[]) as n", [[auto90, auto45, withPay, custom]])).rows[0].n), 2, "se corrigen sólo los 2 automáticos sin pagos");
    const fixedRows = (await admin.query("select id, original_amount, rate_per_hour, billed_minutes from public.payment_charges where id = any($1::uuid[])", [[auto90, auto45]])).rows;
    eq(num(fixedRows.find((r) => r.id === auto90).original_amount), 54000, "90 min ⇒ 54.000");
    eq(num(fixedRows.find((r) => r.id === auto45).original_amount), 27000, "45 min ⇒ 27.000");
    eq(num(fixedRows[0].rate_per_hour), 36000, "con tarifa y minutos congelados");
    eq(num((await admin.query("select original_amount from public.payment_charges where id=$1", [withPay])).rows[0].original_amount), 36000, "con pagos: intacto");
    eq(num((await admin.query("select original_amount from public.payment_charges where id=$1", [custom])).rows[0].original_amount), 41000, "personalizado: intacto");
    eq(num((await admin.query("select count(*) from public.financial_repair_audit where reason='hourly_rate_repair' and owner_id=$1", [owner])).rows[0].count), 2, "queda el estado anterior de cada corrección");
    eq(num((await bSession.query("select public.apply_hourly_charge_repairs($1::uuid[]) as n", [[auto90, auto45]])).rows[0].n), 0, "idempotente: repetir no cambia nada");
    // Después de corregido, editar la duración de ESA clase usa la tarifa congelada.
    // Reversión.
    eq(num((await bSession.query("select public.rollback_hourly_charge_repairs($1::uuid[]) as n", [[auto90, auto45, withPay]])).rows[0].n), 2, "se revierten las 2 correcciones");
    eq(await snapshot(), before, "después de revertir, todo vuelve EXACTAMENTE a como estaba");
    // Carrera: un pago se asigna al cargo MIENTRAS se aplica la corrección (la asignación aún no está confirmada cuando se revisa). La corrección espera el bloqueo del cargo, vuelve a verificar y NO lo toca.
    {
      const racy = await mk("2026-11-08", 90, 36000);
      const other = await pg.connect();
      sessions.push(other);
      await other.query("begin");
      const racePayment = ID("9", ++seq);
      await other.query("insert into public.payments (id, owner_id, student_id, amount, method, paid_at) values ($1,$2,$3,36000,'efectivo',current_date)", [racePayment, owner, sB]);
      await other.query("insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1,$2,$3,$4,36000)", [owner, racePayment, racy, sB]);
      const applying = bSession.query("select public.apply_hourly_charge_repairs($1::uuid[]) as n", [[racy]]);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await other.query("commit");
      eq(num((await applying).rows[0].n), 0, "carrera: el pago confirmado a mitad de la corrección impide tocar el cargo");
      eq(num((await admin.query("select original_amount from public.payment_charges where id=$1", [racy])).rows[0].original_amount), 36000, "el cargo saldado conserva su importe");
    }
    // Con un pago posterior ya no se revierte.
    await bSession.query("select public.apply_hourly_charge_repairs($1::uuid[])", [[auto90]]);
    await pay(owner, sB, auto90, 1000);
    eq(num((await bSession.query("select public.rollback_hourly_charge_repairs($1::uuid[]) as n", [[auto90]])).rows[0].n), 0, "si ya tiene un pago, no se revierte");
  }

  // ---------- 15) Privilegios ----------
  {
    const anon = await pg.session("", "anon");
    sessions.push(anon);
    for (const fn of ["public.sync_per_class_charge(uuid, jsonb)", "public.hourly_charge_review()", "public.apply_hourly_charge_repairs(uuid[])", "public.rollback_hourly_charge_repairs(uuid[])", "public.lesson_billable_minutes(uuid)", "public.student_per_class_plan_on(uuid, date)"]) {
      eq((await admin.query("select has_function_privilege('anon', $1, 'execute') as p", [fn])).rows[0].p, false, `${fn}: sin acceso anónimo`);
      eq((await admin.query("select has_function_privilege('authenticated', $1, 'execute') as p", [fn])).rows[0].p, true, `${fn}: la usuaria autenticada sí`);
    }
  }

  console.log(`${checks} comprobaciones de tarifa por hora correctas`);
} finally {
  await Promise.all(sessions.map((client) => client.end().catch(() => {})));
  await pg.stop();
}
process.exit(0);
