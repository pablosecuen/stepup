// Clase en curso (migración 20261029100000): comenzar, puntualidad, corregir inicio, descartar y finalizar. Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/live_class_sessions.cjs
//
// Cubre: permisos, validación de la respuesta de puntualidad, clase ajena/cancelada/de otro día/sin registro/ya registrada, reintento idempotente, otra clase mientras hay una en curso,
// dos comienzos simultáneos (exactamente uno gana), corrección de inicio (futuro, antiguo, sin sesión), finalizar (vuelca tiempos y puntualidad, cierra la sesión, repetir falla limpio, registro
// ya completado no se pisa), descartar (idempotente, no toca el registro), aislamiento entre dueñas y que ningún cobro/pago cambia.
const { start } = require("./load.cjs");

const A = "fa000000-0000-0000-0000-000000000001";
const B = "fa000000-0000-0000-0000-000000000002";
const STU_A = "fa100000-0000-0000-0000-000000000001";
const STU_B = "fa100000-0000-0000-0000-000000000002";
const L = (n) => `fa300000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function rpc(session, sql, params = []) {
  try {
    const { rows } = await session.query(sql, params);
    return { ok: true, value: rows[0]?.r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}
const startLive = (session, lessonId, arrival) => rpc(session, "select to_jsonb(public.start_live_class($1::uuid, $2::jsonb)) as r", [lessonId, JSON.stringify(arrival)]);
const correctLive = (session, iso) => rpc(session, "select to_jsonb(public.correct_live_class_start($1::timestamptz)) as r", [iso]);
const finishLive = (session) => rpc(session, "select public.finish_live_class() as r");
const discardLive = (session) => rpc(session, "select public.discard_live_class() as r");
const ON_TIME = { status: "on_time", lateMinutes: 0, manuallyCorrected: false };

async function seed(admin) {
  await admin.query("truncate public.students cascade");
  await admin.query("delete from public.live_class_sessions");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await admin.query(
    `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
     ($1, $3, 'FA A', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000),
     ($2, $4, 'FA B', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000)`,
    [STU_A, STU_B, A, B]
  );
  const lesson = (n, owner, student, startExpr, status) =>
    admin.query(
      `insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, class_title, activity_kind)
       values ($1, $2, $3, 'FA', 'B1', 'individual', ${startExpr}, ${startExpr} + interval '1 hour', 'presencial', $4, '#FCE4D2', false, 'T', 'class')`,
      [L(n), owner, student, status]
    );
  await lesson(1, A, STU_A, "now()", "scheduled"); // hoy, con registro en borrador
  await lesson(2, A, STU_A, "now()", "scheduled"); // hoy, con registro en borrador (la «otra» clase)
  await lesson(3, A, STU_A, "now() + interval '2 days'", "scheduled"); // otro día
  await lesson(4, A, STU_A, "now()", "cancelled"); // cancelada
  await lesson(5, A, STU_A, "now()", "scheduled"); // ya registrada
  await lesson(6, A, STU_A, "now()", "scheduled"); // sin registro
  await lesson(7, B, STU_B, "now()", "scheduled"); // ajena
  await lesson(8, A, STU_A, "now()", "scheduled"); // para el cierre con registro ya completado
  const registration = (n, owner, lessonN, status) =>
    admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, status, scheduled_start_at) values ($1, $2, $3, $4, now())`, [`fa400000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`, owner, L(lessonN), status]);
  for (const n of [1, 2, 3, 4, 8]) await registration(n, A, n, "in_progress");
  await registration(5, A, 5, "completed");
  await registration(7, B, 7, "in_progress");
}
const reg = async (admin, n) => (await admin.query("select * from public.lesson_registrations where calendar_lesson_id = $1", [L(n)])).rows[0];
const sessionRow = async (admin, owner) => (await admin.query("select * from public.live_class_sessions where owner_id = $1", [owner])).rows[0];

