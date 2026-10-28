// Acciones de clase del Calendario (migración 20261027100000): nombre, duración, restaurar y eliminar una clase cancelada. Postgres REAL aislado (binarios de embedded-postgres, fuera del repo),
// datos SINTÉTICOS, nunca la cuenta real.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/calendar_lesson_actions.cjs
//
// Cubre: nombre/duración de una clase suelta y de una ocurrencia virtual (se materializa una sola vez, también con dos conexiones a la vez), validaciones (60 caracteres, fin posterior al
// inicio, clase dictada/cancelada), nombre de toda la serie (sólo clases futuras programadas),
// restaurar (vuelve a la fecha original, quita la excepción, nunca con registro o cobro), eliminar una cancelada (excluye la fecha de la serie, nunca con registro o cobro, idempotente),
// aislamiento entre dueñas y que registros, cobros y participantes ajenos no se tocan.
const { start } = require("./load.cjs");

const A = "f8000000-0000-0000-0000-000000000001";
const B = "f8000000-0000-0000-0000-000000000002";
const STU_A = "f8100000-0000-0000-0000-000000000001";
const STU_A2 = "f8100000-0000-0000-0000-000000000003";
const STU_B = "f8100000-0000-0000-0000-000000000002";
const R1 = "f8200000-0000-0000-0000-0000000000a1";
const R_OTHER = "f8200000-0000-0000-0000-0000000000a2";
const R_FOREIGN = "f8200000-0000-0000-0000-0000000000b1";
const L = (n) => `f8300000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const TZ = "America/Argentina/Buenos_Aires";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function call(session, fn, payload) {
  try {
    const { rows } = await session.query(`select to_jsonb(public.${fn}($1::jsonb)) as r`, [JSON.stringify(payload)]);
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}

async function seed(admin) {
  await admin.query("truncate public.recurrence_rules, public.students cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await admin.query(
    `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
     ($1, $4, 'F8 A', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000),
     ($2, $4, 'F8 A2', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000),
     ($3, $5, 'F8 B', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000)`,
    [STU_A, STU_A2, STU_B, A, B]
  );
  const week = JSON.stringify([{ weekIndex: 0, sessions: [{ weekday: 4, hour: 20, minute: 0, durationMinutes: 60 }] }]);
  const rule = (id, owner, student) =>
    admin.query(
      `insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status, class_title, activity_kind)
       values ($1, $2, $3, 'weekly', 1, $4::jsonb, 'presencial', $5, '2026-09-04', 'active', 'Original', 'class')`,
      [id, owner, student, week, TZ]
    );
  await rule(R1, A, STU_A);
  await rule(R_OTHER, A, STU_A2);
  await rule(R_FOREIGN, B, STU_B);
  // Viernes 20:00 hora de Buenos Aires = sábado 23:00Z. Las fechas son futuras respecto de «now()» de la base (2026+ no importa: se fijan por estado y por start_at).
  const lesson = (n, owner, student, startAt, status, recurrence, key, title) =>
    admin.query(
      `insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start, class_title, activity_kind)
       values ($1, $2, $3, 'F8', 'B1', 'individual', $4::timestamptz, $4::timestamptz + interval '1 hour', 'presencial', $5, '#FCE4D2', $6::boolean, $7, $8, $9, $4::timestamptz, $10, 'class')`,
      [L(n), owner, student, startAt, status, recurrence !== null, recurrence, key, n, title]
    );
  const FUT = (days) => new Date(Date.now() + days * 86400000).toISOString();
  await lesson(1, A, STU_A, FUT(10), "scheduled", R1, "k1", "Original"); // futura programada de la serie
  await lesson(2, A, STU_A, FUT(17), "scheduled", R1, "k2", "Original"); // futura programada de la serie
  await lesson(3, A, STU_A, FUT(-7), "scheduled", R1, "k0", "Original"); // pasada: no cambia con «toda la serie»
  await lesson(4, A, STU_A, FUT(24), "completed", R1, "k4", "Original"); // dictada
  await lesson(5, A, STU_A2, FUT(10), "scheduled", R_OTHER, "k5", "Otra"); // otra serie de la misma dueña
  await lesson(6, B, STU_B, FUT(10), "scheduled", R_FOREIGN, "k6", "Ajena"); // otra dueña
  await lesson(7, A, STU_A, FUT(31), "cancelled", R1, "k7", "Original"); // cancelada sin historial
  await lesson(8, A, STU_A, FUT(38), "cancelled", R1, "k8", "Original"); // cancelada CON registro
  await lesson(9, A, STU_A, FUT(45), "cancelled", R1, "k9", "Original"); // cancelada CON cobro
  await lesson(10, A, STU_A, FUT(52), "rescheduled", R1, "k10", "Original"); // reprogramada (se movió desde otra fecha)
  await admin.query(`update public.calendar_lessons set recurrence_original_start = start_at - interval '2 days' where id = $1`, [L(10)]);
  await lesson(11, A, STU_A, FUT(59), "scheduled", null, null, "Suelta"); // clase suelta
  await admin.query(
    `insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level) select owner_id, id, primary_student_id, student_name, level from public.calendar_lessons`
  );
  await admin.query(
    `insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type) values ($1, $2, 'k7', 'cancelled'), ($1, $2, 'k8', 'cancelled'), ($1, $2, 'k9', 'cancelled'), ($1, $2, 'k10', 'rescheduled')`,
    [A, R1]
  );
  await admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status) values ('f8400000-0000-0000-0000-000000000001', $1, $2, 'class', false, now(), 'completed')`, [A, L(8)]);
  await admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, calendar_lesson_id, saved_lesson_id) values ('f8500000-0000-0000-0000-000000000001', $1, $2, 'por_clase', 10000, '2026-12-01', $3, 'f8400000-0000-0000-0000-000000000001')`, [A, STU_A, L(9)]);
}

async function lessonRow(admin, n) {
  return (await admin.query("select id, status, class_title, start_at, end_at, recurrence_original_start from public.calendar_lessons where id = $1", [L(n)])).rows[0];
}
const minutes = (row) => Math.round((new Date(row.end_at) - new Date(row.start_at)) / 60000);

async function main() {
  const pg = await start({ port: 5771 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    for (const fn of ["edit_calendar_lesson", "edit_recurrence_class_title", "restore_calendar_occurrence", "delete_cancelled_calendar_lesson"]) {
      check(`existe ${fn}`, (await admin.query("select to_regprocedure($1) as f", [`public.${fn}(jsonb)`])).rows[0].f !== null);
      const acl = (await admin.query("select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth", [`public.${fn}(jsonb)`])).rows[0];
      check(`${fn}: sólo la usuaria autenticada puede ejecutarla (no anon)`, acl.auth === true && acl.anon === false);
    }

    await seed(admin);
    const sa = await pg.session(A);
    const sb = await pg.session(B);

    // ---- 1) edit_calendar_lesson sobre una clase ya creada
    let r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: { class_title: "  Conversación B2  " } });
    check("nombre de una clase suelta: se guarda sin espacios sobrantes", r.ok && r.value.class_title === "Conversación B2", JSON.stringify(r));
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: { class_title: "   " } });
    check("nombre vacío: vuelve al automático (null)", r.ok && r.value.class_title === null);
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: { class_title: "x".repeat(61) } });
    check("nombre de más de 60 caracteres: se rechaza (22023) y no cambia", !r.ok && r.code === "22023" && (await lessonRow(admin, 11)).class_title === null);
    const before11 = await lessonRow(admin, 11);
    const newEnd = new Date(new Date(before11.start_at).getTime() + 90 * 60000).toISOString();
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: { end_at: newEnd } });
    check("duración: 90 min", r.ok && minutes(await lessonRow(admin, 11)) === 90, JSON.stringify(r));
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: { end_at: new Date(new Date(before11.start_at).getTime() - 60000).toISOString() } });
    check("fin anterior al inicio: se rechaza (22023)", !r.ok && r.code === "22023" && minutes(await lessonRow(admin, 11)) === 90);
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(4), changes: { class_title: "No" } });
    check("clase ya dictada: no se edita (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 4)).class_title === "Original");
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(7), changes: { class_title: "No" } });
    check("clase cancelada: no se edita (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(6), changes: { class_title: "Ajena" } });
    check("clase de OTRA dueña: no existe a sus ojos (P0002) y no cambia", !r.ok && r.code === "P0002" && (await lessonRow(admin, 6)).class_title === "Ajena");
    r = await call(sa, "edit_calendar_lesson", { lesson_id: L(11), changes: {} });
    check("sin cambios: se rechaza (22023)", !r.ok && r.code === "22023");

    // ---- 2) ocurrencia virtual: se materializa una sola vez
    const virtualStart = new Date(Date.now() + 66 * 86400000).toISOString();
    const virtualEnd = new Date(Date.now() + 66 * 86400000 + 3600000).toISOString();
    const virtual = {
      recurrence_id: R1,
      occurrence_key: "kv",
      base: { primary_student_id: STU_A, student_name: "F8 A", level: "B1", lesson_type: "individual", start_at: virtualStart, end_at: virtualEnd, modality: "presencial", color: "#FCE4D2", recurrence_index: 99, class_title: "Original", activity_kind: "class", participants: [{ student_id: STU_A, student_name: "F8 A", level: "B1" }] },
      changes: { class_title: "Sólo esta" },
    };
    const countKv = async () => Number((await admin.query("select count(*) from public.calendar_lessons where recurrence_id = $1 and recurrence_occurrence_key = 'kv'", [R1])).rows[0].count);
    r = await call(sa, "edit_calendar_lesson", virtual);
    check("ocurrencia virtual: se materializa con el nombre nuevo, programada y en su horario", r.ok && r.value.class_title === "Sólo esta" && r.value.status === "scheduled" && new Date(r.value.start_at).toISOString() === virtualStart && r.value.is_recurring === true, JSON.stringify(r));
    check("…con su participante", Number((await admin.query("select count(*) from public.calendar_lesson_participants where calendar_lesson_id = $1", [r.value.id])).rows[0].count) === 1);
    const again = await call(sa, "edit_calendar_lesson", { ...virtual, changes: { end_at: new Date(new Date(virtualStart).getTime() + 45 * 60000).toISOString() } });
    check("repetir sobre la misma ocurrencia: edita la MISMA clase (no duplica) y conserva el nombre", again.ok && again.value.id === r.value.id && again.value.class_title === "Sólo esta" && (await countKv()) === 1);
    const virtual2 = { ...virtual, occurrence_key: "kv2" };
    const [c1, c2] = await Promise.all([call(await pg.session(A), "edit_calendar_lesson", virtual2), call(await pg.session(A), "edit_calendar_lesson", virtual2)]);
    const kv2 = Number((await admin.query("select count(*) from public.calendar_lessons where recurrence_id = $1 and recurrence_occurrence_key = 'kv2'", [R1])).rows[0].count);
    check("dos conexiones a la vez sobre la misma ocurrencia: una sola clase y las dos reciben la misma", c1.ok && c2.ok && c1.value.id === c2.value.id && kv2 === 1, JSON.stringify([c1, c2]));
    r = await call(sa, "edit_calendar_lesson", { ...virtual, occurrence_key: "k7", changes: { class_title: "X" } });
    check("ocurrencia con excepción (cancelada) y sin fila visible para este alta: ya existe la fila cancelada → se rechaza la edición", !r.ok && r.code === "22023");
    await admin.query("delete from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = 'kz'", [R1]);
    await admin.query("insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type) values ($1, $2, 'kz', 'excluded')", [A, R1]);
    r = await call(sa, "edit_calendar_lesson", { ...virtual, occurrence_key: "kz", changes: { class_title: "X" } });
    check("ocurrencia excluida de la serie (sin fila): no se materializa (22023)", !r.ok && r.code === "22023");
    r = await call(sb, "edit_calendar_lesson", { ...virtual, occurrence_key: "kx", changes: { class_title: "X" } });
    check("serie de OTRA dueña: no se materializa (P0002)", !r.ok && r.code === "P0002");

    // ---- 3) nombre de toda la serie
    await seed(admin);
    r = await call(sa, "edit_recurrence_class_title", { rule_id: R1, class_title: " Grupo de los viernes " });
    check("nombre de toda la serie: devuelve cuántas clases futuras cambió", r.ok && r.value.lessons === 3, JSON.stringify(r));
    const titles = Object.fromEntries((await admin.query("select id, class_title t from public.calendar_lessons")).rows.map((x) => [x.id, x.t]));
    check("la regla y las clases futuras programadas/reprogramadas toman el nombre", (await admin.query("select class_title from public.recurrence_rules where id = $1", [R1])).rows[0].class_title === "Grupo de los viernes" && titles[L(1)] === "Grupo de los viernes" && titles[L(2)] === "Grupo de los viernes" && titles[L(10)] === "Grupo de los viernes");
    check("la clase pasada, la dictada y las canceladas NO cambian", titles[L(3)] === "Original" && titles[L(4)] === "Original" && titles[L(7)] === "Original" && titles[L(8)] === "Original" && titles[L(9)] === "Original");
    check("otra serie de la misma dueña, otra dueña y la clase suelta NO cambian", titles[L(5)] === "Otra" && titles[L(6)] === "Ajena" && titles[L(11)] === "Suelta");
    r = await call(sa, "edit_recurrence_class_title", { rule_id: R_FOREIGN, class_title: "Robo" });
    check("serie de OTRA dueña: P0002 y no cambia", !r.ok && r.code === "P0002" && titles[L(6)] === "Ajena");
    r = await call(sa, "edit_recurrence_class_title", { rule_id: R1, class_title: "" });
    check("nombre vacío: vuelve al automático en la regla", r.ok && (await admin.query("select class_title from public.recurrence_rules where id = $1", [R1])).rows[0].class_title === null);

    // ---- 4) restaurar
    await seed(admin);
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(7) });
    check("restaurar una cancelada: vuelve a programada", r.ok && r.value.status === "scheduled", JSON.stringify(r));
    check("…y la excepción de la serie desaparece", Number((await admin.query("select count(*) from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = 'k7'", [R1])).rows[0].count) === 0);
    const row7 = await lessonRow(admin, 7);
    check("…conservando la duración", minutes(row7) === 60);
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(7) });
    check("repetir: idempotente (sigue programada, sin error)", r.ok && r.value.status === "scheduled");
    const before10 = await lessonRow(admin, 10);
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(10) });
    const row10 = await lessonRow(admin, 10);
    check("restaurar una reprogramada: vuelve a su fecha original con la misma duración", r.ok && row10.status === "scheduled" && new Date(row10.start_at).getTime() === new Date(before10.recurrence_original_start).getTime() && minutes(row10) === 60, JSON.stringify(r));
    check("…y su excepción «reprogramada» desaparece", Number((await admin.query("select count(*) from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = 'k10'", [R1])).rows[0].count) === 0);
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(8) });
    check("cancelada CON registro: no se restaura (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 8)).status === "cancelled");
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(9) });
    check("cancelada CON cobro: no se restaura (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 9)).status === "cancelled");
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(11) });
    check("clase suelta (sin serie): no hay fecha original (22023)", !r.ok && r.code === "22023");
    r = await call(sa, "restore_calendar_occurrence", { lesson_id: L(4) });
    check("clase dictada: no se restaura (22023)", !r.ok && r.code === "22023");
    r = await call(sb, "restore_calendar_occurrence", { lesson_id: L(9) });
    check("clase de OTRA dueña: P0002", !r.ok && r.code === "P0002");

    // ---- 5) eliminar una cancelada
    await seed(admin);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(7) });
    check("eliminar una cancelada de serie: se borra la tarjeta", r.ok && r.value.deleted === true && (await lessonRow(admin, 7)) === undefined, JSON.stringify(r));
    check("…y la fecha queda EXCLUIDA de la serie (no vuelve a generarse)", (await admin.query("select exception_type from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = 'k7'", [R1])).rows[0]?.exception_type === "excluded");
    check("…con sus participantes", Number((await admin.query("select count(*) from public.calendar_lesson_participants where calendar_lesson_id = $1", [L(7)])).rows[0].count) === 0);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(7) });
    check("repetir (ya eliminada): no es error y no borra nada más", r.ok && r.value.deleted === false);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(8) });
    check("cancelada CON registro: no se elimina (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 8)) !== undefined);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(9) });
    check("cancelada CON cobro: no se elimina (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 9)) !== undefined);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(1) });
    check("clase programada: primero hay que cancelarla (22023)", !r.ok && r.code === "22023" && (await lessonRow(admin, 1)) !== undefined);
    r = await call(sb, "delete_cancelled_calendar_lesson", { lesson_id: L(9) });
    check("clase de OTRA dueña: no existe a sus ojos (no la borra)", r.ok && r.value.deleted === false && (await lessonRow(admin, 9)) !== undefined);
    await admin.query("update public.calendar_lessons set status = 'cancelled' where id = $1", [L(11)]);
    r = await call(sa, "delete_cancelled_calendar_lesson", { lesson_id: L(11) });
    check("clase suelta cancelada: se elimina sin excepción de serie", r.ok && r.value.deleted === true && (await lessonRow(admin, 11)) === undefined);
    const hist = (await admin.query("select (select count(*) from public.lesson_registrations)::int r, (select count(*) from public.payment_charges)::int c")).rows[0];
    check("registros y cobros: ninguno se borró", hist.r === 1 && hist.c === 1);
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
