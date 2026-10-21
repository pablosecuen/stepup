// Resultado de una clase programada (alumno ausente, cancelada, reprogramada…). Postgres REAL aislado, datos SINTÉTICOS, ninguna conexión a Production.
//
//   • cambiar el resultado de un registro EN CURSO: una clase individual puede quedar «alumno ausente» (no cuenta como clase y cierra al alumno); un grupo no;
//   • «cancelada tarde» exige política (y porcentaje válido con «cobrar un porcentaje»); la política se limpia al elegir otro resultado;
//   • volver a «realizada» reabre sólo a quien se había cerrado automáticamente; un registro finalizado, de otra cuenta o de un anónimo nunca cambia;
//   • finalizar un registro «alumno ausente» lo completa con la asistencia del alumno y sin contar como clase.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/registration_outcomes_rehearsal.cjs
const assert = require("node:assert/strict");
const { start } = require("./load.cjs");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const S1 = "cccccccc-0000-4000-8000-000000000001";
const S2 = "cccccccc-0000-4000-8000-000000000002";
const S3 = "cccccccc-0000-4000-8000-000000000003";
const R1 = "dddddddd-0000-4000-8000-000000000001"; // individual
const R2 = "dddddddd-0000-4000-8000-000000000002"; // grupal

(async () => {
  const pg = await start({ port: 5461 });
  const clients = [];
  let checks = 0;
  const check = (name, fn) => { fn(); checks += 1; console.log(`OK ${name}`); };
  const rejects = async (promise, re, name) => { await assert.rejects(promise, re, name); checks += 1; console.log(`OK ${name}`); };
  try {
    assert.deepEqual(pg.failures, [], "Todas las migraciones, incluida la nueva, deben aplicarse.");
    const { admin } = pg;
    await admin.query("insert into auth.users (id,email) values ($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
    for (const [id, name] of [[S1, "alumna uno"], [S2, "alumna dos"], [S3, "alumna tres"]]) await admin.query("insert into public.students (id,owner_id,name,status,category,modality,billing_type,date_joined) values ($1,$2,$3,'activo','otro','online','por_clase','2026-10-01')", [id, A, name]);
    await admin.query("insert into public.lesson_registrations (id,owner_id,status,counts_as_class) values ($1,$3,'in_progress',true),($2,$3,'in_progress',true)", [R1, R2, A]);
    await admin.query("insert into public.lesson_registration_students (owner_id,lesson_registration_id,student_id,participant_status) values ($1,$2,$3,'pending'),($1,$4,$5,'pending'),($1,$4,$6,'pending')", [A, R1, S1, R2, S2, S3]);
    const a = await pg.session(A); const b = await pg.session(B); const anon = await pg.session(null, "anon");
    clients.push(a, b, anon);
    const change = (client, id, outcome, extra = {}) => client.query("select * from public.change_lesson_registration_outcome($1::jsonb)", [JSON.stringify({ lesson_registration_id: id, outcome, ...extra })]);
    const reg = async (id) => (await admin.query("select * from public.lesson_registrations where id=$1", [id])).rows[0];
    const statuses = async (id) => (await admin.query("select participant_status from public.lesson_registration_students where lesson_registration_id=$1 order by student_id", [id])).rows.map((r) => r.participant_status);

    await change(a, R1, "alumno_ausente");
    let row = await reg(R1);
    check("clase individual: alumno ausente no cuenta como clase y cierra al alumno", () => assert.deepEqual([row.outcome, row.counts_as_class], ["alumno_ausente", false]));
    assert.deepEqual(await statuses(R1), ["completed"]); checks += 1; console.log("OK el único alumno queda completado");

    await a.query("select public.save_participant_registration($1::jsonb)", [JSON.stringify({ lesson_registration_id: R1, student_id: S1, participant_status: null, attendance: { status: "ausente_aviso", late_minutes: null }, evaluation: null, homework_reviews: [] })]);
    await a.query("select public.finalize_lesson_registration($1::jsonb)", [JSON.stringify({ lesson_registration_id: R1 })]);
    row = await reg(R1);
    const attendance = (await admin.query("select status from public.lesson_registration_attendance where lesson_registration_id=$1", [R1])).rows;
    check("finalizar lo completa con la asistencia «ausente con aviso» y sin contar como clase", () => { assert.equal(row.status, "completed"); assert.equal(row.counts_as_class, false); assert.deepEqual(attendance.map((r) => r.status), ["ausente_aviso"]); });
    await rejects(change(a, R1, "clase_dictada"), /ya está finalizado/, "un registro finalizado no cambia de resultado por este camino");

    await rejects(change(a, R2, "alumno_ausente"), /sólo se puede elegir en una clase individual/, "en un grupo «alumno ausente» no se puede elegir");
    await rejects(change(a, R2, "cancelada_tarde"), /Elegí la política/, "cancelada tarde exige política");
    await rejects(change(a, R2, "cancelada_tarde", { late_cancellation_policy: "cobrar_porcentaje" }), /porcentaje/, "cobrar un porcentaje exige el porcentaje");
    await rejects(change(a, R2, "cancelada_tarde", { late_cancellation_policy: "cobrar_porcentaje", late_cancellation_percentage: 150 }), /porcentaje/, "un porcentaje fuera de 0–100 se rechaza");
    await rejects(change(a, R2, "no_existe"), /no es válido/, "un resultado desconocido se rechaza");

    await change(a, R2, "cancelada_tarde", { late_cancellation_policy: "cobrar_porcentaje", late_cancellation_percentage: 40 });
    row = await reg(R2);
    check("cancelada tarde con política y porcentaje queda guardada y cierra a todos", () => { assert.deepEqual([row.outcome, row.late_cancellation_policy, row.late_cancellation_percentage, row.counts_as_class], ["cancelada_tarde", "cobrar_porcentaje", 40, false]); });
    assert.deepEqual(await statuses(R2), ["completed", "completed"]); checks += 1; console.log("OK todos los participantes quedan completados");

    await change(a, R2, "profesora_ausente", { late_cancellation_policy: "no_cobrar" });
    row = await reg(R2);
    check("al elegir otro resultado la política y el porcentaje se limpian", () => assert.deepEqual([row.outcome, row.late_cancellation_policy, row.late_cancellation_percentage], ["profesora_ausente", null, null]));

    await change(a, R2, "feriado", { holiday_exception: true });
    row = await reg(R2);
    check("feriado con excepción cuenta como clase dictada", () => assert.deepEqual([row.outcome, row.holiday_exception, row.counts_as_class], ["feriado", true, true]));
    assert.deepEqual(await statuses(R2), ["pending", "pending"]); checks += 1; console.log("OK volver a una clase dictada reabre a quienes se cerraron solos");

    await a.query("select public.save_participant_registration($1::jsonb)", [JSON.stringify({ lesson_registration_id: R2, student_id: S2, participant_status: "completed", attendance: { status: "presente", late_minutes: null }, evaluation: null, homework_reviews: [] })]);
    await change(a, R2, "profesora_ausente");
    await change(a, R2, "clase_dictada");
    assert.deepEqual(await statuses(R2), ["completed", "pending"]); checks += 1; console.log("OK quien ya tenía asistencia cargada queda completado y sólo se reabre al otro");
    row = await reg(R2);
    check("y la clase vuelve a contar y sin feriado", () => assert.deepEqual([row.outcome, row.holiday_exception, row.counts_as_class], ["clase_dictada", false, true]));

    await rejects(change(b, R2, "profesora_ausente"), /Registro no encontrado/, "otra cuenta no puede cambiar el resultado");
    await rejects(change(anon, R2, "profesora_ausente"), /permission denied/, "un anónimo no puede cambiarlo");
    await rejects(admin.query("update public.lesson_registrations set outcome='otro' where id=$1", [R2]), /outcome_check/, "la base rechaza resultados fuera de la lista");
    console.log(`\n${checks} comprobaciones correctas contra PostgreSQL aislado. Ninguna conexión a Production.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    await pg.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
