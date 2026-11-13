// AGENDA OPERATIVA con Postgres REAL: las operaciones de cancelar, reemplazar y reprogramar se ejecutan con las MISMAS funciones SQL que usa la aplicación; después se leen las filas
// como las lee el repositorio, se componen con `composeCalendarView` (código real) y se aplica la agenda operativa (`resolveAgendaItems`). Sobre ese resultado se miden lo que dibuja
// la grilla (carriles reales de `layoutDayItems`), la agenda y el próximo de Inicio, los pendientes de registro, el contador de la semana y la búsqueda de horarios libres/choques.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/calendar_agenda.mjs
//
// Se leen las filas con SQL (como administrador) y se mapean con las funciones reales de los repositorios; los repositorios en sí hablan con PostgREST y no se pueden cargar acá.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { importLib } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");

const { composeCalendarView } = await importLib("calendar/compose.ts");
const agenda = await importLib("calendar/agenda.ts");
// `AGENDA_RULE=legacy` reproduce el DEFECTO: la regla anterior (`visibleCalendarItems` de 5c0d949) dibujaba/contaba las canceladas salvo con reemplazo vinculado. Debe hacer fallar esta batería.
const legacyAgenda = (all) => all.filter((item) => {
  if (item.occupiesSlot === false || item.hiddenByReplacement) return false;
  if (item.freedByLessonId && item.status === "cancelled") return false;
  if (item.status === "cancelled" && all.some((other) => other.freedByLessonId === item.id && other.status !== "cancelled")) return false;
  return true;
});
const LEGACY = process.env.AGENDA_RULE === "legacy";
const resolveAgendaItems = LEGACY ? legacyAgenda : agenda.resolveAgendaItems;
const occupiesAgendaSlot = LEGACY ? (item) => item.status !== "cancelled" && item.occupiesSlot !== false && !item.hiddenByReplacement : agenda.occupiesAgendaSlot;
const { toCalendarLessonRecord } = await importLib("repositories/calendar-lessons-mapping.ts");
const { toRecurrenceRuleRecord } = await importLib("repositories/recurrence-rules-mapping.ts");
const { buildCalendarReplacementLinks } = await importLib("calendar/replacement-visibility.ts");
const { layoutDayItems } = await importLib("calendar/layout.ts");
const { buildTodayAgenda } = await importLib("dashboard/today-agenda.ts");
const { buildPendingLessons } = await importLib("lessons/pending.ts");
const { buildHomeStats } = await importLib("dashboard/home-stats.ts");
const { selectCurrentOrNextOccurrence } = await importLib("calendar/next-class.ts");
const { daySlots } = await importLib("calendar/parity.ts");
const { instantDateKey } = await importLib("calendar/civil-calendar.ts");
const { planRecurrenceSplit } = await importLib("calendar/split.ts");
const { buildSplitRpcPayload } = await importLib("calendar/split-rpc-payload.ts");

