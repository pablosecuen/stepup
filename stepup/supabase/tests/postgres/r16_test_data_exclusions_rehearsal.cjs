// R16 — Exclusión REVERSIBLE de datos de prueba. Postgres REAL aislado, datos SINTÉTICOS (los ids de la lista son los de la cuenta real; acá se fabrican alumnos con esos ids).
//
//   • la migración crea la tabla vacía y con RLS; sin filas activas no cambia nada;
//   • el script de carga escribe SÓLO filas de la tabla (ningún dato de agenda, registros ni cobros cambia) y es idempotente;
//   • todas las verificaciones previas frenan la carga SIN escribir nada: alumno con id de origen, participante real compartido, cobro vigente, alumno que falta;
//   • el script de reversión revoca (no borra) y volver a cargar reactiva;
//   • una usuaria no ve ni cambia las exclusiones de otra (RLS).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r16_test_data_exclusions_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const MARK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r16_mark_qa_exclusions.sql"), "utf8");
const UNMARK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r16_unmark_qa_exclusions.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const QA = [
  ["900fa18b-deba-437a-a521-d5d34526847f", "QA Alumno Editado", "activo"],
  ["48cf7afc-2eb4-485b-a6e7-e0a6778f35f9", "QA Alumno Dos", "activo"],
  ["2a31eb0f-19ce-465a-9e2a-07820bc24f6b", "PRUEBA WEB F5 Mensual", "archivado"],
  ["f3888fe5-65fb-4309-be71-60a170fd4d8e", "PRUEBA WEB F5 Entrenamiento", "archivado"],
  ["90f8125b-7a21-42e1-97b9-29654bfce199", "PRUEBA WEB FECHA Alumno", "archivado"],
  ["92fc1a5d-f696-43f9-8122-91b357146331", "PRUEBA WEB F6 Mensual", "archivado"],
];
const REAL = "cccccccc-0000-4000-8000-0000000000c1";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
async function rejects(fn, re, name) {
  try { await fn(); check(name, false, "no falló"); } catch (e) { check(name, re.test(String(e.message)), String(e.message).slice(0, 160)); }
}

