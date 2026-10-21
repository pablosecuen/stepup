const assert = require("node:assert/strict");
const { start } = require("./load.cjs");
const fs = require("node:fs");
const path = require("node:path");

// Recovery for embedded-postgres's Windows readiness-log detection. Only a
// fresh, disposable tf-epg database started by this rehearsal is accepted.
async function existingDisposableCluster(port) {
  assert.equal(port, "5458");
  const { Client } = require("pg");
  const connect = async () => { const c = new Client({ host: "localhost", port: Number(port), user: "postgres", password: "pw", database: "postgres" }); await c.connect(); return c; };
  const admin = await connect();
  const directory = (await admin.query("show data_directory")).rows[0].data_directory;
  assert.match(directory, /[\\/]tf-epg-[^\\/]+$/);
  const initialized = (await admin.query("select count(*)::int n from pg_namespace where nspname='auth'")).rows[0].n > 0;
  const loader = fs.readFileSync(path.join(__dirname, "load.cjs"), "utf8");
  const stubs = loader.match(/const STUBS = `([\s\S]*?)`;/)[1];
  const migrations = path.join(__dirname,"../../migrations");
  if (!initialized) {
    await admin.query(stubs);
    await admin.query(fs.readFileSync(path.join(__dirname, "fixtures/mobile_functions.sql"), "utf8"));
    for (const name of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) await admin.query(fs.readFileSync(path.join(migrations,name),"utf8"));
  } else {
    const owners = (await admin.query("select id from auth.users")).rows.map((r) => r.id).sort();
    assert.deepEqual(owners, [A,B].sort(), "Only this rehearsal's synthetic owners may be present");
    await admin.query("delete from auth.users where id in ($1,$2)", [A,B]);
    await admin.query(fs.readFileSync(path.join(migrations,"20261022000000_restore_pedagogical_registration.sql"),"utf8"));
  }
  return { admin, failures: [], session: async (uid, role="authenticated") => { const c=await connect(); await c.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??""]); await c.query(`set role ${role}`); return c; }, stop: () => admin.end() };
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const S = "cccccccc-0000-4000-8000-000000000001";
const R = "dddddddd-0000-4000-8000-000000000001";
const content = { topics: [{ id: "qa_topic", text: "Passive voice", status: "planificado" }], objectives: ["Use the passive voice"], activities: ["Book page 72", "Workbook page 50 ex 1 and 3"], activity_notes: "First line\nSecond line, punctuation intact.", internal_notes: "Private teacher note" };

