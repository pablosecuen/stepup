// Clases consecutivas (24/11/2026) sobre Postgres REAL: la base aplica [inicio, fin) y la MISMA agenda operativa que la aplicación.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/consecutive_classes.mjs
//
// DEFECTO REPRODUCIDO: una clase 08:00–09:00 que es el ORIGEN de una reprogramación (vínculo `calendar_replacement_links` «moved» hacia otro destino) la oculta la aplicación (no ocupa), pero
// `calendar_lesson_occupies_slot` sólo conocía las excepciones de serie: la base seguía contando ese origen como ocupado y rechazaba, con el mismo texto que un choque real, cualquier clase nueva
// que lo tocara (p. ej. 08:30–10:00, que además termina justo cuando empieza otra a las 10:00).
// Cubre: consecutivas en ambos sentidos con 45/60/75/90/135 min, solapamiento mínimo real (1 min, 1 ms, 1 µs), horario liberado (cancelada, origen por excepción, origen por vínculo, reemplazada),
// lo que SÍ ocupa (destino vigente, dictada, reemplazo cancelado), paridad de la regla SQL con la de la aplicación, extensión que termina justo al inicio de otra, y dos intentos simultáneos.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { importLib } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");
const { buildCalendarViewForRange } = await importLib("calendar/occurrences.ts");
const { applyReplacementVisibility, buildCalendarReplacementLinks } = await importLib("calendar/replacement-visibility.ts");
const { isOperativeAgendaItem } = await importLib("calendar/agenda.ts");

const A = "c1000000-0000-4000-8000-000000000001";
const B = "c1000000-0000-4000-8000-000000000002";
const STU = "c5000000-0000-4000-8000-000000000001";
const TZ = "America/Argentina/Buenos_Aires";
const DAY = "2026-12-01";
const at = (hhmm, day = DAY) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return localDateTimeToInstantIso({ date: day, hour, minute, timeZone: TZ });
};
const plus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