async function main() {
  const pg = await start({ port: 5773 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    for (const fn of ["start_live_class(uuid, jsonb)", "correct_live_class_start(timestamptz)", "discard_live_class()", "finish_live_class()"]) {
      const acl = (await admin.query("select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth", [`public.${fn}`])).rows[0];
      check(`${fn}: sólo la usuaria autenticada puede ejecutarla`, acl.auth === true && acl.anon === false);
    }
    await seed(admin);
    const chargesBefore = Number((await admin.query("select count(*) from public.payment_charges")).rows[0].count);
    const sa = await pg.session(A);
    const sa2 = await pg.session(A);
    const sb = await pg.session(B);

    // ---- Validación de la respuesta de puntualidad
    const bad = [
      ["sin estado", { lateMinutes: 0, manuallyCorrected: false }],
      ["estado desconocido", { status: "casi", lateMinutes: 0, manuallyCorrected: false }],
      ["demora negativa", { status: "late", lateMinutes: -3, manuallyCorrected: false }],
      ["demora con decimales", { status: "late", lateMinutes: 2.5, manuallyCorrected: false }],
      ["demora como texto", { status: "late", lateMinutes: "5", manuallyCorrected: false }],
      ["sin indicador de corrección manual", { status: "on_time", lateMinutes: 0 }],
      ["hora de llegada ilegible", { status: "late", lateMinutes: 5, manuallyCorrected: false, arrivedAt: "ayer" }],
    ];
    for (const [name, arrival] of bad) {
      const r = await startLive(sa, L(1), arrival);
      check(`puntualidad inválida (${name}): se rechaza y no queda sesión`, !r.ok && r.code === "22023" && !(await sessionRow(admin, A)), JSON.stringify(r));
    }

    // ---- La clase tiene que ser comenzable
    let r = await startLive(sa, L(7), ON_TIME);
    check("una clase ajena no existe para la profesora (P0002)", !r.ok && r.code === "P0002");
    r = await startLive(sa, L(4), ON_TIME);
    check("una clase cancelada no se puede comenzar", !r.ok && r.code === "22023");
    r = await startLive(sa, L(3), ON_TIME);
    check("una clase de otro día no se puede comenzar", !r.ok && r.code === "22023");
    r = await startLive(sa, L(6), ON_TIME);
    check("sin registro iniciado no se puede comenzar", !r.ok && r.code === "22023");
    r = await startLive(sa, L(5), ON_TIME);
    check("una clase ya registrada no se puede comenzar", !r.ok && r.code === "22023");
    check("ninguno de los rechazos dejó una sesión", !(await sessionRow(admin, A)));

    // ---- Comenzar
    r = await startLive(sa, L(1), { status: "late", lateMinutes: 7, manuallyCorrected: false, arrivedAt: new Date().toISOString() });
    check("comenzar: devuelve la sesión con la duración asignada (60 min) y origen «botón»", r.ok && r.value.scheduled_duration_minutes === 60 && r.value.start_source === "button", JSON.stringify(r));
    check("comenzar: guarda la respuesta de puntualidad tal cual", r.ok && r.value.student_arrival.status === "late" && r.value.student_arrival.lateMinutes === 7);
    check("comenzar: el horario efectivo es el de la clase y no hay ajuste", r.ok && r.value.effective_start_at === r.value.scheduled_start_at && r.value.schedule_adjustment === null);
    const first = r.value;
    const again = await startLive(sa, L(1), ON_TIME);
    check("repetir con la misma clase es un reintento: misma sesión, nada cambia", again.ok && again.value.started_at === first.started_at && again.value.student_arrival.status === "late", JSON.stringify(again));
    check("sigue habiendo UNA sola sesión", Number((await admin.query("select count(*) from public.live_class_sessions where owner_id = $1", [A])).rows[0].count) === 1);
    r = await startLive(sa, L(2), ON_TIME);
    check("otra clase mientras hay una en curso se rechaza (P0001) y la primera sigue intacta", !r.ok && r.code === "P0001" && (await sessionRow(admin, A)).calendar_lesson_id === L(1));
    check("el registro todavía no tiene tiempos reales (se vuelcan al finalizar)", (await reg(admin, 1)).actual_started_at === null);

    // ---- Corregir la hora de inicio
    r = await correctLive(sa, new Date(Date.now() + 10 * 60000).toISOString());
    check("corregir a una hora futura se rechaza", !r.ok && r.code === "22023");
    r = await correctLive(sa, new Date(Date.now() - 30 * 3600000).toISOString());
    check("corregir a más de 24 h atrás se rechaza", !r.ok && r.code === "22023");
    const corrected = new Date(Date.now() - 20 * 60000).toISOString();
    r = await correctLive(sa, corrected);
    check("corregir el inicio: queda como corrección manual y el horario efectivo NO cambia", r.ok && r.value.start_source === "manual_correction" && new Date(r.value.started_at).toISOString() === corrected && r.value.effective_start_at === first.effective_start_at, JSON.stringify(r));
    r = await correctLive(sb, new Date().toISOString());
    check("sin clase en curso no hay nada que corregir (P0002)", !r.ok && r.code === "P0002");

    // ---- Aislamiento
    check("otra profesora no ve la clase en curso", Number((await sb.query("select count(*) from public.live_class_sessions")).rows[0].count) === 0);
    r = await finishLive(sb);
    check("otra profesora no puede finalizar la clase ajena (P0002)", !r.ok && r.code === "P0002" && !!(await sessionRow(admin, A)));

    // ---- Finalizar
    r = await finishLive(sa);
    const done = await reg(admin, 1);
    check("finalizar: devuelve la clase y los minutos reales (≈20, nunca menos de 1)", r.ok && r.value.calendar_lesson_id === L(1) && r.value.elapsed_minutes >= 19 && r.value.elapsed_minutes <= 21 && r.value.applied === true, JSON.stringify(r));
    check("finalizar: el registro recibe inicio real (el corregido), fin real y origen «corrección manual»", new Date(done.actual_started_at).toISOString() === corrected && new Date(done.actual_ended_at) > new Date(done.actual_started_at) && done.start_source === "manual_correction");
    check("finalizar: el registro recibe la puntualidad y el horario efectivo", done.student_arrival?.status === "late" && done.student_arrival?.lateMinutes === 7 && done.effective_start_at !== null && done.session_updated_at !== null);
    check("finalizar: el registro sigue en borrador (completarlo es del formulario)", done.status === "in_progress");
    check("finalizar: la sesión se cerró", !(await sessionRow(admin, A)));
    r = await finishLive(sa);
    check("finalizar dos veces: el segundo falla limpio (P0002) y el registro no cambia", !r.ok && r.code === "P0002" && new Date((await reg(admin, 1)).actual_ended_at).getTime() === new Date(done.actual_ended_at).getTime());

    // ---- Registro completado mientras tanto: no se pisa
    await startLive(sa, L(8), ON_TIME);
    await admin.query("update public.lesson_registrations set status = 'completed', actual_started_at = '2026-10-01T15:00:00Z', actual_ended_at = '2026-10-01T16:00:00Z' where calendar_lesson_id = $1", [L(8)]);
    r = await finishLive(sa);
    const kept = await reg(admin, 8);
    check("si el registro ya se completó, finalizar cierra la sesión pero NO pisa sus datos", r.ok && r.value.applied === false && new Date(kept.actual_started_at).toISOString() === "2026-10-01T15:00:00.000Z" && kept.student_arrival === null && !(await sessionRow(admin, A)), JSON.stringify(r));

    // ---- Descartar
    await startLive(sa, L(2), { status: "unknown", lateMinutes: 0, manuallyCorrected: false });
    const before = await reg(admin, 2);
    r = await discardLive(sa);
    check("descartar: borra la sesión y devuelve true", r.ok && r.value === true && !(await sessionRow(admin, A)));
    const after = await reg(admin, 2);
    check("descartar: el registro queda exactamente como estaba", after.actual_started_at === before.actual_started_at && after.student_arrival === null && after.status === "in_progress");
    r = await discardLive(sa);
    check("descartar sin clase en curso es idempotente (false)", r.ok && r.value === false);

    // ---- Dos comienzos simultáneos de clases distintas: exactamente uno gana
    const [x, y] = await Promise.all([startLive(sa, L(1), ON_TIME), startLive(sa2, L(2), ON_TIME)]);
    // L(1) tiene el registro en borrador con datos ya volcados, pero sigue en 'in_progress': comenzable.
    check("dos comienzos simultáneos de clases distintas: exactamente uno gana", [x, y].filter((q) => q.ok).length === 1 && [x, y].filter((q) => !q.ok && q.code === "P0001").length === 1, JSON.stringify([x, y]));
    check("…y queda una sola sesión", Number((await admin.query("select count(*) from public.live_class_sessions where owner_id = $1", [A])).rows[0].count) === 1);
    await discardLive(sa);
    const [p, q] = await Promise.all([startLive(sa, L(1), ON_TIME), startLive(sa2, L(1), ON_TIME)]);
    check("dos comienzos simultáneos de la MISMA clase: ambos terminan bien en la misma sesión", p.ok && q.ok && p.value.started_at === q.value.started_at, JSON.stringify([p, q]));

    // ---- Nada financiero se tocó
    const chargesAfter = Number((await admin.query("select count(*) from public.payment_charges")).rows[0].count);
    check("ninguna de estas acciones creó ni cambió cobros", chargesAfter === chargesBefore);
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