(async () => {
  const pg = process.env.PEDAGOGY_TEST_PORT ? await existingDisposableCluster(process.env.PEDAGOGY_TEST_PORT) : await start({ port: 5458 });
  const clients = [];
  let checks = 0;
  function check(name, fn) { fn(); checks++; console.log(`OK ${name}`); }
  try {
    assert.deepEqual(pg.failures, [], "All migrations, including the repair, must apply.");
    const { pedagogicalContentPayload } = await import("../../../lib/lessons/pedagogical-content.ts");
    const { toLessonContent } = await import("../../../lib/repositories/lesson-content-mapping.ts");
    const browserPayload = pedagogicalContentPayload({ topics: content.topics, objectives: content.objectives, activities: content.activities, activityNotes: content.activity_notes, internalNotes: content.internal_notes });
    check("Web form serializer preserves every pedagogical field", () => assert.deepEqual(browserPayload, content));
    await pg.admin.query("insert into auth.users (id,email) values ($1,'qa_a@example.invalid'),($2,'qa_b@example.invalid')", [A,B]);
    await pg.admin.query("insert into public.students (id,owner_id,name,status,category,modality,billing_type,date_joined) values ($1,$2,'qa_student','activo','otro','online','por_clase','2026-10-01')", [S,A]);
    await pg.admin.query("insert into public.lesson_registrations (id,owner_id,status,topics,activities,material_ids) values ($1,$2,'in_progress','[]','{}','{qa_existing_material}')", [R,A]);
    await pg.admin.query("insert into public.lesson_registration_students (owner_id,lesson_registration_id,student_id,participant_status) values ($1,$2,$3,'completed')", [A,R,S]);
    const a = await pg.session(A); const b = await pg.session(B); const anon = await pg.session(null, "anon");
    clients.push(a,b,anon);
    const rpc = (client, name, payload) => client.query(`select public.${name}($1::jsonb)`, [JSON.stringify(payload)]);
    const row = async () => (await pg.admin.query("select * from public.lesson_registrations where id=$1", [R])).rows[0];
    await rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: browserPayload });
    let current = await row();
    check("Draft keeps registration open", () => assert.equal(current.status, "in_progress"));
    check("Draft persists activities and multiline notes", () => { assert.deepEqual(current.activities, content.activities); assert.equal(current.activity_notes, content.activity_notes); });
    const hydrated = toLessonContent(current, [], []);
    check("Production reader rehydrates content for the editor", () => { assert.deepEqual(hydrated.activities, content.activities); assert.deepEqual(hydrated.topics, content.topics); assert.equal(hydrated.activityNotes, content.activity_notes); assert.equal(hydrated.internalNotes, content.internal_notes); });
    check("Materials are not overwritten by content editing", () => assert.deepEqual(current.material_ids, ["qa_existing_material"]));
    const fresh = await pg.session(A); clients.push(fresh);
    const reopened = (await fresh.query("select activities,activity_notes from public.lesson_registrations where id=$1", [R])).rows[0];
    check("Another connection reopens saved content", () => { assert.deepEqual(reopened.activities, content.activities); assert.equal(reopened.activity_notes, content.activity_notes); });
    await rpc(a, "save_participant_registration", { lesson_registration_id: R, student_id: S, participant_status: null, attendance: {status:"presente",late_minutes:null}, evaluation:null, homework_reviews:[], pedagogical_content: {...content,activity_notes:"Saved together with participant"} });
    current = await row();
    check("Participant save also persists the shared activity notes", () => assert.equal(current.activity_notes,"Saved together with participant"));
    await assert.rejects(rpc(a, "save_participant_registration", { lesson_registration_id: R, student_id: S, participant_status: null, attendance:null, evaluation:{general_grade:99}, homework_reviews:[], pedagogical_content: {...content,activity_notes:"Must roll back"} })); checks++;
    current = await row();
    check("Participant failure rolls back shared content too", () => assert.equal(current.activity_notes,"Saved together with participant"));
    await rpc(a, "save_lesson_content_draft", { lesson_registration_id:R,pedagogical_content:content });
    await assert.rejects(rpc(b, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content }), /Registro no encontrado/); checks++;
    await assert.rejects(rpc(anon, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content }), /permission denied/); checks++;
    await assert.rejects(a.query("select public.apply_lesson_pedagogical_content($1,$2)", [R,JSON.stringify(content)]), /permission denied/); checks++;
    const bad = { ...content, activities: [42] };
    await assert.rejects(rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: bad }), /Revisá/); checks++;
    current = await row();
    check("Malformed draft does not overwrite saved content", () => assert.deepEqual(current.activities, content.activities));
    const finalContent = { ...content, topics: [{ ...content.topics[0], status: "visto" }], activities: [...content.activities, "Feedback writing an article"] };
    await rpc(a, "finalize_lesson_registration", { lesson_registration_id: R, pedagogical_content: finalContent });
    current = await row();
    check("Finalize atomically saves content and topic state", () => { assert.equal(current.status, "completed"); assert.deepEqual(current.topics, finalContent.topics); assert.deepEqual(current.activities, finalContent.activities); });
    await assert.rejects(rpc(a, "save_lesson_content_draft", { lesson_registration_id: R, pedagogical_content: content }), /Guardar cambios/); checks++;
    const edited = { ...finalContent, activity_notes: "Edited notes", activities: ["Corrected activity"] };
    const operation = "eeeeeeee-0000-4000-8000-000000000001";
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: operation, participants: [], pedagogical_content: edited });
    current = await row();
    check("Completed content is editable", () => { assert.deepEqual(current.activities, edited.activities); assert.equal(current.activity_notes, edited.activity_notes); });
    const history = (await pg.admin.query("select previous_snapshot from public.lesson_registration_edit_history where lesson_registration_id=$1", [R])).rows;
    check("Edit history retains original pedagogy", () => { assert.equal(history.length,1); assert.deepEqual(history[0].previous_snapshot.registration.activities, finalContent.activities); assert.equal(history[0].previous_snapshot.registration.internal_notes, content.internal_notes); });
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: operation, participants: [], pedagogical_content: content });
    current = await row();
    check("Retry cannot replay an edit or duplicate history", () => { assert.deepEqual(current.activities, edited.activities); });
    const historyBefore = (await pg.admin.query("select count(*) from public.lesson_registration_edit_history where lesson_registration_id=$1", [R])).rows[0].count;
    await assert.rejects(rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: "eeeeeeee-0000-4000-8000-000000000002", participants: [], pedagogical_content: bad }), /Revisá/); checks++;
    const historyAfter = (await pg.admin.query("select count(*) from public.lesson_registration_edit_history where lesson_registration_id=$1", [R])).rows[0].count;
    current = await row();
    check("Invalid completed edit rolls back history and content", () => { assert.equal(historyAfter, historyBefore); assert.deepEqual(current.activities, edited.activities); });
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: "eeeeeeee-0000-4000-8000-000000000003", participants: [], homework_description: "qa_homework" });
    current = await row();
    check("Legacy callers omit content without erasing it", () => { assert.deepEqual(current.activities, edited.activities); assert.equal(current.activity_notes, edited.activity_notes); });
    const empty = { topics: [], objectives: [], activities: [], activity_notes: "", internal_notes: "" };
    await rpc(a, "edit_completed_lesson_registration", { lesson_registration_id: R, edit_operation_id: "eeeeeeee-0000-4000-8000-000000000004", participants: [], pedagogical_content: empty });
    current = await row();
    check("Explicitly removing text and lists persists", () => { assert.deepEqual(current.activities, []); assert.deepEqual(current.topics, []); assert.equal(current.activity_notes, ""); assert.deepEqual(current.material_ids, ["qa_existing_material"]); });
    console.log(`${checks} checks passed against isolated PostgreSQL. No production connection.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    await pg.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