async function seed(admin) {
  await admin.query("delete from auth.users where id in ($1,$2)", [A, B]);
  for (const id of [A, B]) await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.invalid`]);
  const student = (id, name, status, legacy) => admin.query("insert into public.students (id, owner_id, name, status, category, modality, billing_type, date_joined, legacy_mobile_id) values ($1,$2,$3,$4,'otro','online','por_clase','2026-09-21',$5)", [id, A, name, status, legacy ?? null]);
  for (const [id, name, status] of QA) await student(id, name, status);
  await student(REAL, "Alumna Real", "activo", "legacy-real");
  const rule = async (id, primary, participants, legacy) => {
    await admin.query("insert into public.recurrence_rules (id, owner_id, primary_student_id, status, cycle_length_weeks, weeks, modality, timezone, rule_type, start_date, legacy_mobile_id) values ($1,$2,$3,'active',1,'[]'::jsonb,'online','America/Argentina/Buenos_Aires','weekly','2026-10-05',$4)", [id, A, primary, legacy ?? null]);
    for (const p of participants) await admin.query("insert into public.recurrence_rule_participants (owner_id, student_id, recurrence_rule_id) values ($1,$2,$3)", [A, p, id]);
  };
  const lesson = async (id, primary, participants, legacy) => {
    await admin.query("insert into public.calendar_lessons (id, owner_id, color, lesson_type, start_at, end_at, modality, status, primary_student_id, student_name, level, legacy_mobile_id) values ($1,$2,'x','individual','2026-10-06T13:00:00Z','2026-10-06T14:00:00Z','online','scheduled',$3,'n','B1',$4)", [id, A, primary, legacy ?? null]);
    for (const p of participants) await admin.query("insert into public.calendar_lesson_participants (owner_id, student_id, calendar_lesson_id, student_name, level) values ($1,$2,$3,'n','B1')", [A, p, id]);
  };
  const registration = async (id, participants, legacy) => {
    await admin.query("insert into public.lesson_registrations (id, owner_id, legacy_mobile_id) values ($1,$2,$3)", [id, A, legacy ?? null]);
    for (const p of participants) await admin.query("insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id) values ($1,$2,$3)", [A, id, p]);
  };
  await rule("10000000-0000-4000-8000-000000000001", QA[0][0], [QA[0][0], QA[1][0]]);
  await rule("10000000-0000-4000-8000-000000000002", REAL, [REAL], "legacy-rule");
  await lesson("20000000-0000-4000-8000-000000000001", QA[1][0], [QA[1][0]]);
  await lesson("20000000-0000-4000-8000-000000000002", REAL, [REAL], "legacy-lesson");
  await registration("30000000-0000-4000-8000-000000000001", [QA[1][0]]);
  await registration("30000000-0000-4000-8000-000000000002", [REAL], "legacy-reg");
  await admin.query("insert into public.payment_charges (owner_id, due_date, student_id, charge_type, original_amount, billing_period, voided_at) values ($1,'2026-09-10',$2,'mensual',50000,'2026-09', now())", [A, QA[2][0]]);
  await admin.query("insert into public.payment_charges (owner_id, due_date, student_id, charge_type, original_amount, billing_period, legacy_mobile_id) values ($1,'2026-10-10',$2,'mensual',70000,'2026-10','legacy-charge')", [A, REAL]);
}

/** Huella de TODO lo que no es la tabla de exclusiones: no debe cambiar nunca. */
async function footprint(admin) {
  const tables = ["students", "recurrence_rules", "recurrence_rule_participants", "calendar_lessons", "calendar_lesson_participants", "lesson_registrations", "lesson_registration_students", "payment_charges"];
  const out = {};
  for (const t of tables) out[t] = (await admin.query(`select count(*)::int n, md5(coalesce(string_agg((to_jsonb(x) - 'updated_at' - 'created_at')::text, '|' order by (to_jsonb(x) - 'updated_at' - 'created_at')::text), '')) h from public.${t} x`)).rows[0];
  return JSON.stringify(out);
}
const activeCount = async (admin) => (await admin.query("select count(*)::int n from public.test_data_exclusions where revoked_at is null")).rows[0].n;
const totalCount = async (admin) => (await admin.query("select count(*)::int n from public.test_data_exclusions")).rows[0].n;

async function main() {
  const pg = await start({ port: 5771 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    check("la migración R16 existe y es la última", fs.readdirSync(path.join(ROOT, "supabase", "migrations")).sort().pop().includes("r16_test_data_exclusions"));
    check("la tabla nace VACÍA (sin cargar ningún alumno)", (await totalCount(admin)) === 0);
    check("tiene RLS activada y política por cuenta", (await admin.query("select relrowsecurity from pg_class where oid = 'public.test_data_exclusions'::regclass")).rows[0].relrowsecurity === true && (await admin.query("select count(*)::int n from pg_policies where tablename = 'test_data_exclusions'")).rows[0].n === 1);

    await seed(admin);
    const before = await footprint(admin);

    // — verificaciones previas: cada una frena SIN escribir nada —
    await admin.query("update public.students set legacy_mobile_id = 'vino-del-telefono' where id = $1", [QA[0][0]]);
    await rejects(() => admin.query(MARK), /se esperaban 6 alumnos de prueba sin id de origen/, "un alumno de la lista con id de origen (vino del teléfono) frena la carga");
    check("…y no escribió nada", (await totalCount(admin)) === 0);
    await admin.query("update public.students set legacy_mobile_id = null where id = $1", [QA[0][0]]);

    await admin.query("update public.students set id = $2 where id = $1", [QA[5][0], "99999999-0000-4000-8000-000000000009"]);
    await rejects(() => admin.query(MARK), /se esperaban 6 alumnos/, "un alumno que falta frena la carga");
    await admin.query("update public.students set id = $1 where id = $2", [QA[5][0], "99999999-0000-4000-8000-000000000009"]);

    await admin.query("insert into public.calendar_lesson_participants (owner_id, student_id, calendar_lesson_id, student_name, level) values ($1,$2,'20000000-0000-4000-8000-000000000001','n','B1')", [A, REAL]);
    await rejects(() => admin.query(MARK), /comparten participantes con alumnos que no son de prueba/, "una clase compartida con una alumna real frena la carga (nada «mixto» se oculta)");
    await admin.query("delete from public.calendar_lesson_participants where calendar_lesson_id = '20000000-0000-4000-8000-000000000001' and student_id = $1", [REAL]);

    await admin.query("insert into public.payment_charges (owner_id, due_date, student_id, charge_type, original_amount, billing_period) values ($1,'2026-09-10',$2,'mensual',1000,'2026-09')", [A, QA[3][0]]);
    await rejects(() => admin.query(MARK), /cobros o pagos vigentes/, "un cobro vigente de un alumno de prueba frena la carga (no se oculta dinero real)");
    await admin.query("delete from public.payment_charges where student_id = $1", [QA[3][0]]);

    await admin.query("update public.calendar_lessons set legacy_mobile_id = 'importada' where id = '20000000-0000-4000-8000-000000000001'");
    await rejects(() => admin.query(MARK), /filas importadas del origen involucran a alumnos de prueba/, "una clase importada del origen con un alumno de la lista frena la carga");
    await admin.query("update public.calendar_lessons set legacy_mobile_id = null where id = '20000000-0000-4000-8000-000000000001'");
    check("ninguna verificación fallida escribió nada, ni cambió un solo dato", (await totalCount(admin)) === 0 && (await footprint(admin)) === before);

    // — carga real —
    await admin.query(MARK);
    check("la carga marca exactamente los 6 alumnos de la lista", (await activeCount(admin)) === 6 && (await admin.query("select count(*)::int n from public.test_data_exclusions e join public.students s on s.id = e.student_id where s.legacy_mobile_id is null")).rows[0].n === 6);
    check("la carga NO cambió ningún dato de agenda, registros, alumnos ni cobros", (await footprint(admin)) === before);
    check("la alumna real y todo lo suyo no quedó marcado", (await admin.query("select count(*)::int n from public.test_data_exclusions where student_id = $1", [REAL])).rows[0].n === 0);
    check("guarda la evidencia (nombre y fecha de creación)", (await admin.query("select count(*)::int n from public.test_data_exclusions where evidence ? 'nombre' and evidence ? 'creado'")).rows[0].n === 6);
    await admin.query(MARK);
    check("cargar dos veces no duplica (idempotente)", (await activeCount(admin)) === 6 && (await totalCount(admin)) === 6);

    // — reversión —
    await admin.query(UNMARK);
    check("la reversión revoca las 6 exclusiones (ninguna vigente)", (await activeCount(admin)) === 0);
    check("…pero NO borra nada: las filas siguen ahí con su fecha de revocación, y los datos intactos", (await totalCount(admin)) === 6 && (await admin.query("select count(*)::int n from public.test_data_exclusions where revoked_at is not null")).rows[0].n === 6 && (await footprint(admin)) === before);
    await admin.query(MARK);
    check("volver a cargar reactiva la lista (6 vigentes, 12 filas de historial)", (await activeCount(admin)) === 6 && (await totalCount(admin)) === 12);
    await admin.query(UNMARK);
    check("y se puede volver a revertir", (await activeCount(admin)) === 0 && (await footprint(admin)) === before);

    // — RLS —
    await admin.query(MARK);
    const sa = await pg.session(A);
    const sb = await pg.session(B);
    try {
      check("la dueña ve sus exclusiones", (await sa.query("select count(*)::int n from public.test_data_exclusions where revoked_at is null")).rows[0].n === 6);
      check("otra cuenta no ve ninguna", (await sb.query("select count(*)::int n from public.test_data_exclusions")).rows[0].n === 0);
      await rejects(() => sb.query("insert into public.test_data_exclusions (owner_id, student_id, reason) values ($1,$2,'x')", [A, REAL]), /row-level security/, "otra cuenta no puede escribir exclusiones en nombre de la dueña");
      const upd = await sb.query("update public.test_data_exclusions set revoked_at = now()");
      check("otra cuenta no puede revocar exclusiones ajenas", upd.rowCount === 0);
    } finally { await sa.end(); await sb.end(); }
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones correctas`);
  if (failures.length) { console.log("FALLAS:\n- " + failures.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