let checks = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`);
};

const pg = await start({ port: 5930 + Math.floor(Math.random() * 60) });
const sessions = [];
try {
  if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
  const admin = pg.admin;
  await admin.query("insert into auth.users (id, email) values ($1,'a@example.test'),($2,'b@example.test')", [A, B]);
  await admin.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values ($1,$2,'Alumno QA','presencial','otro','por_clase','2026-01-01',1000)", [STU, A]);
  const sa = await pg.session(A);
  sessions.push(sa);

  let n = 0;
  const id = () => `c3000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const insertLesson = async ({ start: s, end: e, status = "scheduled", originalStart = null, key = null, recurrence = null, owner = A, freedBy = null }) => {
    const lessonId = id();
    await admin.query(
      `insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_original_start, freed_by_lesson_id)
       values ($1,$2,$3,'Alumno QA','A1','individual',$4,$5,'presencial',$6,'#FFE4D2',$7,$8,$9,$10,$11)`,
      [lessonId, owner, STU, s, e, status, recurrence !== null, recurrence, key, originalStart, freedBy],
    );
    return lessonId;
  };
  const link = (orig, repl, kind) => admin.query("insert into public.calendar_replacement_links (owner_id, original_lesson_id, replacement_lesson_id, kind) values ($1,$2,$3,$4)", [A, orig, repl, kind]);
  const clear = () => admin.query("truncate public.calendar_lessons cascade");
  const payload = (s, e, extra = {}) => ({ operation_id: crypto.randomUUID(), primary_student_id: STU, student_name: "Alumno QA", level: "A1", lesson_type: "individual", start_at: s, end_at: e, modality: "presencial", class_title: null, activity_kind: "class", notes: null, color: "#FFE4D2", participants: [{ student_id: STU, student_name: "Alumno QA", level: "A1" }], guard_overlap: true, ...extra });
  const create = async (session, s, e, extra) => {
    try {
      await session.query("select public.create_calendar_lesson($1::jsonb)", [JSON.stringify(payload(s, e, extra))]);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error.code, message: error.message, detail: error.detail };
    }
  };
  const extend = async (session, lessonId, s, e, newEnd) => {
    try {
      await session.query("select public.extend_calendar_lesson_duration($1::jsonb)", [JSON.stringify({ lesson_id: lessonId, expected_start_at: s, expected_end_at: e, new_end_at: newEnd })]);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error.code, message: error.message };
    }
  };
  const count = async () => Number((await admin.query("select count(*) from public.calendar_lessons")).rows[0].count);

  // ---- 1) Consecutivas en ambos sentidos, 45/60/75/90/135 ----
  for (const existingMinutes of [45, 60, 75, 90, 135]) {
    await clear();
    const s = at("10:00");
    const e = plus(s, existingMinutes);
    await insertLesson({ start: s, end: e });
    for (const newMinutes of [45, 60, 75, 90, 135]) {
      const before = await create(sa, plus(s, -newMinutes), s);
      const after = await create(sa, e, plus(e, newMinutes));
      check(`existente ${existingMinutes} min: nueva de ${newMinutes} min justo ANTES`, before.ok, before.message);
      check(`existente ${existingMinutes} min: nueva de ${newMinutes} min justo DESPUÉS`, after.ok, after.message);
      await admin.query("delete from public.calendar_lessons where id not in (select id from public.calendar_lessons order by created_at limit 1)");
    }
  }

  // ---- 2) Solapamiento real mínimo ----
  await clear();
  const base = await insertLesson({ start: at("10:00"), end: at("11:00") });
  let r = await create(sa, plus(at("11:00"), -1), plus(at("11:00"), 44));
  check("1 minuto de solapamiento al final: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, plus(at("10:00"), -44), plus(at("10:00"), 1));
  check("1 minuto de solapamiento al inicio: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, new Date(Date.parse(at("11:00")) - 1).toISOString(), new Date(Date.parse(at("11:00")) + 3_600_000).toISOString());
  check("1 ms de solapamiento: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, "2026-12-01T13:59:59.999999Z", "2026-12-01T15:00:00Z");
  check("1 µs de solapamiento (precisión de la base): rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, at("11:00"), plus(at("11:00"), 60));
  check("0 de solapamiento (se tocan): permitida", r.ok, r.message);
  r = await create(sa, at("10:00"), at("11:00"));
  check("mismo horario exacto: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, at("10:15"), at("10:45"));
  check("contenida: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  r = await create(sa, at("09:00"), at("12:00"));
  check("que contiene: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  // El mensaje y el detalle identifican la actividad y sus límites exactos.
  const detail = JSON.parse((await create(sa, at("10:30"), at("11:30"))).detail);
  check("el rechazo informa la clase y sus límites exactos", Date.parse(detail.start) === Date.parse(at("10:00")) && Date.parse(detail.end) === Date.parse(at("11:00")) && detail.name === "Alumno QA", JSON.stringify(detail));
  // Otra cuenta no interfiere.
  r = await create(await pg.session(B), at("10:00"), at("11:00"));
  sessions.push();
  check("otra cuenta no ve ni choca con la clase de esta", r.ok || r.code !== "TF002", JSON.stringify(r));
  await clear();

  // ---- 3) Horario liberado: la base y la aplicación coinciden en TODOS los estados ----
  // Cada escenario arma las filas en la base y las MISMAS en la vista de la aplicación; luego se compara si «ocupa el horario» en ambas y se intenta reservar encima.
  const scenarios = [];
  const rangeStart = new Date(at("00:00", "2026-11-30"));
  const rangeEnd = new Date(at("00:00", "2026-12-07"));
  const dest = at("16:00", "2026-12-04");
  const scenario = (name, expectOccupies, build) => scenarios.push({ name, expectOccupies, build });
  scenario("programada", true, async () => ({ lesson: await insertLesson({ start: at("08:00"), end: at("09:00") }) }));
  scenario("cancelada", false, async () => ({ lesson: await insertLesson({ start: at("08:00"), end: at("09:00"), status: "cancelled" }) }));
  scenario("dictada", true, async () => ({ lesson: await insertLesson({ start: at("08:00"), end: at("09:00"), status: "completed" }) }));
  scenario("reprogramada SIN origen (clase suelta reprogramada)", false, async () => ({ lesson: await insertLesson({ start: at("08:00"), end: at("09:00"), status: "rescheduled" }) }));
  scenario("destino vigente de una reprogramación de serie", true, async () => ({ lesson: await insertLesson({ start: at("08:00"), end: at("09:00"), status: "rescheduled", originalStart: "2026-12-23T11:00:00Z" }) }));
  scenario("origen liberado: vínculo «moved» hacia otro destino (EL CASO REPRODUCIDO)", false, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "rescheduled", originalStart: "2026-12-23T11:00:00Z" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "rescheduled", originalStart: "2026-12-30T11:00:00Z" });
    await link(origin, target, "moved");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "moved" }], extra: [target] };
  });
  scenario("origen liberado: vínculo «moved» aunque el destino esté cancelado", false, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "scheduled" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "cancelled" });
    await link(origin, target, "moved");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "moved" }], extra: [target] };
  });
  scenario("origen reemplazado: vínculo «replaced» con reemplazo VIGENTE", false, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "scheduled" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "scheduled" });
    await link(origin, target, "replaced");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "replaced" }], extra: [target] };
  });
  scenario("origen con vínculo «replaced» pero reemplazo CANCELADO: sigue ocupando", true, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "scheduled" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "cancelled" });
    await link(origin, target, "replaced");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "replaced" }], extra: [target] };
  });
  scenario("origen con vínculo «replaced» y reemplazo «reprogramada sin origen»: sigue ocupando", true, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "scheduled" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "rescheduled" });
    await link(origin, target, "replaced");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "replaced" }], extra: [target] };
  });
  scenario("dictada con vínculo «moved»: evidencia histórica, sigue ocupando", true, async () => {
    const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "completed" });
    const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "scheduled" });
    await link(origin, target, "moved");
    return { lesson: origin, links: [{ original_lesson_id: origin, replacement_lesson_id: target, kind: "moved" }], extra: [target] };
  });

  for (const sc of scenarios) {
    await clear();
    const built = await sc.build();
    const rows = (await admin.query("select * from public.calendar_lessons")).rows;
    const sqlOccupies = (await admin.query("select public.calendar_lesson_occupies_slot(c) as o from public.calendar_lessons c where c.id = $1", [built.lesson])).rows[0].o;
    // La misma situación en la aplicación.
    const lessons = rows.map((row) => ({
      id: row.id, recurrenceId: row.recurrence_id, recurrenceOccurrenceKey: row.recurrence_occurrence_key, primaryStudentId: row.primary_student_id, studentName: row.student_name, level: row.level, lessonType: row.lesson_type,
      startAt: row.start_at.toISOString(), endAt: row.end_at.toISOString(), modality: row.modality, status: row.status, recurrenceOriginalStart: row.recurrence_original_start ? new Date(row.recurrence_original_start).toISOString() : null,
      isRecurring: row.is_recurring, classTitle: null, activityKind: "class", freedByLessonId: row.freed_by_lesson_id, notes: null, participantIds: [STU],
    }));
    const links = buildCalendarReplacementLinks({
      lessons: built.links ?? [], series: [],
      replacementLessons: rows.map((row) => ({ id: row.id, status: row.status, recurrence_original_start: row.recurrence_original_start ? new Date(row.recurrence_original_start).toISOString() : null })),
    });
    const view = applyReplacementVisibility(buildCalendarViewForRange({ rangeStart, rangeEnd, rules: [], exceptions: [], lessons }), links);
    const appOccupies = isOperativeAgendaItem(view.find((item) => item.id === built.lesson));
    check(`[paridad] ${sc.name}: la aplicación ${appOccupies ? "ocupa" : "libera"}`, appOccupies === sc.expectOccupies);
    check(`[paridad] ${sc.name}: la base ${sqlOccupies ? "ocupa" : "libera"} (igual que la aplicación)`, sqlOccupies === appOccupies, `base=${sqlOccupies} aplicación=${appOccupies}`);
    // Y la reserva real en el horario del caso (08:30–10:00) se comporta igual.
    const attempt = await create(sa, at("08:30"), at("10:00"));
    check(`[reserva 08:30–10:00] ${sc.name}: ${sc.expectOccupies ? "rechazada" : "permitida"}`, sc.expectOccupies ? !attempt.ok && attempt.code === "TF002" : attempt.ok, JSON.stringify(attempt));
  }

  // Un vínculo de OTRA cuenta (aunque exista) nunca libera una clase ajena.
  {
    await clear();
    const mine = await insertLesson({ start: at("08:00"), end: at("09:00") });
    const theirs = await insertLesson({ start: dest, end: plus(dest, 60), status: "scheduled" });
    let inserted = true;
    try { await admin.query("insert into public.calendar_replacement_links (owner_id, original_lesson_id, replacement_lesson_id, kind) values ($1,$2,$3,'moved')", [B, mine, theirs]); } catch { inserted = false; }
    const occupies = (await admin.query("select public.calendar_lesson_occupies_slot(c) as o from public.calendar_lessons c where c.id = $1", [mine])).rows[0].o;
    check(`vínculo de otra cuenta (${inserted ? "insertado" : "la base ya lo impide"}): no libera una clase ajena`, occupies === true);
  }

  // ---- 4) El caso completo de la captura: 08:30–10:00 junto a otra a las 10:00 y el origen liberado de las 08:00 ----
  await clear();
  const origin = await insertLesson({ start: at("08:00"), end: at("09:00"), status: "rescheduled", originalStart: "2026-12-23T11:00:00Z" });
  const target = await insertLesson({ start: dest, end: plus(dest, 60), status: "rescheduled", originalStart: "2026-12-30T11:00:00Z" });
  await link(origin, target, "moved");
  await insertLesson({ start: at("10:00"), end: at("11:00"), recurrence: null }); // la clase de las 10:00 (materializada)
  r = await create(sa, at("08:30"), plus(at("08:30"), 90));
  check("CASO REPRODUCIDO: 08:30–10:00 con el origen liberado de las 08:00 y otra clase a las 10:00", r.ok, JSON.stringify(r));
  const persisted = (await admin.query("select to_char(start_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') s, to_char(end_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') e from public.calendar_lessons where owner_id=$1 order by start_at", [A])).rows.map((x) => `${x.s}-${x.e}`);
  check("quedaron las clases esperadas (la creada persiste y no toca a las demás)", persisted.join(",") === "08:00-09:00,08:30-10:00,10:00-11:00,16:00-17:00", persisted.join(","));
  await admin.query("delete from public.calendar_lessons where start_at = $1", [at("08:30")]);
  r = await create(sa, at("08:30"), plus(at("08:30"), 105));
  check("105 min (invade 15 min la de las 10:00): rechazada y se informa cuál", !r.ok && r.code === "TF002" && Date.parse(JSON.parse(r.detail).start) === Date.parse(at("10:00")), JSON.stringify(r));

  // ---- 5) Extensión que termina justo al inicio de otra ----
  await clear();
  const e1 = await insertLesson({ start: at("09:00"), end: at("09:45") });
  await insertLesson({ start: at("10:00"), end: at("11:00") });
  r = await extend(sa, e1, at("09:00"), at("09:45"), at("10:00"));
  check("extender +15 hasta terminar justo cuando empieza otra: permitida", r.ok, JSON.stringify(r));
  r = await extend(sa, e1, at("09:00"), at("10:00"), plus(at("10:00"), 1));
  check("un minuto más: rechazada", !r.ok && r.code === "TF002", JSON.stringify(r));
  await clear();
  const e2 = await insertLesson({ start: at("09:00"), end: at("09:45") });
  const o2 = await insertLesson({ start: at("10:00"), end: at("11:00"), status: "rescheduled", originalStart: "2026-12-23T11:00:00Z" });
  const t2 = await insertLesson({ start: dest, end: plus(dest, 60), status: "rescheduled", originalStart: "2026-12-30T11:00:00Z" });
  await link(o2, t2, "moved");
  r = await extend(sa, e2, at("09:00"), at("09:45"), at("10:30"));
  check("extender sobre un origen liberado por vínculo: permitida (no vuelve a ocupar lo liberado)", r.ok, JSON.stringify(r));

  // ---- 6) Dos intentos simultáneos por el mismo horario: uno solo gana ----
  await clear();
  const s2 = await pg.session(A);
  const s3 = await pg.session(A);
  sessions.push(s2, s3);
  const results = await Promise.all([create(s2, at("14:00"), at("15:00")), create(s3, at("14:30"), at("15:30"))]);
  check("dos reservas superpuestas a la vez: exactamente una se guarda", results.filter((x) => x.ok).length === 1 && results.filter((x) => !x.ok && x.code === "TF002").length === 1, JSON.stringify(results));
  check("y queda una sola clase", (await count()) === 1);
  await clear();
  const consecutive = await Promise.all([create(s2, at("14:00"), at("15:00")), create(s3, at("15:00"), at("16:00"))]);
  check("dos reservas CONSECUTIVAS a la vez: las dos se guardan", consecutive.every((x) => x.ok) && (await count()) === 2, JSON.stringify(consecutive));
  // Un reintento con la misma clave de operación no duplica ni choca consigo mismo.
  const operationId = crypto.randomUUID();
  const first = await create(sa, at("17:00"), at("18:00"), { operation_id: operationId });
  const retry = await create(sa, at("17:00"), at("18:00"), { operation_id: operationId });
  check("reintento con la misma clave: una sola clase", first.ok && retry.ok && (await count()) === 3, JSON.stringify({ first, retry }));

  console.log(`\n${checks - failures.length}/${checks} comprobaciones correctas`);
  if (failures.length) {
    console.log("\nFALLAS:");
    failures.forEach((f) => console.log(" - " + f));
  }
} finally {
  await Promise.all(sessions.map((client) => client.end().catch(() => {})));
  await pg.stop();
}
process.exit(failures.length ? 1 : 0);