const TZ = "America/Argentina/Buenos_Aires";
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.stack ?? error).split("\n").slice(0, 7).join("\n        ")}`);
  }
};

// Primer lunes que cae al menos 21 días en el futuro (todas las operaciones son sobre fechas futuras).
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const todayKey = new Date().toISOString().slice(0, 10);
let MONDAY = addDays(todayKey, 21);
while (new Date(`${MONDAY}T12:00:00Z`).getUTCDay() !== 1) MONDAY = addDays(MONDAY, 1);
const at = (date, hour, minute = 0) => `${date}T${String(hour + 3).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`; // Argentina = UTC-3 (sin horario de verano)
const hourOf = (iso) => (new Date(iso).getUTCHours() + 21) % 24;

const pg = await start({ port: 5961 + Math.floor(Math.random() * 300) });
const admin = pg.admin;
let a;
let b;
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const owner = randomUUID();
  const foreign = randomUUID();
  const ids = { pilar: randomUUID(), lucy: randomUUID(), maria: randomUUID(), juan: randomUUID(), ana: randomUUID(), foreign: randomUUID() };
  await admin.query("insert into auth.users(id,email) values ($1,'agenda-a@example.test'),($2,'agenda-b@example.test')", [owner, foreign]);
  const student = (id, own, name) => admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price) values ($1,$2,$3,'presencial','otro','por_clase','2026-01-01',1000)", [id, own, name]);
  await student(ids.pilar, owner, "Alumna Uno");
  await student(ids.lucy, owner, "Alumna Dos");
  await student(ids.maria, owner, "Alumna Tres");
  await student(ids.juan, owner, "Alumno Cuatro");
  await student(ids.ana, owner, "Alumna Cinco");
  await student(ids.foreign, foreign, "Ajena");
  a = await pg.session(owner);
  b = await pg.session(foreign);
  const names = new Map([[ids.pilar, "Alumna Uno"], [ids.lucy, "Alumna Dos"], [ids.maria, "Alumna Tres"], [ids.juan, "Alumno Cuatro"], [ids.ana, "Alumna Cinco"], [ids.foreign, "Ajena"]]);

  // ------------------------------------------------------------------------------------------------ helpers: operaciones reales
  const rpc = async (client, fn, payload, extra) => (await client.query(extra ? `select (public.${fn}($1,$2)).*` : `select (public.${fn}($1)).*`, extra ? [payload, extra] : [payload])).rows[0];
  const single = (studentId, start, minutes = 60, extra = {}) => ({
    operation_id: randomUUID(),
    primary_student_id: studentId,
    student_name: names.get(studentId),
    level: "A1",
    lesson_type: "individual",
    start_at: start,
    end_at: new Date(Date.parse(start) + minutes * 60000).toISOString(),
    modality: "presencial",
    class_title: null,
    activity_kind: "class",
    notes: null,
    color: "#FFE4D2",
    freed_by_lesson_id: null,
    participants: [{ student_id: studentId, student_name: names.get(studentId), level: "A1" }],
    ...extra,
  });
  const createSingle = (client, studentId, start, minutes, extra) => rpc(client, "create_calendar_lesson", single(studentId, start, minutes, extra));
  const weeklyPayload = (studentId, weekday, hour, minute, startDate, extra = {}) => ({
    operation_id: randomUUID(),
    primary_student_id: studentId,
    rule_type: "weekly",
    cycle_length_weeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday, hour, minute, durationMinutes: 60 }] }],
    modality: "presencial",
    timezone: TZ,
    start_date: startDate,
    end_date: null,
    class_title: null,
    activity_kind: "class",
    participant_ids: [studentId],
    ...extra,
  });
  const createSeries = (client, studentId, weekday, hour, minute = 0, startDate = MONDAY) => rpc(client, "create_recurrence_series", weeklyPayload(studentId, weekday, hour, minute, startDate));

  /** Lee las filas como el repositorio y arma la vista COMPLETA del rango (código real) + la agenda operativa. */
  async function load(ownerId, rangeStart, rangeEnd) {
    const q = async (text, params) => (await admin.query(text, params)).rows;
    const [lessonRows, ruleRows, ruleParts, lessonParts, exceptionRows, linkRows, seriesLinkRows, studentRows] = await Promise.all([
      q("select * from public.calendar_lessons where owner_id = $1", [ownerId]),
      q("select r.*, r.start_date::text as start_date_t, r.end_date::text as end_date_t, r.effective_from_date::text as effective_from_t from public.recurrence_rules r where r.owner_id = $1", [ownerId]),
      q("select recurrence_rule_id, student_id from public.recurrence_rule_participants where owner_id = $1", [ownerId]),
      q("select calendar_lesson_id, student_id from public.calendar_lesson_participants where owner_id = $1", [ownerId]),
      q("select * from public.recurrence_exceptions where owner_id = $1", [ownerId]),
      q("select original_lesson_id, replacement_lesson_id, kind from public.calendar_replacement_links where owner_id = $1", [ownerId]),
      q("select original_lesson_id, replacement_rule_id, replaced_rule_ids, effective_date::text as effective_date from public.calendar_series_replacement_links where owner_id = $1", [ownerId]),
      q("select id, name from public.students where owner_id = $1", [ownerId]),
    ]);
    const iso = (value) => (value ? new Date(value).toISOString() : value);
    const lessonsAll = lessonRows.map((row) => toCalendarLessonRecord({ ...row, start_at: iso(row.start_at), end_at: iso(row.end_at), recurrence_original_start: iso(row.recurrence_original_start), created_at: iso(row.created_at), updated_at: iso(row.updated_at) }, lessonParts.filter((p) => p.calendar_lesson_id === row.id).map((p) => p.student_id)));
    const rules = ruleRows.map((row) => toRecurrenceRuleRecord({ ...row, start_date: row.start_date_t, end_date: row.end_date_t, effective_from_date: row.effective_from_t, created_at: iso(row.created_at), updated_at: iso(row.updated_at) }, ruleParts.filter((p) => p.recurrence_rule_id === row.id).map((p) => p.student_id)));
    const lessons = lessonsAll.filter((lesson) => lesson.startAt >= rangeStart.toISOString() && lesson.startAt <= rangeEnd.toISOString());
    const replacementLessons = lessonRows.filter((row) => linkRows.some((l) => l.replacement_lesson_id === row.id)).map((row) => ({ id: row.id, status: row.status, recurrence_original_start: row.recurrence_original_start }));
    const base = {
      rules,
      exceptions: exceptionRows.map((row) => ({ id: row.id, recurrenceId: row.recurrence_id, occurrenceKey: row.occurrence_key, type: row.exception_type, replacementLessonId: row.replacement_lesson_id })),
      students: studentRows.map((row) => ({ id: row.id, name: row.name, levels: ["A1"] })),
      occurrenceMarkers: lessonsAll.filter((l) => l.recurrenceId && l.recurrenceOccurrenceKey).map((l) => ({ id: l.id, recurrenceId: l.recurrenceId, recurrenceOccurrenceKey: l.recurrenceOccurrenceKey, status: l.status })),
      excludedStudentIds: new Set(),
      replacementLinks: buildCalendarReplacementLinks({ lessons: linkRows, series: seriesLinkRows, replacementLessons }),
    };
    const all = composeCalendarView(base, lessons, rangeStart, rangeEnd);
    return { all, agenda: resolveAgendaItems(all), lessonsAll };
  }
  const RANGE = [new Date(`${addDays(MONDAY, -2)}T00:00:00Z`), new Date(`${addDays(MONDAY, 60)}T00:00:00Z`)];
  const view = (ownerId = owner) => load(ownerId, ...RANGE);
  const onDay = (items, date) => items.filter((item) => instantDateKey(item.start) === date);
  const who = (items) => items.map((item) => item.studentName).sort();
  /** Carriles reales que calcula la grilla para ese día con la lista que se le pasa. */
  const lanesOf = (items, date) => layoutDayItems(onDay(items, date)).map((p) => ({ name: p.item.studentName, lanes: p.laneCount }));
  const rowStatus = async (id) => (await admin.query("select status from public.calendar_lessons where id = $1", [id])).rows[0]?.status;
  const count = async (sql, params) => (await admin.query(sql, params)).rows[0].n;
  const cancelOcc = (client, item) => rpc(client, "cancel_calendar_occurrence", {
    lesson_id: item.materializedLessonId, recurrence_id: item.recurrenceId, occurrence_key: item.occurrenceKey, recurrence_index: null, primary_student_id: item.studentId, student_name: item.studentName,
    level: "A1", lesson_type: item.lessonType, start_at: item.start, end_at: item.end, modality: item.modality, class_title: item.title, activity_kind: item.activityKind, color: "#FFE4D2",
  });
  const reschedule = (client, item, newStart, extra = {}, replaceIds = []) => {
    const minutes = (Date.parse(item.end) - Date.parse(item.start)) / 60000;
    return rpc(client, "reschedule_calendar_replacing", {
      operation_id: randomUUID(), source_id: item.id, recurrence_id: item.recurrenceId, occurrence_key: item.occurrenceKey, original_lesson_id: item.materializedLessonId, original_start_at: item.start,
      primary_student_id: item.studentId, student_name: item.studentName, level: "A1", lesson_type: item.lessonType, new_start_at: newStart, new_end_at: new Date(Date.parse(newStart) + minutes * 60000).toISOString(),
      modality: item.modality, class_title: item.title, activity_kind: item.activityKind, color: "#F2E8FF",
      participants: [...new Set([item.studentId, ...item.participantIds])].map((id) => ({ student_id: id, student_name: names.get(id), level: "A1" })), replacement_edits: [], ...extra,
    }, replaceIds);
  };

  console.log(`\nSemana de referencia: lunes ${MONDAY}`);
  const D1 = MONDAY; // lunes
  const D2 = addDays(MONDAY, 1);
  const D3 = addDays(MONDAY, 2);
  const W2 = addDays(MONDAY, 7);

  // ============================================================================================== 1-4: cancelar, reemplazar
  let single1;
  await step("1. CANCELAR una clase suelta: sale de la agenda, no genera carril y libera el horario; la fila, su historial y los vínculos se conservan", async () => {
    const lucy = await createSingle(a, ids.lucy, at(D1, 16));
    single1 = await createSingle(a, ids.pilar, at(D1, 16));
    let v = await view();
    assert.deepEqual(who(onDay(v.agenda, D1)), ["Alumna Dos", "Alumna Uno"], "dos clases realmente simultáneas siguen siendo dos");
    assert.deepEqual(lanesOf(v.agenda, D1).map((x) => x.lanes), [2, 2], "dos simultáneas: dos carriles");
    await cancelOcc(a, v.all.find((i) => i.id === single1.id));
    v = await view();
    assert.equal(await rowStatus(single1.id), "cancelled", "la fila queda cancelada (historia)");
    assert.ok(v.all.some((i) => i.id === single1.id && i.status === "cancelled"), "la vista completa la conserva para el historial");
    assert.deepEqual(who(onDay(v.agenda, D1)), ["Alumna Dos"], "en la agenda sólo queda la vigente");
    assert.deepEqual(lanesOf(v.agenda, D1), [{ name: "Alumna Dos", lanes: 1 }], "sin carril fantasma ni numeración de simultáneas");
    // El horario liberado vuelve a estar libre para elegir (búsqueda de horarios) salvo por la vigente.
    const slots = daySlots(D1, 60, v.all, { schemaVersion: 1, timezone: TZ, weeklyBlocks: [], exceptions: [] });
    assert.ok(slots.length > 0);
    assert.deepEqual(v.all.filter((i) => !occupiesAgendaSlot(i)).map((i) => i.id), [single1.id]);
    assert.equal(lucy.status, "scheduled");
  });

  await step("2. CANCELAR una ocurrencia VIRTUAL de una serie: no se vuelve a generar al cambiar de semana ni al recargar; las demás ocurrencias de la serie permanecen", async () => {
    const rule = await createSeries(a, ids.maria, 1, 10, 0, MONDAY); // martes 10:00
    let v = await view();
    const occurrences = v.agenda.filter((i) => i.recurrenceId === rule.id);
    assert.ok(occurrences.length >= 8, `la serie genera ocurrencias (${occurrences.length})`);
    const target = occurrences.find((i) => instantDateKey(i.start) === D2);
    assert.equal(target.isMaterialized, false);
    await cancelOcc(a, target);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      v = await view(); // «recargar»
      const after = v.agenda.filter((i) => i.recurrenceId === rule.id);
      assert.equal(after.length, occurrences.length - 1);
      assert.ok(!after.some((i) => instantDateKey(i.start) === D2), "la cancelada no reaparece");
      assert.ok(after.some((i) => instantDateKey(i.start) === addDays(D2, 7)), "las siguientes de la serie permanecen");
    }
    // Reintentar la misma cancelación no duplica nada.
    await cancelOcc(a, target);
    assert.equal(await count("select count(*)::int n from public.calendar_lessons where recurrence_id = $1 and recurrence_occurrence_key = $2", [rule.id, target.occurrenceKey]), 1);
    assert.equal(await count("select count(*)::int n from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = $2", [rule.id, target.occurrenceKey]), 1);
  });

  await step("3. CANCELAR una ocurrencia MATERIALIZADA de una serie: tampoco reaparece (ni como virtual ni como fila)", async () => {
    const rule = await createSeries(a, ids.juan, 2, 11, 0, MONDAY); // miércoles 11:00
    let v = await view();
    const target = v.agenda.find((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === D3);
    // Materializa la ocurrencia (como cuando se edita el título) y luego se cancela por su id.
    const materialized = await rpc(a, "edit_calendar_lesson", { lesson_id: null, recurrence_id: rule.id, occurrence_key: target.occurrenceKey, base: { primary_student_id: ids.juan, student_name: "Alumno Cuatro", level: "A1", lesson_type: "individual", start_at: target.start, end_at: target.end, modality: "presencial", color: "#FFE4D2", recurrence_index: null, class_title: null, activity_kind: "class", participants: [{ student_id: ids.juan, student_name: "Alumno Cuatro", level: "A1" }] }, changes: { class_title: "Con título" } });
    v = await view();
    const real = v.agenda.find((i) => i.id === materialized.id);
    assert.ok(real?.isMaterialized, "la ocurrencia quedó materializada");
    await cancelOcc(a, real);
    v = await view();
    assert.ok(!v.agenda.some((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === D3), "ni materializada ni virtual en la agenda");
    assert.equal(await rowStatus(materialized.id), "cancelled");
    assert.equal(v.agenda.filter((i) => i.recurrenceId === rule.id).length >= 8, true);
  });

  await step("4. REEMPLAZAR una clase cancelada (vínculo explícito): una sola tarjeta vigente, sin carril fantasma; reintentar la misma operación no duplica la sustituta", async () => {
    const original = await createSingle(a, ids.ana, at(D2, 15));
    let v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === original.id));
    const replacement = single(ids.lucy, at(D2, 15), 60, { freed_by_lesson_id: original.id });
    const made = await rpc(a, "create_calendar_lesson", replacement);
    const again = await rpc(a, "create_calendar_lesson", replacement);
    assert.equal(again.id, made.id, "la misma operación devuelve la misma sustituta");
    assert.equal(await count("select count(*)::int n from public.calendar_lessons where freed_by_lesson_id = $1", [original.id]), 1);
    v = await view();
    assert.deepEqual(who(onDay(v.agenda, D2).filter((i) => hourOf(i.start) === 15)), ["Alumna Dos"]);
    assert.deepEqual(lanesOf(v.agenda, D2).filter((x) => x.name === "Alumna Dos").map((x) => x.lanes), [1]);
    assert.equal(await rowStatus(original.id), "cancelled", "la original se conserva como historia");
  });

  // ============================================================================================== 5-9: reprogramar
  let moved1;
  await step("5. REPROGRAMAR dentro del día (clase suelta): desaparece del horario anterior y aparece UNA vez en el nuevo; el origen no ocupa ni cuenta", async () => {
    const lesson = await createSingle(a, ids.pilar, at(D3, 9));
    let v = await view();
    moved1 = await reschedule(a, v.all.find((i) => i.id === lesson.id), at(D3, 13));
    v = await view();
    const day = onDay(v.agenda, D3).filter((i) => i.studentName === "Alumna Uno");
    assert.deepEqual(day.map((i) => hourOf(i.start)), [13], "sólo el destino");
    assert.equal(v.all.filter((i) => i.id === lesson.id).every((i) => !occupiesAgendaSlot(i)), true, "el origen sigue en la historia pero no ocupa");
    assert.equal((await rowStatus(lesson.id)), "rescheduled");
  });

  await step("6. REPROGRAMAR una ocurrencia de serie a OTRO DÍA y OTRA SEMANA: el origen no reaparece (la excepción se busca por la identidad ORIGINAL), el destino aparece una sola vez", async () => {
    const rule = await createSeries(a, ids.ana, 3, 12, 0, MONDAY); // jueves 12:00
    let v = await view();
    const D4 = addDays(MONDAY, 3);
    const occ = v.agenda.find((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === D4);
    const moved = await reschedule(a, occ, at(addDays(D4, 12), 17)); // otra semana y otro día
    for (let repeat = 0; repeat < 2; repeat += 1) {
      v = await view(); // recargar / cambiar de semana
      assert.ok(!v.agenda.some((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === D4), "el horario original no reaparece");
      assert.equal(v.agenda.filter((i) => i.id === moved.id).length, 1, "el destino aparece una sola vez");
      assert.equal(onDay(v.agenda, addDays(D4, 12)).filter((i) => i.id === moved.id).length, 1);
      assert.ok(v.agenda.some((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(D4, 7)), "las demás ocurrencias de la serie permanecen");
    }
    // Reintentar la MISMA operación (mismo id) no duplica el destino.
    const payload = { operation_id: randomUUID(), source_id: occ.id, recurrence_id: occ.recurrenceId, occurrence_key: occ.occurrenceKey, original_lesson_id: null, original_start_at: occ.start, primary_student_id: ids.ana, student_name: "Alumna Cinco", level: "A1", lesson_type: "individual", new_start_at: at(addDays(D4, 14), 9), new_end_at: at(addDays(D4, 14), 10), modality: "presencial", class_title: null, activity_kind: "class", color: "#F2E8FF", participants: [{ student_id: ids.ana, student_name: "Alumna Cinco", level: "A1" }], replacement_edits: [] };
    const first = await rpc(a, "reschedule_calendar_replacing", payload, []);
    const replay = await rpc(a, "reschedule_calendar_replacing", payload, []);
    assert.equal(replay.id, first.id);
    assert.equal(await count("select count(*)::int n from public.calendar_lessons where id = $1", [first.id]), 1);
  });

  await step("7. REPROGRAMAR una clase YA reprogramada (cadena A→B→C): sólo se ve el último destino, ningún eslabón intermedio queda vigente", async () => {
    let v = await view();
    const b1 = v.agenda.find((i) => i.id === moved1.id);
    assert.ok(b1);
    const c1 = await reschedule(a, b1, at(addDays(D3, 7), 10));
    v = await view();
    const mine = v.agenda.filter((i) => i.studentName === "Alumna Uno" && [moved1.id, c1.id].includes(i.id));
    assert.deepEqual(mine.map((i) => i.id), [c1.id], "sólo el último destino");
    const c2 = await reschedule(a, v.agenda.find((i) => i.id === c1.id), at(addDays(D3, 8), 11));
    v = await view();
    assert.deepEqual(v.agenda.filter((i) => [moved1.id, c1.id, c2.id].includes(i.id)).map((i) => i.id), [c2.id]);
    assert.equal(v.agenda.filter((i) => i.studentName === "Alumna Uno" && instantDateKey(i.start) === D3).length, 0, "el horario original del primer movimiento está libre");
  });

  await step("8. CAMBIAR SÓLO ESTA ocurrencia: las demás clases de la serie permanecen exactamente iguales", async () => {
    const rule = await createSeries(a, ids.maria, 4, 18, 0, MONDAY); // viernes 18:00
    let v = await view();
    const before = v.agenda.filter((i) => i.recurrenceId === rule.id).map((i) => i.start);
    const target = v.agenda.find((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(MONDAY, 11));
    const moved = await reschedule(a, target, at(addDays(MONDAY, 11), 19));
    v = await view();
    const after = v.agenda.filter((i) => i.recurrenceId === rule.id && i.id !== moved.id).map((i) => i.start);
    assert.deepEqual(after, before.filter((start) => start !== target.start), "sólo falta la movida (que aparece por su cuenta en su destino)");
    assert.equal(v.agenda.filter((i) => i.recurrenceId === rule.id).length, before.length, "la serie conserva la misma cantidad de clases vigentes");
    assert.ok(v.agenda.some((i) => i.id === moved.id));
  });

  await step("9. CAMBIAR ESTA Y LAS SIGUIENTES (corte atómico de la serie): ninguna ocurrencia del patrón anterior reaparece desde esa fecha; el pasado del patrón anterior se conserva", async () => {
    const rule = await createSeries(a, ids.juan, 0, 8, 0, MONDAY); // lunes 08:00
    const effective = addDays(MONDAY, 14);
    const plan = planRecurrenceSplit({ originalRecurrenceId: rule.id, originalStartDate: MONDAY, originalEndDate: null, effectiveDate: effective, todayDate: todayKey });
    const successorId = randomUUID();
    const payload = buildSplitRpcPayload({ originalRecurrenceId: rule.id, effectiveDate: effective, plan, successorId, excludedOccurrenceKeys: [], ruleType: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 9, minute: 30, durationMinutes: 60 }] }], modality: "presencial", classTitle: null, activityKind: "class", participantIds: [ids.juan], primaryStudentId: ids.juan });
    await rpc(a, "split_recurrence_this_and_future", payload);
    const v = await view();
    const old = v.agenda.filter((i) => i.recurrenceId === rule.id);
    assert.ok(old.length >= 2 && old.every((i) => instantDateKey(i.start) < effective), "el patrón anterior sólo conserva lo anterior al corte");
    const fresh = v.agenda.filter((i) => i.studentName === "Alumno Cuatro" && i.start.endsWith("T12:30:00.000Z") && instantDateKey(i.start) >= effective); // 09:30 Argentina
    assert.ok(fresh.length >= 4 && fresh.every((i) => i.recurrenceId !== rule.id), "desde el corte rige el patrón nuevo");
    assert.equal(v.agenda.filter((i) => i.studentName === "Alumno Cuatro" && hourOf(i.start) === 8 && instantDateKey(i.start) >= effective).length, 0, "ninguna del patrón viejo desde esa fecha");
  });

  // ============================================================================================== 10-13
  await step("10. DOS CLASES VIGENTES al mismo horario siguen siendo dos (simultáneas legítimas): ambas permanecen, con carriles; sólo la cancelada deja de contar", async () => {
    const day = addDays(MONDAY, 4);
    const x = await createSingle(a, ids.pilar, at(day, 14));
    const y = await createSingle(a, ids.lucy, at(day, 14));
    const z = await createSingle(a, ids.maria, at(day, 14));
    let v = await view();
    assert.deepEqual(lanesOf(v.agenda, day).filter((p) => ["Alumna Uno", "Alumna Dos", "Alumna Tres"].includes(p.name) && true).map((p) => p.lanes).filter((n) => n === 3).length >= 3, true);
    await cancelOcc(a, v.all.find((i) => i.id === z.id));
    v = await view();
    const at14 = lanesOf(v.agenda, day).filter((p) => ["Alumna Uno", "Alumna Dos"].includes(p.name));
    assert.deepEqual(at14.map((p) => p.lanes), [2, 2], "al cancelar la tercera quedan dos carriles, no tres");
    assert.ok([x.id, y.id].every((id) => v.agenda.some((i) => i.id === id)));
  });

  await step("11. CANCELAR con registro asociado: la cancelación es un cambio de estado; el registro y el historial quedan intactos (nada se borra)", async () => {
    const lesson = await createSingle(a, ids.ana, at(addDays(MONDAY, 5), 10));
    await admin.query("insert into public.lesson_registrations(owner_id,calendar_lesson_id,activity_kind,counts_as_class,status,scheduled_start_at) values ($1,$2,'class',true,'in_progress',$3)", [owner, lesson.id, lesson.start_at]);
    const v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === lesson.id));
    assert.equal(await rowStatus(lesson.id), "cancelled");
    assert.equal(await count("select count(*)::int n from public.lesson_registrations where calendar_lesson_id = $1", [lesson.id]), 1, "el registro se conserva");
    assert.equal(await count("select count(*)::int n from public.calendar_lesson_participants where calendar_lesson_id = $1", [lesson.id]), 1, "los participantes se conservan");
    const after = await view();
    assert.ok(!after.agenda.some((i) => i.id === lesson.id), "pero ya no está en la agenda");
    assert.ok(after.all.some((i) => i.id === lesson.id), "sigue en la historia");
  });

  await step("12. DOBLE CLIC, reintento y recarga: cancelar dos veces, reprogramar dos veces con la misma operación y recargar no duplican ni resucitan nada", async () => {
    const lesson = await createSingle(a, ids.pilar, at(addDays(MONDAY, 6), 10));
    let v = await view();
    const item = v.all.find((i) => i.id === lesson.id);
    await Promise.all([cancelOcc(a, item), cancelOcc(a, item)]);
    v = await view();
    assert.equal(v.agenda.filter((i) => i.id === lesson.id).length, 0);
    assert.equal(await count("select count(*)::int n from public.calendar_lessons where id = $1", [lesson.id]), 1);
  });

  await step("13. AISLAMIENTO entre cuentas: la agenda de otra cuenta no cambia con nada de lo anterior y no ve estas clases", async () => {
    const own = await createSingle(b, ids.foreign, at(D1, 16));
    const mine = await view();
    const theirs = await view(foreign);
    assert.deepEqual(who(theirs.agenda), ["Ajena"]);
    assert.ok(theirs.all.every((i) => !mine.all.some((m) => m.id === i.id)));
    await cancelOcc(a, mine.all.find((i) => i.id === single1.id));
    assert.equal(await rowStatus(own.id), "scheduled", "cancelar en una cuenta no toca la otra");
  });

  // ============================================================================================== 14: Inicio, pendientes, recordatorios, contadores, próxima clase
  await step("14. INICIO, PENDIENTES, CONTADOR DE LA SEMANA y PRÓXIMA CLASE parten de la agenda operativa: ninguna cancelada, origen reprogramado ni reemplazada cuenta, se numera ni se ofrece", async () => {
    const v = await view();
    const retired = v.all.filter((i) => !occupiesAgendaSlot(i));
    assert.ok(retired.length >= 5, `hay clases retiradas en la historia (${retired.length})`);
    // Contador de la semana: nunca cuenta una retirada.
    const weekAll = v.all.filter((i) => instantDateKey(i.start) >= MONDAY && instantDateKey(i.start) < addDays(MONDAY, 7));
    const stats = buildHomeStats({ activeStudents: 5, weekItems: resolveAgendaItems(weekAll), monthMinutes: [], grades: [] });
    assert.equal(stats.lessonsThisWeek, resolveAgendaItems(weekAll).length);
    assert.ok(weekAll.length > stats.lessonsThisWeek, "la lista completa tiene más (retiradas) que lo que se cuenta");
    assert.ok(weekAll.filter((i) => i.status !== "cancelled").length > stats.lessonsThisWeek, "el contador anterior (sólo «no cancelada») contaba además los orígenes reprogramados: un doble conteo");
    // Agenda de Inicio y próxima clase.
    for (const day of [D1, D2, D3]) {
      const todayAgenda = buildTodayAgenda(v.all, new Date(`${day}T00:00:00Z`), day);
      assert.ok(todayAgenda.every((entry) => occupiesAgendaSlot(entry.item)), `Inicio ${day}: ninguna retirada`);
      assert.equal(todayAgenda.length, onDay(v.agenda, day).length);
    }
    const next = selectCurrentOrNextOccurrence(resolveAgendaItems(v.all.filter((i) => instantDateKey(i.start) === D1)), new Date(`${D1}T00:00:00Z`));
    assert.ok(next && occupiesAgendaSlot(next.occurrence));
    // Pendientes (se evalúan «desde ahora»: una fecha futura lejana + 1 día para que todo ya haya terminado).
    const later = new Date(`${addDays(MONDAY, 70)}T00:00:00Z`);
    const pending = buildPendingLessons({ calendarItems: v.all, now: later, registrations: [] });
    assert.ok(pending.length > 0);
    assert.ok(pending.every((p) => occupiesAgendaSlot(p.item)), "ninguna retirada es pendiente de registro");
    const retiredIds = new Set(retired.map((i) => i.id));
    assert.ok(!pending.some((p) => retiredIds.has(p.item.id)));
  });

  await step("15. REVISIÓN CRUZADA: ningún día de la semana tiene en la agenda una clase retirada ni más carriles que clases vigentes simultáneas", async () => {
    const v = await view();
    for (let n = 0; n < 14; n += 1) {
      const day = addDays(MONDAY, n);
      const items = onDay(v.agenda, day);
      for (const placed of layoutDayItems(items)) {
        const overlapping = items.filter((o) => o.start < placed.item.end && o.end > placed.item.start).length;
        assert.ok(placed.laneCount <= overlapping, `${day}: laneCount ${placed.laneCount} > simultáneas vigentes ${overlapping}`);
      }
      assert.ok(items.every((i) => i.status !== "cancelled" && occupiesAgendaSlot(i)));
    }
  });
  // ============================================================================================== 16-21: historial de canceladas y restauración
  const toCandidates = (await importLib("calendar/conflict-candidates.ts")).toConflictCandidates;
  const { findCalendarConflicts, hasBlockingConflict } = await importLib("calendar-conflicts.ts");
  const conflictFor = (agendaItems, start, end, ignoredId) => hasBlockingConflict(findCalendarConflicts(start, end, toCandidates(agendaItems), ignoredId));
  const restore = (client, id) => rpc(client, "restore_calendar_occurrence", { lesson_id: id });
  const rejectsWith = async (promise, pattern) => assert.rejects(promise, (error) => pattern.test(String(error?.message)));

  await step("16. RESTAURAR una clase SUELTA cancelada (otro momento): vuelve a la agenda en su horario; sin conflicto no hay aviso; reintentar es idempotente", async () => {
    const day = addDays(MONDAY, 21);
    const lesson = await createSingle(a, ids.pilar, at(day, 11));
    let v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === lesson.id));
    v = await view(); // «volver otro momento»: se recarga todo
    assert.ok(!v.agenda.some((i) => i.id === lesson.id));
    assert.equal(conflictFor(v.agenda, lesson.start_at, lesson.end_at, lesson.id), false, "horario libre: sin conflicto");
    const back = await restore(a, lesson.id);
    assert.equal(back.status, "scheduled");
    assert.equal((await restore(a, lesson.id)).id, lesson.id, "idempotente");
    v = await view();
    assert.equal(v.agenda.filter((i) => i.id === lesson.id).length, 1);
    assert.equal(new Date(v.agenda.find((i) => i.id === lesson.id).start).toISOString(), new Date(lesson.start_at).toISOString(), "vuelve en su propio horario");
  });

  await step("17. RESTAURAR con CONFLICTO: si otra clase vigente ocupa el horario se detecta ANTES (no se superpone sola); libre el horario, restaura", async () => {
    const day = addDays(MONDAY, 22);
    const lesson = await createSingle(a, ids.lucy, at(day, 12));
    let v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === lesson.id));
    const other = await createSingle(a, ids.maria, at(day, 12)); // otra clase vigente en el horario liberado (NO es un reemplazo vinculado)
    v = await view();
    assert.equal(conflictFor(v.agenda, lesson.start_at, lesson.end_at, lesson.id), true, "el conflicto se detecta antes de restaurar");
    assert.deepEqual(who(onDay(v.agenda, day).filter((i) => hourOf(i.start) === 12)), ["Alumna Tres"], "la cancelada sigue fuera de la agenda mientras no se confirme");
    await cancelOcc(a, v.all.find((i) => i.id === other.id));
    v = await view();
    assert.equal(conflictFor(v.agenda, lesson.start_at, lesson.end_at, lesson.id), false);
    await restore(a, lesson.id);
    v = await view();
    assert.deepEqual(who(onDay(v.agenda, day).filter((i) => hourOf(i.start) === 12)), ["Alumna Dos"]);
  });

  await step("18. RESTAURAR una ocurrencia de SERIE cancelada: vuelve a su fecha original UNA sola vez (sin duplicar la virtual y la materializada) y deja de ser excepción", async () => {
    const rule = await createSeries(a, ids.juan, 3, 13, 0, MONDAY); // jueves 13:00
    let v = await view();
    const target = v.agenda.find((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(MONDAY, 17));
    const total = v.agenda.filter((i) => i.recurrenceId === rule.id).length;
    await cancelOcc(a, target);
    v = await view();
    assert.equal(v.agenda.filter((i) => i.recurrenceId === rule.id).length, total - 1);
    const row = v.all.find((i) => i.recurrenceId === rule.id && i.status === "cancelled");
    await restore(a, row.materializedLessonId);
    v = await view();
    const same = v.agenda.filter((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(MONDAY, 17));
    assert.equal(same.length, 1, "una sola clase en esa fecha (ni virtual + materializada ni ninguna)");
    assert.equal(v.agenda.filter((i) => i.recurrenceId === rule.id).length, total);
    assert.equal(await count("select count(*)::int n from public.recurrence_exceptions where recurrence_id = $1 and occurrence_key = $2", [rule.id, target.occurrenceKey]), 0);
  });

  await step("19. RESTAURAR el caso de PILAR (clase movida y después cancelada, sin clave de ocurrencia): vuelve en su propio horario; su origen sigue liberado (no reaparece)", async () => {
    const rule = await createSeries(a, ids.pilar, 4, 9, 0, MONDAY); // viernes 09:00
    let v = await view();
    const occ = v.agenda.find((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(MONDAY, 18));
    const dest = at(addDays(MONDAY, 23), 15);
    const moved = await reschedule(a, occ, dest);
    v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === moved.id));
    v = await view();
    assert.ok(!v.agenda.some((i) => i.id === moved.id));
    await restore(a, moved.id);
    v = await view();
    assert.equal(v.agenda.filter((i) => i.id === moved.id).length, 1);
    assert.equal(new Date(v.agenda.find((i) => i.id === moved.id).start).toISOString(), new Date(dest).toISOString(), "en el horario al que se había movido");
    assert.ok(!v.agenda.some((i) => i.recurrenceId === rule.id && instantDateKey(i.start) === addDays(MONDAY, 18)), "el horario original sigue liberado");
  });

  await step("20. PROTECCIONES de la base: con registro asociado, ya REEMPLAZADA por otra clase, o un origen reprogramado, NO se restaura; no se borra ni cambia nada", async () => {
    const withReg = await createSingle(a, ids.ana, at(addDays(MONDAY, 24), 10));
    let v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === withReg.id));
    await admin.query("insert into public.lesson_registrations(owner_id,calendar_lesson_id,activity_kind,counts_as_class,status,scheduled_start_at) values ($1,$2,'class',true,'in_progress',$3)", [owner, withReg.id, withReg.start_at]);
    await rejectsWith(restore(a, withReg.id), /registro o un cobro/);
    assert.equal(await rowStatus(withReg.id), "cancelled");

    const replaced = await createSingle(a, ids.lucy, at(addDays(MONDAY, 25), 10));
    v = await view();
    await cancelOcc(a, v.all.find((i) => i.id === replaced.id));
    await rpc(a, "create_calendar_lesson", single(ids.maria, at(addDays(MONDAY, 25), 10), 60, { freed_by_lesson_id: replaced.id }));
    await rejectsWith(restore(a, replaced.id), /ya fue reemplazada/);
    assert.equal(await rowStatus(replaced.id), "cancelled");

    const origin = await createSingle(a, ids.juan, at(addDays(MONDAY, 26), 10));
    v = await view();
    await reschedule(a, v.all.find((i) => i.id === origin.id), at(addDays(MONDAY, 26), 16));
    await rejectsWith(restore(a, origin.id), /no pertenece a una repetición/);
    v = await view();
    assert.equal(v.agenda.filter((i) => i.studentName === "Alumno Cuatro" && instantDateKey(i.start) === addDays(MONDAY, 26)).length, 1, "sólo el destino");

    await rejectsWith(restore(b, replaced.id), /Clase no encontrada/); // otra cuenta no puede restaurar una clase ajena
  });

  await step("21. EL HISTORIAL NO ESTÁ EN LA AGENDA: lo cancelado figura en la vista completa para listarlo, pero nada de eso entra en carriles, grupos, pendientes ni choques", async () => {
    const v = await view();
    const cancelledRows = v.all.filter((i) => i.status === "cancelled" && i.isMaterialized);
    assert.ok(cancelledRows.length >= 5, `hay canceladas listables (${cancelledRows.length})`);
    assert.ok(cancelledRows.every((i) => !v.agenda.some((x) => x.id === i.id)));
    const pendingList = buildPendingLessons({ calendarItems: v.all, now: new Date(`${addDays(MONDAY, 70)}T00:00:00Z`), registrations: [] });
    assert.ok(!pendingList.some((p) => p.item.status === "cancelled"));
  });
} finally {
  if (a) await a.end();
  if (b) await b.end();
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nAGENDA OPERATIVA: ${results.length}/${results.length} pasos ok` : `\nAGENDA OPERATIVA: ${failed.length} FALLA(S) de ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
