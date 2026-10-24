// «Esta y todas las series» (`end_recurrence_series_from_date`): UNA transacción. Postgres REAL aislado (binarios de embedded-postgres, fuera del repo), datos SINTÉTICOS, nunca Production.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/end_series_atomic.cjs
//
// Cubre: éxito, fallo intermedio (serie inexistente DESPUÉS de cortar y cerrar; y un fallo REAL en la cancelación de las clases, con los cortes ya hechos), serie ajena, plan inválido, repetición
// (también simultánea) y que la historia (registros, cobros, pagos, adjuntos, clases dictadas, otras series y otras dueñas) no se toca.
const { start } = require("./load.cjs");

const A = "f7000000-0000-0000-0000-000000000001";
const B = "f7000000-0000-0000-0000-000000000002";
const STU_A = "f7100000-0000-0000-0000-000000000001";
const STU_B = "f7100000-0000-0000-0000-000000000002";
const R_OLD = "f7200000-0000-0000-0000-0000000000a1";
const R_HEAD = "f7200000-0000-0000-0000-0000000000a2";
const R_OTHER = "f7200000-0000-0000-0000-0000000000c1";
const R_FOREIGN = "f7200000-0000-0000-0000-0000000000b1";
const GHOST = "f7200000-0000-0000-0000-0000000000ff";
const L = (n) => `f7300000-0000-0000-0000-00000000000${n}`;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

const plan = (extra = {}) => ({
  truncate: [{ id: R_OLD, end_date: "2026-10-23" }],
  end: [R_HEAD],
  effective_date: "2026-10-24",
  timezone: "America/Argentina/Buenos_Aires",
  ...extra,
});

async function seed(admin) {
  await admin.query("truncate public.recurrence_rules, public.students cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await admin.query(
    `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
     ($1, $3, 'F7 A', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000), ($2, $4, 'F7 B', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000)`,
    [STU_A, STU_B, A, B]
  );
  const week = (hour) => JSON.stringify([{ weekIndex: 0, sessions: [{ weekday: 4, hour, minute: 0, durationMinutes: 60 }] }]);
  const rule = (id, owner, student, start, end, status, supersedes, hour) =>
    admin.query(
      `insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, end_date, status, supersedes_recurrence_id, effective_from_date, activity_kind)
       values ($1, $2, $3, 'weekly', 1, $4::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', $5, $6, $7, $8, $9, 'class')`,
      [id, owner, student, week(hour), start, end, status, supersedes, supersedes ? start : null]
    );
  await rule(R_OLD, A, STU_A, "2026-09-01", "2026-10-30", "active", null, 19);
  await rule(R_HEAD, A, STU_A, "2026-10-31", null, "active", R_OLD, 20);
  await rule(R_OTHER, A, STU_A, "2026-09-01", null, "active", null, 10);
  await rule(R_FOREIGN, B, STU_B, "2026-09-01", null, "active", null, 19);
  const lesson = (n, owner, student, start, status, recurrence, key) =>
    admin.query(
      `insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start, activity_kind)
       values ($1, $2, $3, 'F7', 'B1', 'individual', $4::timestamptz, $4::timestamptz + interval '1 hour', 'presencial', $5, '#FCE4D2', true, $6, $7, $8, $4::timestamptz, 'class')`,
      [L(n), owner, student, start, status, recurrence, key, n]
    );
  await lesson(1, A, STU_A, "2026-11-06T23:00:00Z", "scheduled", R_HEAD, "k1"); // futura, programada, sin registro → se cancela
  await lesson(2, A, STU_A, "2026-11-13T23:00:00Z", "scheduled", R_HEAD, "k2"); // futura, programada, CON registro → no se toca
  await lesson(3, A, STU_A, "2026-11-20T23:00:00Z", "completed", R_HEAD, "k3"); // dictada → no se toca
  await lesson(4, A, STU_A, "2026-10-09T22:00:00Z", "scheduled", R_OLD, "k0"); // pasada → no se toca
  await lesson(5, A, STU_A, "2026-11-03T13:00:00Z", "scheduled", R_OTHER, "k5"); // otra serie de la misma dueña → no se toca
  await lesson(6, B, STU_B, "2026-11-06T22:00:00Z", "scheduled", R_FOREIGN, "k6"); // otra dueña → no se toca
  await admin.query(`insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level) select owner_id, id, primary_student_id, student_name, level from public.calendar_lessons`);
  await admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status) values ('f7400000-0000-0000-0000-000000000002', $1, $2, 'class', true, '2026-11-13T23:00:00Z', 'in_progress')`, [A, L(2)]);
  await admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id) values ('f7500000-0000-0000-0000-000000000002', $1, $2, 'por_clase', 10000, '2026-11-13', 'f7400000-0000-0000-0000-000000000002')`, [A, STU_A]);
}

async function snapshot(admin) {
  const rules = (await admin.query("select id, status, end_date::text from public.recurrence_rules order by id")).rows;
  const lessons = (await admin.query("select id, status from public.calendar_lessons order by id")).rows;
  const history = (
    await admin.query(
      "select (select count(*) from public.lesson_registrations)::int r, (select count(*) from public.payment_charges)::int c, (select count(*) from public.calendar_lessons)::int l, (select count(*) from public.calendar_lesson_participants)::int p"
    )
  ).rows[0];
  return JSON.stringify({ rules, lessons, history });
}

