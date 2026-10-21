// «Guardar progreso» de un registro en curso guarda también la tarea para la próxima clase y la duración real. Postgres REAL aislado, datos SINTÉTICOS, ninguna conexión a Production.
//
//   • el pedido de siempre (sólo contenido) no toca la tarea ni la duración;
//   • con tarea y fechas reales en el pedido, quedan guardadas y se pueden volver a leer desde otra conexión;
//   • cada campo se toca sólo cuando viene (una tarea vacía la borra; omitirla la conserva); un fin real anterior al inicio se rechaza sin guardar nada;
//   • sigue rechazando un registro finalizado, a otra cuenta y a anónimos; no cambia el estado ni los participantes.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/registration_draft_header_rehearsal.cjs
const assert = require("node:assert/strict");
const { start } = require("./load.cjs");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const S = "cccccccc-0000-4000-8000-000000000001";
const R = "dddddddd-0000-4000-8000-000000000001";
const content = { topics: [], objectives: [], activities: ["Book page 72"], activity_notes: "notas", internal_notes: "" };

(async () => {
  const pg = await start({ port: 5460 });
  const clients = [];
  let checks = 0;
  const check = (name, fn) => { fn(); checks += 1; console.log(`OK ${name}`); };
  const rejects = async (promise, re, name) => { await assert.rejects(promise, re, name); checks += 1; console.log(`OK ${name}`); };
  try {
    assert.deepEqual(pg.failures, [], "Todas las migraciones, incluida la nueva, deben aplicarse.");
    const { admin } = pg;
    await admin.query("insert into auth.users (id,email) values ($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
    await admin.query("insert into public.students (id,owner_id,name,status,category,modality,billing_type,date_joined) values ($1,$2,'alumna uno','activo','otro','online','por_clase','2026-10-01')", [S, A]);
    await admin.query("insert into public.lesson_registrations (id,owner_id,status,homework_description,homework_due_date) values ($1,$2,'in_progress','tarea previa','2026-10-30')", [R, A]);
    await admin.query("insert into public.lesson_registration_students (owner_id,lesson_registration_id,student_id,participant_status) values ($1,$2,$3,'pending')", [A, R, S]);
    const a = await pg.session(A); const b = await pg.session(B); const anon = await pg.session(null, "anon");
    clients.push(a, b, anon);
    const rpc = (client, payload) => client.query("select public.save_lesson_content_draft($1::jsonb)", [JSON.stringify(payload)]);
    const reg = async () => (await admin.query("select * from public.lesson_registrations where id=$1", [R])).rows[0];
    const date = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

    await rpc(a, { lesson_registration_id: R, pedagogical_content: content });
    let row = await reg();
    check("el pedido de siempre (sólo contenido) conserva la tarea y la duración", () => { assert.equal(row.homework_description, "tarea previa"); assert.equal(date(row.homework_due_date), "2026-10-30"); assert.equal(row.actual_started_at, null); assert.equal(row.actual_ended_at, null); });

    await rpc(a, { lesson_registration_id: R, pedagogical_content: content, homework_description: "Ejercicios de present perfect", homework_due_date: "2026-10-28", actual_started_at: "2026-10-21T13:00:00.000Z", actual_ended_at: "2026-10-21T14:30:00.000Z" });
    const fresh = await pg.session(A); clients.push(fresh);
    row = (await fresh.query("select * from public.lesson_registrations where id=$1", [R])).rows[0];
    check("con la tarea y la duración en el pedido, otra conexión las vuelve a leer", () => {
      assert.equal(row.homework_description, "Ejercicios de present perfect");
      assert.equal(date(row.homework_due_date), "2026-10-28");
      assert.equal((new Date(row.actual_ended_at) - new Date(row.actual_started_at)) / 60000, 90);
      assert.equal(row.status, "in_progress");
    });

    await rpc(a, { lesson_registration_id: R, pedagogical_content: content, homework_description: "" , homework_due_date: "" });
    row = await reg();
    check("una tarea vacía la borra y también la fecha; la duración queda como estaba", () => { assert.equal(row.homework_description, null); assert.equal(row.homework_due_date, null); assert.ok(row.actual_ended_at); });

    await rpc(a, { lesson_registration_id: R, pedagogical_content: { ...content, activity_notes: "otras" }, homework_description: "Otra tarea" });
    await rpc(a, { lesson_registration_id: R, pedagogical_content: { ...content, activity_notes: "otras 2" } });
    row = await reg();
    check("omitir la tarea en un pedido posterior la conserva", () => assert.equal(row.homework_description, "Otra tarea"));

    await rejects(rpc(a, { lesson_registration_id: R, pedagogical_content: { ...content, activity_notes: "no debe guardarse" }, actual_started_at: "2026-10-21T14:00:00.000Z", actual_ended_at: "2026-10-21T13:00:00.000Z" }), /posterior a la de inicio/, "un fin real anterior al inicio se rechaza");
    row = await reg();
    check("y no deja guardado nada a medias", () => { assert.equal(row.activity_notes, "otras 2"); assert.equal(new Date(row.actual_ended_at) - new Date(row.actual_started_at), 90 * 60000); });

    const participants = (await admin.query("select participant_status from public.lesson_registration_students where lesson_registration_id=$1", [R])).rows;
    check("el progreso del alumno no cambia", () => assert.deepEqual(participants.map((p) => p.participant_status), ["pending"]));

    await rejects(rpc(b, { lesson_registration_id: R, pedagogical_content: content, homework_description: "ajena" }), /Registro no encontrado/, "otra cuenta no puede guardar");
    await rejects(rpc(anon, { lesson_registration_id: R, pedagogical_content: content }), /permission denied/, "un anónimo no puede guardar");
    await rpc(a, { lesson_registration_id: R, pedagogical_content: content });
    await rpc(a, { lesson_registration_id: R, pedagogical_content: content, actual_started_at: "2026-10-21T13:00:00.000Z" });
    await admin.query("update public.lesson_registration_students set participant_status='completed' where lesson_registration_id=$1", [R]);
    await a.query("select public.finalize_lesson_registration($1::jsonb)", [JSON.stringify({ lesson_registration_id: R })]);
    await rejects(rpc(a, { lesson_registration_id: R, pedagogical_content: content, homework_description: "tarde" }), /Guardar cambios/, "un registro finalizado se edita con «Guardar cambios», no con el progreso");
    console.log(`\n${checks} comprobaciones correctas contra PostgreSQL aislado. Ninguna conexión a Production.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    await pg.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
