// Ensayo de la migración 20261124100000 (tarifa por hora) sobre Postgres REAL: estado de Production (todas las migraciones anteriores) → migración → idempotencia → rollback → mismo estado.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/hourly_rate_rehearsal.cjs
//
// Huella = md5 de la definición de cada función afectada (sin retornos de carro: los finales de línea del archivo no son parte del comportamiento) y presencia de las columnas nuevas. Además: la migración no modifica ni una fila existente (cargos, planes, pagos), un cargo anterior
// conserva exactamente su estado, y el rollback se NIEGA si algún cargo ya usa la tarifa horaria (no se pierde historia).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { start } = require("./load.cjs");

const MIGRATION = "20261124100000_hourly_rate_billing.sql";
const ROLLBACK = path.join(__dirname, "../../repairs/20261124100000_hourly_rate_billing_rollback.sql");
const OWNER = "e1000000-0000-4000-8000-000000000001";

(async () => {
  const pg = await start({ port: 5760 + Math.floor(Math.random() * 150), upTo: "20261118200000_extend_duration_and_series_end.sql" });
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };
  try {
    assert.deepEqual(pg.failures, [], "las migraciones anteriores cargan");
    const fingerprint = async () => {
      const funcs = (await pg.admin.query("select p.proname, md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('sync_per_class_charge','set_student_billing_plan','lesson_hourly_amount','lesson_billed_amount','lesson_billable_minutes','student_per_class_plan_on','hourly_charge_review','apply_hourly_charge_repairs','rollback_hourly_charge_repairs') order by 1")).rows;
      const cols = (await pg.admin.query("select column_name from information_schema.columns where table_schema='public' and table_name='payment_charges' and column_name in ('rate_per_hour','billed_minutes') order by 1")).rows.map((r) => r.column_name);
      const cons = (await pg.admin.query("select conname from pg_constraint where conrelid='public.payment_charges'::regclass and conname='payment_charges_hourly_fields'")).rows.length;
      return JSON.stringify({ funcs, cols, cons });
    };
    const rowsFingerprint = async () => JSON.stringify({
      charges: (await pg.admin.query("select id, original_amount, voided_at from public.payment_charges order by id")).rows,
      students: (await pg.admin.query("select id, billing_plan, price from public.students order by id")).rows,
      payments: (await pg.admin.query("select id, amount from public.payments order by id")).rows,
    });

    // Datos previos a la migración (un alumno por clase, un cargo con pago parcial).
    await pg.admin.query("insert into auth.users(id,email) values ($1,'r@example.test')", [OWNER]);
    await pg.admin.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values ('e5000000-0000-4000-8000-000000000001',$1,'Ensayo','presencial','otro','por_clase','2026-01-05',36000)", [OWNER]);
    await pg.admin.query("insert into public.lesson_registrations (id, owner_id, status, scheduled_start_at, scheduled_end_at) values ('e7000000-0000-4000-8000-000000000001',$1,'completed','2026-11-10T15:00:00Z','2026-11-10T16:30:00Z')", [OWNER]);
    await pg.admin.query("insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id) values ('ed000000-0000-4000-8000-000000000001',$1,'e5000000-0000-4000-8000-000000000001','por_clase',36000,'2026-11-10','e7000000-0000-4000-8000-000000000001')", [OWNER]);
    await pg.admin.query("insert into public.payments (id, owner_id, student_id, amount, method, paid_at) values ('e9000000-0000-4000-8000-000000000001',$1,'e5000000-0000-4000-8000-000000000001',10000,'efectivo',current_date)", [OWNER]);
    await pg.admin.query("insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount) values ($1,'e9000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',10000)", [OWNER]);

    const beforeFp = await fingerprint();
    const beforeRows = await rowsFingerprint();
    ok(!JSON.parse(beforeFp).cols.length, "antes: sin columnas de tarifa horaria");

    const sql = fs.readFileSync(path.join(__dirname, "../../migrations", MIGRATION), "utf8");
    await pg.admin.query(sql);
    const afterFp = await fingerprint();
    ok(afterFp !== beforeFp, "la migración cambia la huella");
    ok(JSON.parse(afterFp).cols.length === 2 && JSON.parse(afterFp).cons === 1, "agrega las dos columnas y su restricción");
    ok((await rowsFingerprint()) === beforeRows, "no modifica ni una fila existente (cargo, plan, pago)");
    ok((await pg.admin.query("select count(*) from public.payment_charges where rate_per_hour is not null or billed_minutes is not null")).rows[0].count === "0", "ningún cargo existente queda con tarifa horaria");

    await pg.admin.query(sql); // idempotencia: correrla de nuevo no falla ni cambia nada
    ok((await fingerprint()) === afterFp, "idempotente: la huella no cambia al repetirla");
    ok((await rowsFingerprint()) === beforeRows, "y las filas tampoco");

    // El rollback se NIEGA si algún cargo ya usa la tarifa horaria.
    await pg.admin.query("update public.payment_charges set rate_per_hour = 36000, billed_minutes = 90 where id = 'ed000000-0000-4000-8000-000000000001'");
    await assert.rejects(pg.admin.query(fs.readFileSync(ROLLBACK, "utf8")), /no se revierte sin decidir/); checks += 1;
    await pg.admin.query("rollback"); // el script abrió su transacción: al fallar, la base la revierte entera
    ok((await fingerprint()) === afterFp, "rollback denegado: nada cambió");
    await pg.admin.query("update public.payment_charges set rate_per_hour = null, billed_minutes = null where id = 'ed000000-0000-4000-8000-000000000001'");

    await pg.admin.query(fs.readFileSync(ROLLBACK, "utf8"));
    ok((await fingerprint()) === beforeFp, "rollback: la huella vuelve EXACTAMENTE al estado anterior");
    ok((await rowsFingerprint()) === beforeRows, "y los datos siguen intactos");
    await pg.admin.query(sql); // y se puede volver a aplicar
    ok((await fingerprint()) === afterFp, "re-aplicable después del rollback");

    console.log(`${checks} comprobaciones del ensayo de la migración correctas`);
  } finally {
    await pg.stop();
  }
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