async function call(session, payload) {
  try {
    const { rows } = await session.query("select public.end_recurrence_series_from_date($1::jsonb) as r", [JSON.stringify(payload)]);
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}

async function main() {
  const pg = await start({ port: 5763 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    check("la migración existe y se aplicó", (await admin.query("select to_regprocedure('public.end_recurrence_series_from_date(jsonb)') as f")).rows[0].f !== null);

    // 1) Fallo intermedio: serie inexistente DESPUÉS de cortar y cerrar → no cambia NADA.
    await seed(admin);
    const before = await snapshot(admin);
    const s = await pg.session(A);
    const ghost = await call(s, plan({ end: [R_HEAD, GHOST] }));
    check("serie inexistente en el plan: se rechaza (P0002)", !ghost.ok && ghost.code === "P0002", JSON.stringify(ghost));
    check("…y NO queda ningún cambio parcial (cortes, cierres ni cancelaciones)", (await snapshot(admin)) === before);

    // 2) Fallo intermedio REAL en el último paso: un disparador (sólo de esta prueba) rompe la cancelación de clases con los cortes y cierres ya hechos.
    await admin.query(`create function public.zz_fail_cancel() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado al cancelar' using errcode = 'XX000'; end $$`);
    await admin.query("create trigger zz_fail_cancel before update on public.calendar_lessons for each row execute function public.zz_fail_cancel()");
    const broken = await call(s, plan());
    check("fallo REAL al cancelar las clases: la operación falla", !broken.ok && broken.code === "XX000", JSON.stringify(broken));
    check("…y los cortes y cierres ya hechos dentro de la transacción se REVIERTEN (sin cambios parciales)", (await snapshot(admin)) === before);
    await admin.query("drop trigger zz_fail_cancel on public.calendar_lessons");
    await admin.query("drop function public.zz_fail_cancel()");

    // 3) Serie de otra dueña y planes inválidos.
    const foreign = await call(s, plan({ end: [R_HEAD, R_FOREIGN] }));
    check("serie de OTRA dueña en el plan: se rechaza y no cambia nada", !foreign.ok && foreign.code === "P0002" && (await snapshot(admin)) === before, JSON.stringify(foreign));
    const empty = await call(s, { truncate: [], end: [], effective_date: "2026-10-24" });
    check("plan vacío: se rechaza (22023)", !empty.ok && empty.code === "22023");
    const late = await call(s, plan({ truncate: [{ id: R_OLD, end_date: "2026-10-24" }] }));
    check("corte que no termina antes de la fecha efectiva: se rechaza (22023)", !late.ok && late.code === "22023" && (await snapshot(admin)) === before);

    // 4) Éxito.
    const done = await call(s, plan());
    check("éxito: 1 corte, 1 cierre, 1 clase cancelada", done.ok && done.value.truncated === 1 && done.value.ended === 1 && done.value.cancelled === 1, JSON.stringify(done));
    const rules = Object.fromEntries((await admin.query("select id, status, end_date::text e from public.recurrence_rules")).rows.map((r) => [r.id, r]));
    check("el tramo viejo termina el día anterior (lo anterior se conserva)", rules[R_OLD].e === "2026-10-23" && rules[R_OLD].status === "active");
    check("la serie vigente queda cerrada", rules[R_HEAD].status === "ended");
    check("la otra serie de la misma alumna y la de la otra dueña no cambian", rules[R_OTHER].status === "active" && rules[R_OTHER].e === null && rules[R_FOREIGN].status === "active");
    const lessons = Object.fromEntries((await admin.query("select id, status from public.calendar_lessons")).rows.map((r) => [r.id, r.status]));
    check("la clase futura programada sin registro queda cancelada (no borrada)", lessons[L(1)] === "cancelled");
    check("la clase con registro, la dictada, la pasada y las de otras series NO se tocan", lessons[L(2)] === "scheduled" && lessons[L(3)] === "completed" && lessons[L(4)] === "scheduled" && lessons[L(5)] === "scheduled" && lessons[L(6)] === "scheduled");
    const history = (await snapshot(admin)) && JSON.parse(await snapshot(admin)).history;
    check("registros, cobros, clases y participantes: ninguno se borró", history.r === 1 && history.c === 1 && history.l === 6 && history.p === 6, JSON.stringify(history));

    // 5) Repetición (secuencial y simultánea): sin cambios, sin errores, sin duplicaciones.
    const afterFirst = await snapshot(admin);
    const again = await call(s, plan());
    check("repetir la operación no cambia nada ni falla", again.ok && again.value.truncated === 0 && again.value.ended === 0 && again.value.cancelled === 0 && (await snapshot(admin)) === afterFirst, JSON.stringify(again));
    await seed(admin);
    const s1 = await pg.session(A);
    const s2 = await pg.session(A);
    const [r1, r2] = await Promise.all([call(s1, plan()), call(s2, plan())]);
    const totalCancelled = (r1.ok ? r1.value.cancelled : 0) + (r2.ok ? r2.value.cancelled : 0);
    const finalState = Object.fromEntries((await admin.query("select id, status from public.calendar_lessons")).rows.map((r) => [r.id, r.status]));
    check("dos llamadas SIMULTÁNEAS convergen: ambas terminan bien y la clase se cancela una sola vez", r1.ok && r2.ok && totalCancelled === 1 && finalState[L(1)] === "cancelled", JSON.stringify([r1, r2]));

    // 6) Privilegios.
    const anon = await pg.session(null, "anon");
    const denied = await call(anon, plan());
    check("sin sesión (anon) no puede ejecutarla", !denied.ok && denied.code === "42501", JSON.stringify(denied));
    await anon.end();
    await s.end();
    await s1.end();
    await s2.end();
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones`);
  if (failures.length) {
    console.log("FALLAN:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
