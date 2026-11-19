// «Extender duración» de una clase y fecha de finalización de la serie: Postgres REAL aislado (binarios de embedded-postgres, fuera del repo), datos SINTÉTICOS, nunca Production.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/extend_duration_series_end.cjs
//
// Extensión: +15/+30/+60, terminar justo al inicio de otra, solapamiento (con quién), neighbors que NO ocupan (cancelada, origen liberado), reprogramada que SÍ ocupa, ocurrencia virtual
// materializada una sola vez, reintento (una modificación), conflicto entre dispositivos, huella de agenda, dictada/cancelada, otra dueña, tope de duración, cobros intactos y carrera real entre
// una extensión y una clase nueva en dos conexiones.
// Finalización: lo inclusivo, cierre de todos los tramos del linaje (incluido un cambio programado), cancelación SÓLO de lo posterior sin registro ni cobro, rechazo completo ante registro/cobro,
// restauración únicamente de lo que canceló el límite (nunca una cancelación manual), herencia por una sucesora, aislamiento entre cuentas, fallo intermedio con reversión y «editar futuras» + límite atómico.
const { start } = require("./load.cjs");

const A = "e1000000-0000-0000-0000-000000000001";
const B = "e1000000-0000-0000-0000-000000000002";
const STU_A = "e1100000-0000-0000-0000-000000000001";
const STU_B = "e1100000-0000-0000-0000-000000000002";
const TZ = "America/Argentina/Buenos_Aires";
const uid = (kind, n) => `e1${kind}00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const LES = (n) => uid("3", n);
const RULE = (n) => uid("2", n);

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function call(session, fn, payload) {
  try {
    const { rows } = await session.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(payload)]);
    return { ok: true, value: rows[0].r };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message), detail: error.detail };
  }
}

const WEEK = (weekday, hour) => JSON.stringify([{ weekIndex: 0, sessions: [{ weekday, hour, minute: 0, durationMinutes: 60 }] }]);

async function reset(admin) {
  await admin.query("truncate public.recurrence_rules, public.students, public.calendar_lessons cascade");
  await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
  await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await admin.query(
    `insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
     ($1, $3, 'E1 A', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000), ($2, $4, 'E1 B', 'presencial', 'otro', 'por_clase', '2026-01-01', 10000)`,
    [STU_A, STU_B, A, B]
  );
}

async function rule(admin, n, owner, student, { start, end = null, status = "active", supersedes = null, effective = null, hour = 10 }) {
  await admin.query(
    `insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, end_date, status, supersedes_recurrence_id, effective_from_date, activity_kind)
     values ($1, $2, $3, 'weekly', 1, $4::jsonb, 'presencial', $5, $6, $7, $8, $9, $10, 'class')`,
    [RULE(n), owner, student, WEEK(4, hour), TZ, start, end, status, supersedes ? RULE(supersedes) : null, effective]
  );
  await admin.query("insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values ($1, $2, $3)", [owner, RULE(n), student]);
}

async function lesson(admin, n, owner, student, startAt, endAt, status, { recurrence = null, key = null, originalStart = undefined, title = null } = {}) {
  await admin.query(
    `insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_original_start, class_title, activity_kind)
     values ($1, $2, $3, $11, 'B1', 'individual', $4::timestamptz, $5::timestamptz, 'presencial', $6, '#FCE4D2', $7::boolean, $8, $9, $10, $12, 'class')`,
    [LES(n), owner, student, startAt, endAt, status, recurrence !== null, recurrence ? RULE(recurrence) : null, key, originalStart === undefined ? (recurrence ? startAt : null) : originalStart, `Alumno ${n}`, title]
  );
  await admin.query("insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level) values ($1, $2, $3, $4, 'B1')", [owner, LES(n), student, `Alumno ${n}`]);
}

const lessonRow = async (admin, n) => (await admin.query("select id, status, start_at, end_at, cancelled_by_series_limit as flag from public.calendar_lessons where id = $1", [LES(n)])).rows[0];
const endIso = async (admin, n) => (await lessonRow(admin, n)).end_at.toISOString();
const extendPayload = (n, startIso, endIso, newEndIso, extra = {}) => ({ lesson_id: LES(n), expected_start_at: startIso, expected_end_at: endIso, new_end_at: newEndIso, ...extra });
const T = (hhmm, day = "2026-12-03") => `${day}T${hhmm}:00.000Z`;

async function main() {
  const pg = await start({ port: 5787 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    for (const fn of ["extend_calendar_lesson_duration", "set_recurrence_series_end", "edit_recurrence_future_with_end"]) {
      check(`existe ${fn}`, (await admin.query("select to_regprocedure($1) as f", [`public.${fn}(jsonb)`])).rows[0].f !== null);
      const acl = (await admin.query("select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth", [`public.${fn}(jsonb)`])).rows[0];
      check(`${fn}: sólo la usuaria autenticada la ejecuta (no anon)`, acl.auth === true && acl.anon === false);
    }

    // ======================= EXTENDER DURACIÓN =======================
    await reset(admin);
    const sa = await pg.session(A);
    const sb = await pg.session(B);

    await lesson(admin, 1, A, STU_A, T("10:00"), T("11:00"), "scheduled"); // T1
    await lesson(admin, 2, A, STU_A, T("11:15"), T("12:00"), "scheduled"); // N1: vecina a 15 minutos
    let r = await call(sa, "extend_calendar_lesson_duration", extendPayload(1, T("10:00"), T("11:00"), T("11:15")));
    check("+15 min con hueco de 15: termina exactamente cuando empieza la siguiente (no invade)", r.ok && r.value.already_applied === false && (await endIso(admin, 1)) === T("11:15"), JSON.stringify(r));
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(1, T("10:00"), T("11:15"), T("11:45")));
    check("+30 min más: invade la clase siguiente → se rechaza (TF002) con la clase que choca", !r.ok && r.code === "TF002" && JSON.parse(r.detail).name === "Alumno 2", JSON.stringify(r));
    check("…y la clase no cambió", (await endIso(admin, 1)) === T("11:15"));
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(1, T("10:00"), T("11:00"), T("11:15")));
    check("reintento (doble clic o respuesta perdida): una sola modificación, ya aplicada", r.ok && r.value.already_applied === true && (await endIso(admin, 1)) === T("11:15"), JSON.stringify(r));
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(1, T("10:00"), T("11:00"), T("11:30")));
    check("otro dispositivo ya la cambió (el fin que vio no es el actual): se pide actualizar (TF001), no se sobrescribe", !r.ok && r.code === "TF001" && (await endIso(admin, 1)) === T("11:15"), JSON.stringify(r));

    // Vecinas que NO ocupan: cancelada, origen liberado de una reprogramación. Una reprogramada (destino) SÍ ocupa.
    const D4 = "2026-12-04";
    await lesson(admin, 10, A, STU_A, T("10:00", D4), T("11:00", D4), "scheduled"); // T2
    await lesson(admin, 11, A, STU_A, T("11:00", D4), T("12:00", D4), "cancelled"); // cancelada
    await lesson(admin, 12, A, STU_A, T("11:00", D4), T("12:00", D4), "rescheduled", { originalStart: null }); // origen liberado de una clase suelta
    await lesson(admin, 13, A, STU_A, T("12:00", D4), T("13:00", D4), "rescheduled", { recurrence: null, originalStart: T("09:00", D4) }); // destino de una reprogramación
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(10, T("10:00", D4), T("11:00", D4), T("12:00", D4)));
    check("+60 min sobre una cancelada y un origen liberado: se permite (no ocupan) y termina justo al inicio de la reprogramada", r.ok && (await endIso(admin, 10)) === T("12:00", D4), JSON.stringify(r));
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(10, T("10:00", D4), T("12:00", D4), T("12:15", D4), { max_duration_minutes: 240 }));
    check("invadir la clase reprogramada (destino): se rechaza", !r.ok && r.code === "TF002", JSON.stringify(r));

    // Clase dictada / cancelada / de otra cuenta / tope de duración / pasos inválidos.
    const D5 = "2026-12-05";
    await lesson(admin, 20, A, STU_A, T("10:00", D5), T("11:00", D5), "completed");
    await lesson(admin, 21, A, STU_A, T("12:00", D5), T("13:00", D5), "cancelled");
    await lesson(admin, 22, B, STU_B, T("10:00", D5), T("11:00", D5), "scheduled");
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(20, T("10:00", D5), T("11:00", D5), T("11:15", D5)));
    check("clase dictada: no se extiende (TF001)", !r.ok && r.code === "TF001");
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(21, T("12:00", D5), T("13:00", D5), T("13:15", D5)));
    check("clase cancelada: no se extiende (TF001)", !r.ok && r.code === "TF001");
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(22, T("10:00", D5), T("11:00", D5), T("11:15", D5)));
    check("clase de OTRA cuenta: no existe para quien llama (P0002) y no cambia", !r.ok && r.code === "P0002" && (await endIso(admin, 22)) === T("11:00", D5));
    r = await call(sb, "extend_calendar_lesson_duration", extendPayload(22, T("10:00", D5), T("11:00", D5), T("11:15", D5)));
    check("la dueña sí puede extender la suya", r.ok);
    await lesson(admin, 23, A, STU_A, T("14:00", D5), T("15:00", D5), "scheduled");
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(23, T("14:00", D5), T("15:00", D5), T("15:30", D5), { max_duration_minutes: 90 }));
    check("dentro del tope de duración (90): se permite", r.ok);
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(23, T("14:00", D5), T("15:30", D5), T("16:00", D5), { max_duration_minutes: 90 }));
    check("más allá del tope de duración: se rechaza (22023)", !r.ok && r.code === "22023" && (await endIso(admin, 23)) === T("15:30", D5));
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(23, T("14:00", D5), T("15:30", D5), T("15:30", D5)));
    check("un fin que no es posterior: se rechaza (22023)", !r.ok && r.code === "22023");

    // Cobros y registros intactos.
    await lesson(admin, 30, A, STU_A, T("10:00", "2026-12-06"), T("11:00", "2026-12-06"), "scheduled");
    await admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period, calendar_lesson_id) values ($1, $2, $3, 'mensual', 12345, '2026-12-06', '2026-12', $4)`, [uid("5", 1), A, STU_A, LES(30)]);
    const chargesBefore = JSON.stringify((await admin.query("select id, original_amount::text, voided_at from public.payment_charges order by id")).rows);
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(30, T("10:00", "2026-12-06"), T("11:00", "2026-12-06"), T("12:00", "2026-12-06")));
    check("una clase con cobro se extiende sin tocar el cobro (misma cantidad, mismo importe, sin cobros nuevos)", r.ok && JSON.stringify((await admin.query("select id, original_amount::text, voided_at from public.payment_charges order by id")).rows) === chargesBefore);
    await lesson(admin, 31, A, STU_A, T("10:00", "2026-12-07"), T("11:00", "2026-12-07"), "scheduled");
    await admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status) values ($1, $2, $3, 'class', true, now(), 'completed')`, [uid("4", 1), A, LES(31)]);
    r = await call(sa, "extend_calendar_lesson_duration", extendPayload(31, T("10:00", "2026-12-07"), T("11:00", "2026-12-07"), T("11:15", "2026-12-07")));
    check("una clase con registro finalizado no se extiende (TF001)", !r.ok && r.code === "TF001");

    // Ocurrencia virtual: se materializa UNA sola vez; reintento no duplica.
    await rule(admin, 1, A, STU_A, { start: "2026-12-07", hour: 10 });
    const virtualStart = "2026-12-11T13:00:00.000Z"; // viernes 10:00 hora de Buenos Aires
    const virtualEnd = "2026-12-11T14:00:00.000Z";
    const key = `${RULE(1)}:w0:c0:d4:t1000:s0`;
    const base = { primary_student_id: STU_A, student_name: "Alumno V", level: "B1", lesson_type: "individual", start_at: virtualStart, end_at: virtualEnd, modality: "presencial", color: "#FCE4D2", recurrence_index: null, class_title: null, activity_kind: "class", participants: [{ student_id: STU_A, student_name: "Alumno V", level: "B1" }] };
    const stamp = (await sa.query("select public.calendar_agenda_stamp() as s")).rows[0].s;
    const virtualPayload = { recurrence_id: RULE(1), occurrence_key: key, base, expected_start_at: virtualStart, expected_end_at: virtualEnd, new_end_at: "2026-12-11T14:30:00.000Z", agenda_stamp: stamp };
    r = await call(sa, "extend_calendar_lesson_duration", { ...virtualPayload, agenda_stamp: "x".repeat(32) });
    check("la agenda cambió entre la validación y la escritura (huella distinta): se pide revalidar (TF003) y NO se materializa nada", !r.ok && r.code === "TF003" && (await admin.query("select count(*)::int n from public.calendar_lessons where recurrence_id = $1", [RULE(1)])).rows[0].n === 0, JSON.stringify(r));
    r = await call(sa, "extend_calendar_lesson_duration", virtualPayload);
    const count = async () => (await admin.query("select count(*)::int n from public.calendar_lessons where recurrence_id = $1 and recurrence_occurrence_key = $2", [RULE(1), key])).rows[0].n;
    check("ocurrencia virtual +30: se materializa con su identidad de serie y queda con el fin nuevo", r.ok && r.value.materialized === true && (await count()) === 1, JSON.stringify(r));
    const mat = (await admin.query("select end_at, recurrence_id, recurrence_occurrence_key, status from public.calendar_lessons where recurrence_id = $1 and recurrence_occurrence_key = $2", [RULE(1), key])).rows[0];
    check("…conserva inicio, serie, clave y estado programada", mat.end_at.toISOString() === "2026-12-11T14:30:00.000Z" && mat.status === "scheduled");
    r = await call(sa, "extend_calendar_lesson_duration", virtualPayload);
    check("reintento de la ocurrencia virtual: una sola clase, ya aplicada (sin duplicar)", r.ok && r.value.already_applied === true && (await count()) === 1, JSON.stringify(r));
    await admin.query("insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type) values ($1, $2, 'otra', 'cancelled')", [A, RULE(1)]);
    const key2 = `${RULE(1)}:w1:c0:d4:t1000:s0`;
    await admin.query("insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type) values ($1, $2, $3, 'cancelled')", [A, RULE(1), key2]);
    r = await call(sa, "extend_calendar_lesson_duration", { ...virtualPayload, occurrence_key: key2, base: { ...base, start_at: "2026-12-18T13:00:00.000Z", end_at: "2026-12-18T14:00:00.000Z" }, expected_start_at: "2026-12-18T13:00:00.000Z", expected_end_at: "2026-12-18T14:00:00.000Z", new_end_at: "2026-12-18T14:15:00.000Z", agenda_stamp: undefined });
    check("ocurrencia virtual que otro dispositivo ya canceló: se pide actualizar (TF001), sin crear clase", !r.ok && r.code === "TF001" && (await admin.query("select count(*)::int n from public.calendar_lessons where recurrence_occurrence_key = $1", [key2])).rows[0].n === 0, JSON.stringify(r));

    // ---- Carrera real: una extensión y una clase nueva en el MISMO horario, en dos conexiones.
    const newLessonPayload = (opId, startIso, endIso) => ({ operation_id: opId, primary_student_id: STU_A, student_name: "Alumno N", level: "B1", lesson_type: "individual", start_at: startIso, end_at: endIso, modality: "presencial", color: "#FCE4D2", activity_kind: "class", participants: [{ student_id: STU_A, student_name: "Alumno N", level: "B1" }], guard_overlap: true });
    let bothWon = 0;
    let neitherWon = 0;
    let overlapsLeft = 0;
    for (let round = 0; round < 8; round += 1) {
      const day = `2027-01-${String(10 + round).padStart(2, "0")}`;
      await lesson(admin, 100 + round, A, STU_A, T("10:00", day), T("11:00", day), "scheduled");
      const s1 = await pg.session(A);
      const s2 = await pg.session(A);
      const [ext, created] = await Promise.all([
        call(s1, "extend_calendar_lesson_duration", extendPayload(100 + round, T("10:00", day), T("11:00", day), T("11:30", day))),
        call(s2, "create_calendar_lesson", newLessonPayload(`e1900000-0000-0000-0000-${String(1000 + round).padStart(12, "0")}`, T("11:00", day), T("12:00", day))),
      ]);
      await s1.end();
      await s2.end();
      if (ext.ok && created.ok) bothWon += 1;
      if (!ext.ok && !created.ok) neitherWon += 1;
      const overlapping = (await admin.query(
        `select count(*)::int n from public.calendar_lessons a join public.calendar_lessons b on a.id < b.id and a.owner_id = b.owner_id and a.start_at < b.end_at and a.end_at > b.start_at
         where a.owner_id = $1 and a.start_at::date = $2::date and a.status = 'scheduled' and b.status = 'scheduled'`, [A, day])).rows[0].n;
      overlapsLeft += overlapping;
    }
    check("carrera extensión ↔ clase nueva (8 rondas con dos conexiones): nunca ganan las dos, ninguna ronda deja clases superpuestas", bothWon === 0 && overlapsLeft === 0, `ambas=${bothWon} superpuestas=${overlapsLeft}`);
    check("…y siempre gana una de las dos (no se pierden las dos operaciones)", neitherWon === 0, `ninguna=${neitherWon}`);

    // create_calendar_lesson con guard_overlap
    const opId = "e1900000-0000-0000-0000-000000009001";
    await lesson(admin, 140, A, STU_A, T("10:00", "2027-02-01"), T("11:00", "2027-02-01"), "scheduled");
    r = await call(sa, "create_calendar_lesson", newLessonPayload(opId, T("10:30", "2027-02-01"), T("11:30", "2027-02-01")));
    check("clase nueva sobre otra, con la guarda: se rechaza dentro de la transacción (TF002)", !r.ok && r.code === "TF002", JSON.stringify(r));
    r = await call(sa, "create_calendar_lesson", { ...newLessonPayload(opId, T("10:30", "2027-02-01"), T("11:30", "2027-02-01")), guard_overlap: false });
    check("sin guarda («Guardar igual» elegido a propósito): se crea como antes", r.ok, JSON.stringify(r));
    r = await call(sa, "create_calendar_lesson", newLessonPayload(opId, T("10:30", "2027-02-01"), T("11:30", "2027-02-01")));
    check("reintento de la MISMA operación con la guarda: devuelve la clase ya creada (no choca consigo misma)", r.ok, JSON.stringify(r));
    check("…y quedó una sola clase de esa operación", (await admin.query("select count(*)::int n from public.calendar_lessons where operation_id = $1", [opId])).rows[0].n === 1);
    r = await call(sa, "create_calendar_lesson", newLessonPayload("e1900000-0000-0000-0000-000000009002", T("11:00", "2027-02-01"), T("12:00", "2027-02-01")));
    check("una clase que empieza justo cuando termina otra (la clase de 10:30–11:30 la tapa)… se rechaza", !r.ok && r.code === "TF002");
    r = await call(sa, "create_calendar_lesson", newLessonPayload("e1900000-0000-0000-0000-000000009003", T("12:00", "2027-02-01"), T("13:00", "2027-02-01")));
    check("una clase que empieza justo al terminar otra: se crea (back-to-back)", r.ok, JSON.stringify(r));
    await sa.end();
    await sb.end();

    // ======================= FECHA DE FINALIZACIÓN =======================
    await reset(admin);
    // Linaje: R1 (cortada el 22/11) → R2 (vigente desde 23/11) → R3 (cambio programado desde 21/12). Otra serie de la misma dueña y una ajena.
    await rule(admin, 1, A, STU_A, { start: "2026-09-07", end: "2026-11-22", hour: 10 });
    await rule(admin, 2, A, STU_A, { start: "2026-11-23", supersedes: 1, effective: "2026-11-23", hour: 11 });
    await rule(admin, 3, A, STU_A, { start: "2026-12-21", supersedes: 2, effective: "2026-12-21", hour: 12 });
    await rule(admin, 9, A, STU_A, { start: "2026-09-07", hour: 15 });
    await rule(admin, 8, B, STU_B, { start: "2026-09-07", hour: 15 });
    const noon = (day) => `${day}T12:00:00.000Z`;
    const plus1 = (day) => `${day}T13:00:00.000Z`;
    await lesson(admin, 201, A, STU_A, noon("2026-10-09"), plus1("2026-10-09"), "completed", { recurrence: 1, key: "k-past" });
    await lesson(admin, 202, A, STU_A, noon("2026-11-27"), plus1("2026-11-27"), "scheduled", { recurrence: 2, key: "k-a" }); // La
    await lesson(admin, 203, A, STU_A, noon("2026-12-04"), plus1("2026-12-04"), "scheduled", { recurrence: 2, key: "k-b" }); // Lb (día del límite en algunas pruebas)
    await lesson(admin, 204, A, STU_A, noon("2026-12-11"), plus1("2026-12-11"), "scheduled", { recurrence: 2, key: "k-c" }); // Lc: con registro
    await lesson(admin, 205, A, STU_A, noon("2026-12-25"), plus1("2026-12-25"), "scheduled", { recurrence: 3, key: "k-d" }); // Ld: del cambio programado
    await lesson(admin, 206, A, STU_A, noon("2026-12-15"), plus1("2026-12-15"), "rescheduled", { recurrence: 2, key: null, originalStart: noon("2026-12-02") }); // Le: reprogramada que cruza el límite
    await lesson(admin, 207, A, STU_A, noon("2026-12-18"), plus1("2026-12-18"), "cancelled", { recurrence: 2, key: "k-m" }); // Lm: cancelada a mano
    await lesson(admin, 210, A, STU_A, "2026-12-11T02:30:00.000Z", "2026-12-11T03:30:00.000Z", "scheduled", { recurrence: 2, key: "k-e" }); // 23:30 del 10/12 hora de la cuenta: el día del límite todavía pertenece a la serie
    await lesson(admin, 208, A, STU_A, noon("2026-12-30"), plus1("2026-12-30"), "scheduled", { recurrence: 9, key: "k-other" });
    await lesson(admin, 209, B, STU_B, noon("2026-12-30"), plus1("2026-12-30"), "scheduled", { recurrence: 8, key: "k-foreign" });
    await admin.query(`insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status) values ($1, $2, $3, 'class', true, now(), 'in_progress')`, [uid("4", 2), A, LES(204)]);
    await admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period, calendar_lesson_id) values ($1, $2, $3, 'mensual', 9999, '2026-12-11', '2026-12', $4)`, [uid("5", 2), A, STU_A, LES(204)]);

    const sA = await pg.session(A);
    const sB = await pg.session(B);
    const setEnd = (session, head, end, extra = {}) => call(session, "set_recurrence_series_end", { head_id: RULE(head), end_date: end, min_date: "2026-11-23", timezone: TZ, ...extra });
    const lessonStates = async () => JSON.stringify((await admin.query("select id, status, cancelled_by_series_limit f from public.calendar_lessons order by id")).rows);
    const rulesStates = async () => JSON.stringify((await admin.query("select id, status, end_date::text e, series_end_date::text s from public.recurrence_rules order by id")).rows);
    const history = async () => JSON.stringify((await admin.query("select (select count(*) from public.lesson_registrations)::int r, (select count(*) from public.payment_charges)::int c, (select sum(original_amount) from public.payment_charges)::text amt, (select count(*) from public.calendar_lessons)::int l, (select count(*) from public.calendar_lesson_participants)::int p")).rows[0]);
    const histBefore = await history();

    // 1) Una clase posterior con registro y cobro: se rechaza TODA la operación y no cambia nada.
    const snap0 = (await lessonStates()) + (await rulesStates());
    r = await setEnd(sA, 2, "2026-12-10");
    check("una clase posterior al límite con registro o cobro: se rechaza (TF005) con la fecha concreta", !r.ok && r.code === "TF005" && /11\/12\/2026/.test(r.message), JSON.stringify(r));
    check("…y no queda NADA a medias (ni límite, ni cancelaciones)", (await lessonStates()) + (await rulesStates()) === snap0);

    // 2) Sin esa clase: se cancela sólo lo posterior (incluida la reprogramada que cruza y el cambio programado); todo el linaje recibe el límite.
    await admin.query("delete from public.lesson_registrations where id = $1", [uid("4", 2)]);
    await admin.query("delete from public.payment_charges where id = $1", [uid("5", 2)]);
    const histBefore2 = await history();
    r = await setEnd(sA, 2, "2026-12-10");
    check("fecha de finalización 10/12: se cancelan las 3 clases posteriores (11/12, la reprogramada del 15/12 y la del cambio programado del 25/12)", r.ok && r.value.cancelled === 3 && r.value.restored === 0, JSON.stringify(r));
    let st = Object.fromEntries((await admin.query("select id, status, cancelled_by_series_limit f from public.calendar_lessons")).rows.map((x) => [x.id, x]));
    check("las anteriores o iguales al límite siguen vigentes (27/11 y 04/12) y la dictada también", st[LES(202)].status === "scheduled" && st[LES(203)].status === "scheduled" && st[LES(201)].status === "completed");
    check("la fecha es INCLUSIVA y civil: la clase de las 23:30 del 10/12 (02:30Z del 11/12) sigue en la serie", st[LES(210)].status === "scheduled" && st[LES(210)].f === false);
    check("las posteriores quedan canceladas y marcadas como canceladas por el límite", [204, 205, 206].every((n) => st[LES(n)].status === "cancelled" && st[LES(n)].f === true));
    check("la cancelada a mano NO se marca como del límite", st[LES(207)].status === "cancelled" && st[LES(207)].f === false);
    check("otra serie de la misma dueña y la serie de otra dueña no se tocan", st[LES(208)].status === "scheduled" && st[LES(209)].status === "scheduled");
    const lineage = (await admin.query("select id, series_end_date::text s from public.recurrence_rules order by id")).rows;
    check("el límite queda en TODO el linaje (tramo anterior, vigente y cambio programado), no en las series ajenas", lineage.filter((x) => [RULE(1), RULE(2), RULE(3)].includes(x.id)).every((x) => x.s === "2026-12-10") && lineage.filter((x) => [RULE(8), RULE(9)].includes(x.id)).every((x) => x.s === null));
    check("el fin propio de los tramos (el corte del tramo anterior) no se reescribe", (await admin.query("select end_date::text e from public.recurrence_rules where id = $1", [RULE(1)])).rows[0].e === "2026-11-22");
    const histAfter = await history();
    check("historial intacto: registros, cobros, importes, clases y participantes (misma cantidad y mismo importe)", histAfter === histBefore2 && JSON.parse(histBefore).c === 1 && JSON.parse(histAfter).c === 0 ? true : histAfter === histBefore2, `${histBefore2} → ${histAfter}`);

    // 3) Repetir no cambia nada (idempotente).
    const snap1 = (await lessonStates()) + (await rulesStates());
    r = await setEnd(sA, 2, "2026-12-10");
    check("repetir la misma fecha: sin cambios ni duplicados", r.ok && r.value.cancelled === 0 && r.value.restored === 0 && r.value.rules === 0 && (await lessonStates()) + (await rulesStates()) === snap1, JSON.stringify(r));

    // 4) Extender el límite: sólo se restauran las que canceló el límite y ya quedan dentro (la reprogramada vuelve como reprogramada).
    r = await setEnd(sA, 2, "2026-12-16", { check_expected: true, expected_end: "2026-12-10" });
    st = Object.fromEntries((await admin.query("select id, status, cancelled_by_series_limit f from public.calendar_lessons")).rows.map((x) => [x.id, x]));
    check("extender al 16/12: vuelven la del 11/12 y la reprogramada del 15/12 (2 restauradas); la del 25/12 sigue cancelada", r.ok && r.value.restored === 2 && st[LES(204)].status === "scheduled" && st[LES(206)].status === "rescheduled" && st[LES(205)].status === "cancelled" && st[LES(205)].f === true, JSON.stringify(r));
    check("la cancelada a mano NO se resucita al extender el límite", st[LES(207)].status === "cancelled" && st[LES(207)].f === false);

    // 5) Quitar el límite: vuelve lo que canceló el límite; nunca lo cancelado a mano; sin duplicados.
    r = await setEnd(sA, 2, null, { check_expected: true, expected_end: "2026-12-16" });
    st = Object.fromEntries((await admin.query("select id, status, cancelled_by_series_limit f from public.calendar_lessons")).rows.map((x) => [x.id, x]));
    check("quitar el límite: vuelve la del 25/12 (1 restaurada), la cancelada a mano sigue cancelada", r.ok && r.value.restored === 1 && st[LES(205)].status === "scheduled" && st[LES(207)].status === "cancelled", JSON.stringify(r));
    check("…el linaje queda sin límite y no hay clases duplicadas (misma cantidad de filas que al empezar)", (await admin.query("select count(*)::int n from public.recurrence_rules where series_end_date is not null")).rows[0].n === 0 && JSON.parse(await history()).l === JSON.parse(histBefore2).l);

    // 6) Cancelar a mano, restaurar a mano y volver a cancelar: el límite no la restaura jamás.
    r = await setEnd(sA, 2, "2026-12-03");
    check("límite 03/12: la del 04/12 queda cancelada por el límite", r.ok && (await lessonRow(admin, 203)).flag === true && (await lessonRow(admin, 203)).status === "cancelled");
    await admin.query("update public.calendar_lessons set status = 'scheduled' where id = $1", [LES(203)]);
    check("restaurada a mano: ya no figura como cancelada por el límite", (await lessonRow(admin, 203)).flag === false);
    await admin.query("update public.calendar_lessons set status = 'cancelled' where id = $1", [LES(203)]);
    r = await setEnd(sA, 2, null);
    check("cancelada a mano después: quitar el límite NO la resucita", r.ok && (await lessonRow(admin, 203)).status === "cancelled" && (await lessonRow(admin, 202)).status === "scheduled");
    await admin.query("update public.calendar_lessons set status = 'scheduled' where id = $1", [LES(203)]);

    // 7) Validaciones.
    r = await setEnd(sA, 2, "2026-11-20");
    check("fecha anterior al inicio del tramo que se edita: se rechaza (22023)", !r.ok && r.code === "22023");
    r = await setEnd(sA, 2, "2026-12-20", { check_expected: true, expected_end: "2026-01-01" });
    check("otro dispositivo cambió la serie (el límite que vio no es el actual): se pide actualizar (TF001) sin tocar nada", !r.ok && r.code === "TF001");
    r = await setEnd(sB, 2, "2026-12-20");
    check("serie de OTRA cuenta: no existe para quien llama (P0002) y no cambia", !r.ok && r.code === "P0002" && (await rulesStates()).includes('"s":"2026-12-20"') === false);

    // 8) Una sucesora creada después hereda el límite (ningún «Editar futuras» posterior lo pierde).
    r = await setEnd(sA, 2, "2027-03-31");
    await rule(admin, 4, A, STU_A, { start: "2027-01-04", supersedes: 3, effective: "2027-01-04", hour: 9 });
    check("una sucesora nueva hereda la fecha de finalización de la serie", (await admin.query("select series_end_date::text s from public.recurrence_rules where id = $1", [RULE(4)])).rows[0].s === "2027-03-31");
    r = await setEnd(sA, 4, null);
    check("quitar el límite desde la vigente lo quita de todo el linaje (R1…R4)", r.ok && (await admin.query("select count(*)::int n from public.recurrence_rules where series_end_date is not null")).rows[0].n === 0);

    // 9) El fin propio de la serie (el de la creación) pasa a ser el de la serie sólo si el tramo no tiene sucesora.
    await rule(admin, 5, A, STU_A, { start: "2026-09-07", end: "2026-12-31", hour: 8 });
    r = await call(sA, "set_recurrence_series_end", { head_id: RULE(5), end_date: "2027-02-01", min_date: "2026-09-07", timezone: TZ });
    const r5 = (await admin.query("select end_date::text e, series_end_date::text s, least(end_date, series_end_date)::text eff from public.recurrence_rules where id = $1", [RULE(5)])).rows[0];
    check("serie con fin propio: se puede EXTENDER más allá (el fin propio se limpia, rige la fecha de la serie)", r.ok && r5.e === null && r5.s === "2027-02-01" && r5.eff === "2027-02-01", JSON.stringify(r5));
    r = await call(sA, "set_recurrence_series_end", { head_id: RULE(1), end_date: "2026-12-01", min_date: "2026-09-07", timezone: TZ });
    check("un tramo con sucesora conserva su corte (nunca se alarga hasta pisar a su sucesora)", r.ok && (await admin.query("select end_date::text e from public.recurrence_rules where id = $1", [RULE(1)])).rows[0].e === "2026-11-22");
    await call(sA, "set_recurrence_series_end", { head_id: RULE(1), end_date: null, min_date: null, timezone: TZ });

    // 10) Fallo intermedio REAL: un disparador rompe la cancelación de clases con el límite ya escrito → todo se revierte.
    await admin.query(`create function public.zz_fail_cancel() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado' using errcode = 'XX000'; end $$`);
    await admin.query("create trigger zz_fail_cancel before update on public.calendar_lessons for each row execute function public.zz_fail_cancel()");
    const snap2 = (await lessonStates()) + (await rulesStates());
    r = await setEnd(sA, 2, "2026-12-03");
    check("fallo real al cancelar las clases: la operación falla", !r.ok && r.code === "XX000", JSON.stringify(r));
    check("…y el límite escrito dentro de la transacción se REVIERTE (nada a medias)", (await lessonStates()) + (await rulesStates()) === snap2);
    await admin.query("drop trigger zz_fail_cancel on public.calendar_lessons");
    await admin.query("drop function public.zz_fail_cancel()");

    // 11) «Editar futuras» + límite en UNA transacción.
    const splitPayload = (successorId, effective) => ({
      original_recurrence_id: RULE(2), effective_date: effective,
      original_patch: { status: "active", end_date: "2027-01-03" },
      successor_id: successorId, successor_start_date: effective, successor_end_date: null,
      rule_type: "weekly", cycle_length_weeks: 1, weeks: JSON.parse(WEEK(3, 17)), modality: null, class_title: null, activity_kind: null,
      participant_ids: [STU_A], primary_student_id: STU_A, excluded_occurrence_keys: [],
    });
    const SUCC_BAD = uid("2", 51);
    const SUCC_OK = uid("2", 52);
    const rulesBefore = (await admin.query("select count(*)::int n from public.recurrence_rules")).rows[0].n;
    r = await call(sA, "edit_recurrence_future_with_end", { split: splitPayload(SUCC_BAD, "2027-01-04"), end_rule_ids: [], end: { end_date: "2027-01-01", min_date: "2027-01-04", timezone: TZ }, check: { head_id: RULE(2), expected_end: null } });
    check("«Editar futuras» con un límite inválido: falla y NO se crea la sucesora (corte y límite van juntos)", !r.ok && r.code === "22023" && (await admin.query("select count(*)::int n from public.recurrence_rules")).rows[0].n === rulesBefore && (await admin.query("select end_date::text e from public.recurrence_rules where id = $1", [RULE(2)])).rows[0].e === null, JSON.stringify(r));
    r = await call(sA, "edit_recurrence_future_with_end", { split: splitPayload(SUCC_OK, "2027-01-04"), end_rule_ids: [], end: { end_date: "2027-03-26", min_date: "2027-01-04", timezone: TZ }, check: { head_id: RULE(2), expected_end: "2030-01-01" } });
    check("la serie cambió desde otro dispositivo (el límite que vio no es el actual): se rechaza antes de cortar (TF001)", !r.ok && r.code === "TF001" && (await admin.query("select count(*)::int n from public.recurrence_rules")).rows[0].n === rulesBefore);
    r = await call(sA, "edit_recurrence_future_with_end", { split: splitPayload(SUCC_OK, "2027-01-04"), end_rule_ids: [], end: { end_date: "2027-03-26", min_date: "2027-01-04", timezone: TZ }, check: { head_id: RULE(2), expected_end: null } });
    const succ = (await admin.query("select supersedes_recurrence_id s, series_end_date::text e, end_date::text own from public.recurrence_rules where id = $1", [SUCC_OK])).rows[0];
    check("corte + límite: la sucesora existe y lleva la fecha de finalización; el tramo cortado también", r.ok && r.value.head_id === SUCC_OK && succ.s === RULE(2) && succ.e === "2027-03-26" && (await admin.query("select series_end_date::text s from public.recurrence_rules where id = $1", [RULE(2)])).rows[0].s === "2027-03-26", JSON.stringify(r));
    r = await call(sA, "edit_recurrence_future_with_end", { split: splitPayload(SUCC_OK, "2027-01-04"), end_rule_ids: [], end: { end_date: "2027-03-26", min_date: "2027-01-04", timezone: TZ }, check: { head_id: RULE(2), expected_end: null } });
    check("reintento del mismo corte: devuelve la misma sucesora, sin duplicar tramos", r.ok && (await admin.query("select count(*)::int n from public.recurrence_rules where supersedes_recurrence_id = $1", [RULE(2)])).rows[0].n === 2, JSON.stringify(r));

    // 12) Aislamiento entre cuentas y privilegios.
    check("las series y clases de la otra cuenta quedaron como estaban", (await lessonRow(admin, 209)).status === "scheduled" && (await admin.query("select series_end_date::text s from public.recurrence_rules where id = $1", [RULE(8)])).rows[0].s === null);
    const anon = await pg.session(null, "anon");
    r = await call(anon, "set_recurrence_series_end", { head_id: RULE(2), end_date: null });
    check("sin sesión (anon) no puede ejecutar el cambio de límite", !r.ok && r.code === "42501", JSON.stringify(r));
    r = await call(anon, "extend_calendar_lesson_duration", extendPayload(1, T("10:00"), T("11:00"), T("11:15")));
    check("sin sesión (anon) no puede extender una clase", !r.ok && r.code === "42501", JSON.stringify(r));
    await anon.end();
    await sA.end();
    await sB.end();
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
