// R6.1 — Batería de los tres defectos funcionales de la importación, en Postgres REAL (varias conexiones) con datos SINTÉTICOS. Nunca toca Production.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   node supabase/tests/postgres/r61_import.cjs                (batería completa)
//   node supabase/tests/postgres/r61_import.cjs --mutations    (rompe a propósito cada garantía; cada mutación debe ser detectada)
//   ONLY=chain,levels node …                                   (sólo esas secciones)
//
// Cubre: (1) dependencias dentro de la misma copia sobre una cuenta VACÍA (acuerdo → serie → clase → registro → asistencia / tarea / cobro), varias cadenas
// independientes, referencia creada en la misma copia vs. realmente faltante (y su cascada), (2) presupuesto 50/30/20 válido / inválido / parcial / repetido con
// vista previa, confirmación, respuesta perdida, reintento y deshacer, (3) niveles duplicados contra la web y dentro de la copia, más dos propietarias sin
// cruces, cuotas de R3, purga de R4, límite de 7.500 de R6, escala (sin crecimiento cuadrático), error a mitad con retroceso total y revisión desactualizada.
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");
const { generateBackup, emptyBackup, student, workUnits } = require("./r6_dataset.cjs");
const { q } = require("./r6_scenarios.cjs");

const { A, B, LIM, reset, fp, sameFp, diffFp, count, advisoryLocks, previewOf, applyOf, undoPreviewOf, undoApplyOf, timed, apiSession } = H;
const MUTATIONS = process.argv.includes("--mutations");

let failures = [];
let total = 0;
function check(name, cond, detail = "") {
  total += 1;
  const ok = Boolean(cond);
  if (!ok) failures.push(`${name}${detail ? " → " + detail : ""}`);
  if (!MUTATIONS) console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`);
}
async function fails(fn, pattern, name) {
  try {
    await fn();
    check(name, false, "no falló");
    return null;
  } catch (e) {
    check(name, pattern.test(String(e.message)) || pattern.test(String(e.code)), `${e.code} ${String(e.message).slice(0, 160)}`);
    return e;
  }
}
const rows = async (admin, sql, params = []) => (await admin.query(sql, params)).rows;

// ---------------------------------------------------------------------------------------------------------------------
// Constructores de filas del respaldo (formato móvil v2)
// ---------------------------------------------------------------------------------------------------------------------
const at = (h) => `2025-03-03T${String(h).padStart(2, "0")}:00:00.000Z`;
const rule = (id, extra) => ({ id, primaryStudentId: null, ruleType: "weekly", cycleLengthWeeks: 1, weeks: [], modality: "online", timezone: "UTC", startDate: "2025-02-03", endDate: null, status: "active", supersedesRecurrenceId: null, supersededByRecurrenceId: null, effectiveFromDate: "2025-02-03", classTitle: null, activityKind: "class", trainingBillingAgreementId: null, participantStudentIds: [], ...extra });
const lesson = (id, h, extra) => ({ id, primaryStudentId: null, studentName: "x", level: "A1", lessonType: "individual", startAt: at(h), endAt: at(h + 1), modality: "online", status: "scheduled", color: "#DDEEFF", overlapAllowed: false, notes: null, isRecurring: false, recurrenceId: null, recurrenceOccurrenceKey: null, recurrenceIndex: null, recurrenceOriginalStart: null, scheduleAdjustment: null, classTitle: null, freedByLessonId: null, activityKind: "class", participants: [], ...extra });
const reg = (id, extra) => ({ id, calendarLessonId: null, activityKind: "class", countsAsClass: true, homeworkDescription: "tarea", homeworkDueDate: "2025-03-10", billedAmount: 1000, scheduledStartAt: at(10), actualStartedAt: at(10), actualEndedAt: at(11), outcome: "clase_dictada", holidayException: false, modality: "online", scheduledEndAt: at(11), lateCancellationPolicy: null, lateCancellationPercentage: null, rescheduledFromRegistrationId: null, roster: [], attendance: [], evaluations: [], homeworkReviews: [], ...extra });
const att = (studentId) => ({ studentId, status: "presente", lateMinutes: null });
const ev = (studentId) => ({ studentId, generalGrade: 8, skillGrades: { speaking: 8 }, strengths: ["x"], areasToImprove: ["y"], individualObservation: null, individualHomeworkDescription: null, individualHomeworkDueDate: null, billedAmount: 500 });
const hw = (studentId, taskId) => ({ studentId, taskId, outcome: "realizada", reviewedAt: "2025-03-04T10:00:00.000Z" });
const charge = (id, extra) => ({ id, studentId: null, chargeType: "mensual", originalAmount: 1000, currency: "ARS", dueDate: "2025-04-10", billingPeriod: "2025-04", savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, voidedAt: null, voidReason: null, ...extra });
const pay = (id, extra) => ({ id, studentId: null, amount: 1000, currency: "ARS", method: "efectivo", paidAt: "2025-04-12", notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, source: null, ...extra });
const alloc = (id, paymentId, chargeId, studentId, amount) => ({ id, paymentId, chargeId, studentId, amount });
const agreement = (id) => ({ id, monthlyFee: 5000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null, startPeriod: "2025-01" });

/** Una cadena COMPLETA, toda dentro de la copia (nada de esto existe en la web): acuerdo → serie → clase → registro → asistencia / tarea / cobro. */
function addChain(b, p) {
  const id = (s) => `${p}_${s}`;
  b.students.push(student(id("st1"), { name: `Alumna ${p} Uno` }), student(id("st2"), { name: `Alumna ${p} Dos` }), student(id("st3"), { name: `Alumna ${p} Tres` }));
  b.trainingBillingAgreements.push(agreement(id("ta1")), agreement(id("ta2")));
  b.recurrenceRules.push(
    rule(id("rr1"), { primaryStudentId: id("st1"), trainingBillingAgreementId: id("ta1"), participantStudentIds: [id("st1"), id("st2")] }),
    rule(id("rr2"), { primaryStudentId: id("st2"), trainingBillingAgreementId: id("ta2"), participantStudentIds: [id("st2")] }),
    rule(id("rr3"), { primaryStudentId: id("st1"), supersedesRecurrenceId: id("rr1") }),
  );
  b.calendarLessons.push(
    lesson(id("cl1"), 10, { primaryStudentId: id("st1"), recurrenceId: id("rr1"), isRecurring: true, recurrenceOccurrenceKey: `${p}k1`, recurrenceIndex: 1, participants: [{ studentId: id("st1"), studentName: "x", level: "A1" }] }),
    lesson(id("cl2"), 11, { primaryStudentId: id("st1"), recurrenceId: id("rr1"), isRecurring: true, recurrenceOccurrenceKey: `${p}k2`, recurrenceIndex: 2, freedByLessonId: id("cl1") }),
    lesson(id("cl3"), 12, { primaryStudentId: id("st2"), recurrenceId: id("rr2"), isRecurring: true, recurrenceOccurrenceKey: `${p}k3`, recurrenceIndex: 1 }),
    lesson(id("cl4"), 13, { primaryStudentId: id("st3"), lessonType: "group", participants: [{ studentId: id("st1"), studentName: "x", level: "A1" }, { studentId: id("st2"), studentName: "y", level: "A1" }] }),
  );
  b.recurrenceExceptions.push({ recurrenceId: id("rr1"), occurrenceKey: `${p}ex1`, exceptionType: "excluded", replacementLessonId: id("cl4") });
  b.pedagogicalLessons.push(
    reg(id("pl1"), { calendarLessonId: id("cl1"), roster: [{ studentId: id("st1") }, { studentId: id("st2") }], attendance: [att(id("st1")), att(id("st2"))], evaluations: [ev(id("st1"))], homeworkReviews: [hw(id("st1"), `${p}task1`)] }),
    reg(id("pl2"), { calendarLessonId: id("cl3"), roster: [{ studentId: id("st2") }], attendance: [att(id("st2"))] }),
    reg(id("pl3"), { calendarLessonId: id("cl2"), rescheduledFromRegistrationId: id("pl1"), roster: [{ studentId: id("st1") }] }),
  );
  b.paymentCharges.push(charge(id("ch1"), { studentId: id("st1"), savedLessonId: id("pl1"), calendarLessonId: id("cl1") }), charge(id("ch2"), { studentId: id("st2"), calendarLessonId: id("cl3"), trainingBillingAgreementId: id("ta2") }));
  b.payments.push(pay(id("pa1"), { studentId: id("st1") }));
  b.paymentAllocations.push(alloc(id("al1"), id("pa1"), id("ch1"), id("st1"), 1000));
  b.paymentAdjustments.push({ id: id("aj1"), chargeId: id("ch1"), studentId: id("st1"), reason: "ajuste", voidedAt: null, voidReason: null });
  b.profiles[id("st1")] = { id: id("st1"), levelHistory: [{ id: id("lh1"), level: "A2", date: "2025-06-01", fromLevel: "A1", recordedAt: "2025-06-01T12:00:00.000Z", previousMilestoneAt: null, durationDays: 100, note: "n", origin: "manual" }] };
}
/** Lo que una cadena completa escribe: filas por tabla (incluidas las anidadas). */
const CHAIN_ROWS = { students: 3, training_billing_agreements: 2, student_level_history: 1, recurrence_rules: 3, recurrence_rule_participants: 3, calendar_lessons: 4, calendar_lesson_participants: 3, recurrence_exceptions: 1, lesson_registrations: 3, lesson_registration_students: 4, lesson_registration_attendance: 3, lesson_registration_evaluations: 1, lesson_registration_homework_reviews: 1, payment_charges: 2, payments: 1, payment_allocations: 1, payment_adjustments: 1 };
const chainTotal = (n = 1) => n * Object.values(CHAIN_ROWS).reduce((s, v) => s + v, 0);

const byId = (arr) => Object.fromEntries(arr.map((x) => [x.legacy_mobile_id, x]));
async function tableCounts(admin, uid) {
  const out = {};
  for (const t of Object.keys(CHAIN_ROWS)) out[t] = await count(admin, t, uid);
  return out;
}
/** Vínculos reales entre filas (por id de la copia → id de la copia) leídos de la base. */
async function links(admin, uid) {
  const r = (sql) => rows(admin, sql, [uid]);
  return {
    ruleAgreement: await r(`select r.legacy_mobile_id a, t.legacy_mobile_id b from public.recurrence_rules r left join public.training_billing_agreements t on t.id = r.training_billing_agreement_id where r.owner_id = $1 order by 1`),
    ruleSupersedes: await r(`select r.legacy_mobile_id a, s.legacy_mobile_id b from public.recurrence_rules r left join public.recurrence_rules s on s.id = r.supersedes_recurrence_id where r.owner_id = $1 order by 1`),
    lessonRule: await r(`select l.legacy_mobile_id a, r.legacy_mobile_id b from public.calendar_lessons l left join public.recurrence_rules r on r.id = l.recurrence_id where l.owner_id = $1 order by 1`),
    lessonFreed: await r(`select l.legacy_mobile_id a, f.legacy_mobile_id b from public.calendar_lessons l left join public.calendar_lessons f on f.id = l.freed_by_lesson_id where l.owner_id = $1 order by 1`),
    regLesson: await r(`select g.legacy_mobile_id a, l.legacy_mobile_id b from public.lesson_registrations g left join public.calendar_lessons l on l.id = g.calendar_lesson_id where g.owner_id = $1 order by 1`),
    regResched: await r(`select g.legacy_mobile_id a, p.legacy_mobile_id b from public.lesson_registrations g left join public.lesson_registrations p on p.id = g.rescheduled_from_registration_id where g.owner_id = $1 order by 1`),
    chargeReg: await r(`select c.legacy_mobile_id a, g.legacy_mobile_id b from public.payment_charges c left join public.lesson_registrations g on g.id = c.saved_lesson_id where c.owner_id = $1 order by 1`),
    chargeLesson: await r(`select c.legacy_mobile_id a, l.legacy_mobile_id b from public.payment_charges c left join public.calendar_lessons l on l.id = c.calendar_lesson_id where c.owner_id = $1 order by 1`),
    chargeAgreement: await r(`select c.legacy_mobile_id a, t.legacy_mobile_id b from public.payment_charges c left join public.training_billing_agreements t on t.id = c.training_billing_agreement_id where c.owner_id = $1 order by 1`),
    allocation: await r(`select a.legacy_mobile_id a, p.legacy_mobile_id || '>' || c.legacy_mobile_id b from public.payment_allocations a join public.payments p on p.id = a.payment_id join public.payment_charges c on c.id = a.charge_id where a.owner_id = $1 order by 1`),
    exceptionLesson: await r(`select r.legacy_mobile_id a, l.legacy_mobile_id b from public.recurrence_exceptions e join public.recurrence_rules r on r.id = e.recurrence_id left join public.calendar_lessons l on l.id = e.replacement_lesson_id where e.owner_id = $1 order by 1`),
    participants: await r(`select l.legacy_mobile_id a, s.legacy_mobile_id b from public.calendar_lesson_participants p join public.calendar_lessons l on l.id = p.calendar_lesson_id join public.students s on s.id = p.student_id where p.owner_id = $1 order by 1, 2`),
    attendance: await r(`select g.legacy_mobile_id a, s.legacy_mobile_id b from public.lesson_registration_attendance p join public.lesson_registrations g on g.id = p.lesson_registration_id join public.students s on s.id = p.student_id where p.owner_id = $1 order by 1, 2`),
    homework: await r(`select g.legacy_mobile_id a, s.legacy_mobile_id b from public.lesson_registration_homework_reviews p join public.lesson_registrations g on g.id = p.lesson_registration_id join public.students s on s.id = p.student_id where p.owner_id = $1 order by 1, 2`),
  };
}
const pairs = (list) => JSON.stringify(list.map((x) => `${x.a}>${x.b}`));
const expectPairs = (...p) => JSON.stringify(p.sort());
const has = (list, a, b) => list.some((x) => x.a === a && x.b === b);

async function newSession(pg, uid = A, ms = 30000) {
  return apiSession(pg, uid, ms);
}
/** Cualquier fila de la cuenta apunta SÓLO a filas de la misma cuenta (ninguna referencia cruzada entre propietarias). */
async function crossOwnerRefs(admin) {
  const r = await rows(admin, `
    select (select count(*) from public.calendar_lessons l join public.recurrence_rules x on x.id = l.recurrence_id where x.owner_id <> l.owner_id)
         + (select count(*) from public.calendar_lessons l join public.students x on x.id = l.primary_student_id where x.owner_id <> l.owner_id)
         + (select count(*) from public.lesson_registrations g join public.calendar_lessons x on x.id = g.calendar_lesson_id where x.owner_id <> g.owner_id)
         + (select count(*) from public.recurrence_rules r join public.training_billing_agreements x on x.id = r.training_billing_agreement_id where x.owner_id <> r.owner_id)
         + (select count(*) from public.payment_charges c join public.lesson_registrations x on x.id = c.saved_lesson_id where x.owner_id <> c.owner_id)
         + (select count(*) from public.payment_allocations a join public.payments x on x.id = a.payment_id where x.owner_id <> a.owner_id) as n`);
  return Number(r[0].n);
}

// ---------------------------------------------------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------------------------------------------------
async function sectionStatic(pg) {
  const admin = pg.admin;
  const dir = path.join(__dirname, "..", "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => /^20261011\d{6}_r61_/.test(f)).sort();
  const text = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/--.*$/gm, "").replace(/drop table if exists _\w+/gi, "").replace(/on commit drop/gi, "");
  check("R6.1: una migración nueva y ADITIVA (sólo CREATE OR REPLACE de funciones: ningún drop, truncate ni alter de tablas)", files.length === 1 && !/(drop|truncate)|alter\s+table/i.test(text(files[0])), files.join(","));
  const sql = fs.readFileSync(path.join(dir, files[0]), "utf8");
  check("R6.1: ningún aviso ni log con datos (raise notice / log / warning)", !/raise\s+(notice|log|warning|info|debug)/i.test(sql));
  check("R6.1: ningún mensaje de error lleva nombres de tablas, columnas ni ids", !/raise exception '[^']*(public\.|legacy_mobile_id|custom_levels|budget_distribution)/i.test(sql));
  const fns = await rows(admin, `
    select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef, coalesce(p.proconfig @> array['search_path=""'], false) as empty_path,
           has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_import_available_ids','_import_classify_recurrence_rules','_import_classify_calendar_lessons','_import_classify_lesson_registrations','_import_classify_custom_levels','_import_apply_custom_levels','_apply_singleton','_import_validate_selection')`);
  check("R6.1: las funciones nuevas o redefinidas existen (la 4-arg de series, clases y registros es una sobrecarga nueva)", fns.length >= 11, String(fns.length));
  check("R6.1: ninguna es ejecutable por la API (anon ni authenticated) y las de escritura tienen search_path vacío", fns.every((f) => !f.anon_x && !f.auth_x) && fns.filter((f) => f.prosecdef).every((f) => f.empty_path), fns.filter((f) => f.anon_x || f.auth_x || (f.prosecdef && !f.empty_path)).map((f) => f.proname).join(","));
  const pub = await rows(admin, `
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x, p.prosecdef, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) res
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('preview_backup_import','apply_backup_import','preview_undo_backup_import','apply_undo_backup_import')`);
  check("R6.1: las 4 RPC públicas conservan privilegios (authenticated sí, anon no), SECURITY DEFINER y firma (compatibles con la web desplegada)", pub.length === 4 && pub.every((r) => r.auth_x && !r.anon_x && r.prosecdef)
    && pub.find((r) => r.proname === "apply_backup_import").args === "p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb"
    && pub.find((r) => r.proname === "preview_backup_import").args === "p_payload jsonb, p_excluded_collections jsonb");
  const none = await rows(admin, `select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\\_import\\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  check("R6.1: ninguna función _import_* (internas) es ejecutable por la API", none[0].n === 0);
}

async function sectionChain(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const b = emptyBackup();
  addChain(b, "c1");
  // Una cadena rota aparte (el acuerdo de la serie NO existe en ningún lado) y una serie / clase / registro con referencia realmente faltante.
  b.students.push(student("x_st1", { name: "Alumna X Uno" }));
  b.recurrenceRules.push(rule("x_rr_noagr", { primaryStudentId: "x_st1", trainingBillingAgreementId: "x_ta_ghost" }));
  b.calendarLessons.push(lesson("x_cl_ofnoagr", 14, { primaryStudentId: "x_st1", recurrenceId: "x_rr_noagr", isRecurring: true, recurrenceOccurrenceKey: "xk1", recurrenceIndex: 1 }), lesson("x_cl_ghostrr", 15, { primaryStudentId: "x_st1", recurrenceId: "x_rr_ghost", isRecurring: true, recurrenceOccurrenceKey: "xk2", recurrenceIndex: 2 }), lesson("x_cl_nostu", 16, { primaryStudentId: "x_st_ghost" }), lesson("x_cl_nullstu", 17, { primaryStudentId: null }));
  b.pedagogicalLessons.push(reg("x_pl_ofnoagr", { calendarLessonId: "x_cl_ofnoagr", roster: [{ studentId: "x_st1" }] }), reg("x_pl_ghost", { calendarLessonId: "x_cl_ghost", roster: [{ studentId: "x_st1" }] }), reg("x_pl_ok", { calendarLessonId: null, roster: [{ studentId: "x_st1" }] }));
  b.paymentCharges.push(charge("x_ch_ofbroken", { studentId: "x_st1", billingPeriod: "2025-09", savedLessonId: "x_pl_ofnoagr" }), charge("x_ch_ok", { studentId: "x_st1", billingPeriod: "2025-10", savedLessonId: "x_pl_ok" }));
  b.payments.push(pay("x_pa_ofbroken", { studentId: "x_st1" }));
  b.paymentAllocations.push(alloc("x_al_ofbroken", "x_pa_ofbroken", "x_ch_ofbroken", "x_st1", 1000));

  const bizBefore = await fp(admin, A, { business: true });
  const p = await previewOf(s, b);
  const c = p.classification.aggregates;
  const rr = byId(c.recurrence_rules); const cl = byId(c.calendar_lessons); const lr = byId(c.lesson_registrations);
  const fin = Object.fromEntries(c.financial_components.flatMap((k) => k.members.map((m) => [m.legacy_mobile_id, k])));
  check("vista previa sobre cuenta VACÍA: la serie con un acuerdo que agrega la misma copia es importable", rr.c1_rr1.status === "insertable" && rr.c1_rr2.status === "insertable" && rr.c1_rr3.status === "insertable");
  check("vista previa: las clases de series que agrega la misma copia son importables (y las sin serie también)", ["c1_cl1", "c1_cl2", "c1_cl3", "c1_cl4"].every((k) => cl[k].status === "insertable"));
  check("vista previa: los registros de clases que agrega la misma copia son importables", ["c1_pl1", "c1_pl2", "c1_pl3"].every((k) => lr[k].status === "insertable"));
  check("vista previa: los cobros de registros, clases y acuerdos de la misma copia son importables (componente completa)", ["c1_ch1", "c1_ch2", "c1_pa1", "c1_al1", "c1_aj1"].every((k) => fin[k].status === "insertable"));
  check("referencia realmente faltante: la serie con un acuerdo inexistente se omite con su motivo", rr.x_rr_noagr.status === "omitted_broken_reference" && /acuerdo de entrenamiento/.test(rr.x_rr_noagr.reason));
  check("cascada: la clase de una serie omitida se omite («serie que no se importó»)", cl.x_cl_ofnoagr.status === "omitted_broken_reference" && /serie que no se import/.test(cl.x_cl_ofnoagr.reason));
  check("referencia realmente faltante: clase de una serie inexistente, de un alumno inexistente o SIN alumno se omiten", ["x_cl_ghostrr", "x_cl_nostu", "x_cl_nullstu"].every((k) => cl[k].status === "omitted_broken_reference"), JSON.stringify(["x_cl_ghostrr", "x_cl_nostu", "x_cl_nullstu"].map((k) => cl[k].status)));
  check("cascada: el registro de una clase omitida o inexistente se omite (clase que no se importó)", lr.x_pl_ofnoagr.status === "omitted_broken_reference" && lr.x_pl_ghost.status === "omitted_broken_reference" && /clase de calendario/.test(lr.x_pl_ofnoagr.reason) && lr.x_pl_ok.status === "insertable");
  check("cascada: el cobro de un registro omitido arrastra toda su componente (nunca un cobro suelto)", ["x_ch_ofbroken", "x_pa_ofbroken", "x_al_ofbroken"].every((k) => fin[k].status === "omitted") && fin.x_ch_ok.status === "insertable");
  check("vista previa: no se escribió nada de negocio (sólo la vista previa)", sameFp(bizBefore, await fp(admin, A, { business: true })) && (await count(admin, "students", A)) === 0);

  const a = await applyOf(s, p.preview_id);
  const counts = await tableCounts(admin, A);
  const expected = { ...CHAIN_ROWS };
  expected.students += 1; expected.recurrence_rules += 0; expected.lesson_registrations += 1; expected.lesson_registration_students += 1; expected.payment_charges += 1;
  expected.recurrence_rule_participants += 0;
  check("confirmación: se escribieron exactamente las filas de la cadena (y sólo las importables de la rota)", JSON.stringify(counts) === JSON.stringify(expected), JSON.stringify(counts) + " vs " + JSON.stringify(expected));
  const L = await links(admin, A);
  check("ids canónicos: cada serie quedó unida a su acuerdo", has(L.ruleAgreement, "c1_rr1", "c1_ta1") && has(L.ruleAgreement, "c1_rr2", "c1_ta2") && has(L.ruleAgreement, "c1_rr3", null) && L.ruleAgreement.length === 3, pairs(L.ruleAgreement));
  check("ids canónicos: la serie que reemplaza a otra apunta a la serie importada", has(L.ruleSupersedes, "c1_rr3", "c1_rr1") && L.ruleSupersedes.filter((x) => x.b).length === 1, pairs(L.ruleSupersedes));
  check("ids canónicos: cada clase quedó unida a su serie; la «liberada por» apunta a la clase importada", has(L.lessonRule, "c1_cl1", "c1_rr1") && has(L.lessonRule, "c1_cl2", "c1_rr1") && has(L.lessonRule, "c1_cl3", "c1_rr2") && has(L.lessonRule, "c1_cl4", null) && has(L.lessonFreed, "c1_cl2", "c1_cl1"), pairs(L.lessonRule) + pairs(L.lessonFreed));
  check("ids canónicos: cada registro quedó unido a su clase y el reprogramado al registro original", has(L.regLesson, "c1_pl1", "c1_cl1") && has(L.regLesson, "c1_pl2", "c1_cl3") && has(L.regLesson, "c1_pl3", "c1_cl2") && has(L.regResched, "c1_pl3", "c1_pl1"), pairs(L.regLesson) + pairs(L.regResched));
  check("ids canónicos: cada cobro quedó unido a su registro, su clase y su acuerdo; la asignación une pago y cobro", has(L.chargeReg, "c1_ch1", "c1_pl1") && has(L.chargeLesson, "c1_ch1", "c1_cl1") && has(L.chargeLesson, "c1_ch2", "c1_cl3") && has(L.chargeAgreement, "c1_ch2", "c1_ta2") && has(L.allocation, "c1_al1", "c1_pa1>c1_ch1"), pairs(L.chargeReg));
  check("ids canónicos: la excepción de la serie apunta a la clase de reemplazo importada", has(L.exceptionLesson, "c1_rr1", "c1_cl4"));
  check("participantes, asistencias y tareas: quedan con el alumno correcto de la misma copia", has(L.participants, "c1_cl4", "c1_st1") && has(L.participants, "c1_cl4", "c1_st2") && has(L.attendance, "c1_pl1", "c1_st2") && has(L.homework, "c1_pl1", "c1_st1") && L.attendance.length === 3 && L.homework.length === 1);
  const none = await rows(admin, `select count(*)::int n from public.recurrence_rules where owner_id = $1 and legacy_mobile_id = 'x_rr_noagr' union all select count(*)::int from public.calendar_lessons where owner_id = $1 and legacy_mobile_id like 'x\\_cl\\_%' union all select count(*)::int from public.payment_charges where owner_id = $1 and legacy_mobile_id = 'x_ch_ofbroken'`, [A]);
  check("lo omitido no se escribe (serie, clases y cobro de la cadena rota)", none.every((r) => r.n === 0));
  check("sin referencias huérfanas ni cruzadas entre cuentas", (await crossOwnerRefs(admin)) === 0 && a.summary.total_rows_written === Object.values(counts).reduce((x, y) => x + y, 0), String(a.summary.total_rows_written));

  // Respuesta perdida y reintento: la MISMA corrida, cero escrituras.
  const after = await fp(admin, A);
  const r2 = await applyOf(s, p.preview_id);
  check("respuesta perdida y reintento: devuelve la misma corrida marcada como repetida y no escribe nada", r2.import_run_id === a.import_run_id && r2.summary.replayed === true && sameFp(after, await fp(admin, A)));
  // Importar la MISMA copia otra vez: todo lo que ya está se conserva, no se duplica nada.
  const p2 = await previewOf(s, b);
  const c2 = p2.classification.aggregates;
  check("segunda vista previa de la misma copia: lo ya importado figura como «se conserva» (nada nuevo para agregar)", c2.recurrence_rules.filter((x) => x.status === "insertable").length === 0 && c2.calendar_lessons.filter((x) => x.status === "insertable").length === 0 && c2.lesson_registrations.filter((x) => x.status === "insertable").length === 0 && c2.financial_components.filter((x) => x.status === "insertable").length === 0);
  const a2 = await applyOf(s, p2.preview_id);
  check("segunda confirmación: no duplica ninguna fila", JSON.stringify(await tableCounts(admin, A)) === JSON.stringify(counts) && a2.summary.total_rows_written >= 0);

  // Deshacer completo de la primera corrida: cero residuos.
  const u = await undoPreviewOf(s, a.import_run_id);
  check("deshacer: la vista previa del deshacer dice que es seguro", u.is_safe === true, JSON.stringify(u.unsafe_rows).slice(0, 200));
  const ur = await undoApplyOf(s, u.undo_preview_id);
  check("deshacer completo: la cuenta queda sin ninguna fila de negocio importada (cero residuos)", Object.values(await tableCounts(admin, A)).every((n) => n === 0) && ur.summary.deleted_rows === a.summary.total_rows_written, JSON.stringify(ur.summary));
  const ur2 = await undoApplyOf(s, u.undo_preview_id);
  check("deshacer repetido (respuesta perdida): mismo resultado marcado como repetido", ur2.summary.replayed === true);
  check("sin locks pendientes", (await advisoryLocks(admin)) === 0);
  await s.end();
}

async function sectionIndependentChains(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const b = emptyBackup();
  for (const p of ["a1", "a2", "a3", "a4"]) addChain(b, p);
  const p = await previewOf(s, b);
  const c = p.classification.aggregates;
  check("varias cadenas independientes: todo lo de las 4 cadenas es importable", [c.recurrence_rules, c.calendar_lessons, c.lesson_registrations].every((arr) => arr.every((x) => x.status === "insertable")) && c.financial_components.every((x) => x.status === "insertable") && c.financial_components.length >= 4);
  const a = await applyOf(s, p.preview_id);
  const counts = await tableCounts(admin, A);
  const e4 = Object.fromEntries(Object.entries(CHAIN_ROWS).map(([k, v]) => [k, v * 4]));
  check("varias cadenas independientes: se escribe exactamente 4 veces lo de una cadena", JSON.stringify(counts) === JSON.stringify(e4), JSON.stringify(counts));
  const L = await links(admin, A);
  const sameChain = (list) => list.every((x) => !x.b || x.a.split("_")[0] === x.b.split("_")[0]);
  check("varias cadenas independientes: ningún vínculo cruza de una cadena a otra", Object.values(L).every(sameChain), Object.entries(L).filter(([, v]) => !sameChain(v)).map(([k]) => k).join(","));
  check("varias cadenas independientes: cada cadena tiene sus propios vínculos completos", ["a1", "a2", "a3", "a4"].every((k) => has(L.regLesson, `${k}_pl1`, `${k}_cl1`) && has(L.lessonRule, `${k}_cl3`, `${k}_rr2`) && has(L.chargeReg, `${k}_ch1`, `${k}_pl1`) && has(L.ruleAgreement, `${k}_rr1`, `${k}_ta1`)));
  const u = await undoPreviewOf(s, a.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("varias cadenas: deshacer deja la cuenta vacía", Object.values(await tableCounts(admin, A)).every((n) => n === 0));
  await s.end();
}

async function sectionMixedWithWeb(pg) {
  // La clasificación considera tanto lo que YA existe en la web como lo que la importación va a crear: se mezclan ambas fuentes en la misma cadena.
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const first = emptyBackup();
  addChain(first, "w1");
  const a1 = await applyOf(s, (await previewOf(s, first)).preview_id);
  // Segunda copia: una serie NUEVA con el acuerdo YA existente en la web, una clase nueva en una serie YA existente, un registro nuevo de una clase NUEVA de la misma copia
  // y un cobro nuevo del registro ya existente en la web.
  const second = emptyBackup();
  second.students.push(student("w1_st1", { name: "Alumna w1 Uno" }));
  second.recurrenceRules.push(rule("w2_rr_newwebagr", { primaryStudentId: "w1_st1", trainingBillingAgreementId: "w1_ta1" }));
  second.calendarLessons.push(lesson("w2_cl_webrule", 18, { primaryStudentId: "w1_st1", recurrenceId: "w1_rr1", isRecurring: true, recurrenceOccurrenceKey: "w2k1", recurrenceIndex: 5 }), lesson("w2_cl_newrule", 19, { primaryStudentId: "w1_st1", recurrenceId: "w2_rr_newwebagr", isRecurring: true, recurrenceOccurrenceKey: "w2k2", recurrenceIndex: 6 }));
  second.pedagogicalLessons.push(reg("w2_pl_new", { calendarLessonId: "w2_cl_newrule", roster: [{ studentId: "w1_st1" }] }), reg("w2_pl_webless", { calendarLessonId: "w1_cl4", roster: [{ studentId: "w1_st1" }] }));
  second.paymentCharges.push(charge("w2_ch", { studentId: "w1_st1", billingPeriod: "2025-11", savedLessonId: "w1_pl2", calendarLessonId: "w2_cl_newrule" }));
  const p = await previewOf(s, second);
  const c = p.classification.aggregates;
  const rr = byId(c.recurrence_rules); const cl = byId(c.calendar_lessons); const lr = byId(c.lesson_registrations);
  check("mezcla web + copia: serie nueva con acuerdo de la web, clase con serie de la web o de la copia, registro con clase de la web o de la copia", rr.w2_rr_newwebagr.status === "insertable" && cl.w2_cl_webrule.status === "insertable" && cl.w2_cl_newrule.status === "insertable" && lr.w2_pl_new.status === "insertable" && lr.w2_pl_webless.status === "insertable");
  check("mezcla web + copia: el cobro que une un registro de la web con una clase de la copia es importable", c.financial_components.every((k) => k.status === "insertable") && c.financial_components.length === 1);
  const a = await applyOf(s, p.preview_id);
  const L = await links(admin, A);
  check("mezcla web + copia: los vínculos apuntan al id correcto de la web o de la copia", has(L.lessonRule, "w2_cl_webrule", "w1_rr1") && has(L.lessonRule, "w2_cl_newrule", "w2_rr_newwebagr") && has(L.ruleAgreement, "w2_rr_newwebagr", "w1_ta1") && has(L.regLesson, "w2_pl_new", "w2_cl_newrule") && has(L.regLesson, "w2_pl_webless", "w1_cl4") && has(L.chargeReg, "w2_ch", "w1_pl2") && has(L.chargeLesson, "w2_ch", "w2_cl_newrule"));
  const u = await undoPreviewOf(s, a.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("mezcla: deshacer la segunda corrida deja intacta la cadena de la primera", JSON.stringify(await tableCounts(admin, A)) === JSON.stringify(CHAIN_ROWS));
  void a1;
  await s.end();
}

async function sectionLevels(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const seedLevel = (n, legacy, name) => admin.query(`insert into public.custom_levels (id, owner_id, legacy_mobile_id, name, created_at) values ($1, $2, $3, $4, now())`, [`00000000-0000-4000-8000-0000000000${n}`, A, legacy, name]);
  await seedLevel(10, "cv_web", "Nivel A");
  await seedLevel(11, "cv_x", "Nivel X");
  await seedLevel(12, "cv_y", "Nivel Y");
  const b = emptyBackup();
  b.customLevels = [
    { id: "cv_web", name: "Nivel A", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "cv_a_dup1", name: "  nivel a ", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "cv_a_dup2", name: "NIVEL A", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "cv_b1", name: "Nivel B", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "cv_b2", name: "nivel b", createdAt: "2025-01-02T00:00:00.000Z" },
    { id: "cv_b3", name: " NIVEL B ", createdAt: "2025-01-02T00:00:00.000Z" },
    { id: "cv_c", name: "Nivel C", createdAt: "2025-01-03T00:00:00.000Z" },
    { id: "cv_blank", name: "   ", createdAt: "2025-01-03T00:00:00.000Z" },
    { id: "cv_x", name: "Nivel Y", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "cv_y", name: "Nivel Y", createdAt: "2025-01-01T00:00:00.000Z" },
  ];
  const bizL = await fp(admin, A, { business: true });
  const p = await previewOf(s, b);
  const before = await fp(admin, A);
  const lv = p.classification.maestros.custom_levels;
  const dup = byId(lv.duplicates);
  check("niveles: el repetido de la WEB (aunque cambien mayúsculas o espacios) se informa como duplicado y se conserva el de la web", dup.cv_a_dup1.reason === "same_name_in_web" && dup.cv_a_dup2.reason === "same_name_in_web" && dup.cv_a_dup1.existing_name === "Nivel A", JSON.stringify(lv.duplicates));
  check("niveles: el repetido DENTRO de la copia se informa (el primero se agrega, los demás son duplicados)", lv.inserts.map((x) => x.legacy_mobile_id).sort().join(",") === "cv_b1,cv_c" && dup.cv_b2.reason === "same_name_in_copy" && dup.cv_b3.reason === "same_name_in_copy", JSON.stringify(lv.inserts));
  check("niveles: un nivel sin nombre no se agrega y se informa aparte", dup.cv_blank.reason === "blank_name");
  check("niveles: el nivel ya vinculado e igual sigue «igual» y el de nombre distinto sigue «con diferencias»", lv.equal.some((x) => x.legacy_mobile_id === "cv_web") && lv.conflicts.some((x) => x.legacy_mobile_id === "cv_x") && lv.equal.some((x) => x.legacy_mobile_id === "cv_y"));
  check("niveles: la vista previa no cambió nada de negocio", sameFp(bizL, await fp(admin, A, { business: true })) && (await count(admin, "custom_levels", A)) === 3);

  // Reemplazar el nombre de cv_x por «Nivel Y» chocaría con cv_y: se rechaza con un mensaje PROPIO, sin escribir nada.
  const xRow = lv.conflicts.find((x) => x.legacy_mobile_id === "cv_x").row_id;
  const e = await fails(() => applyOf(s, p.preview_id, [{ table_name: "custom_levels", row_id: xRow, fields: ["name"] }]), /Ya existe otro nivel con ese nombre/, "reemplazar un nombre que choca con otro nivel: mensaje propio (no el genérico «ya existe»)");
  check("niveles: ese rechazo no es una violación de índice único (se distingue de otros errores) y no escribe nada", e && e.code === "22023" && sameFp(before, await fp(admin, A)) && (await advisoryLocks(admin)) === 0, e && `${e.code}`);
  // Conservar el nivel que ya existe (no marcar nada): importa sólo los niveles realmente nuevos.
  const a = await applyOf(s, p.preview_id);
  const names = (await rows(admin, `select name from public.custom_levels where owner_id = $1 order by lower(btrim(name))`, [A])).map((r) => r.name);
  check("niveles: sin reemplazos se agregan SÓLO los niveles realmente nuevos (B y C) y se conservan los de la web", JSON.stringify(names) === JSON.stringify(["Nivel A", "Nivel B", "Nivel C", "Nivel X", "Nivel Y"]), JSON.stringify(names));
  const dupNames = await rows(admin, `select lower(btrim(name)) n, count(*)::int c from public.custom_levels where owner_id = $1 group by 1 having count(*) > 1`, [A]);
  check("niveles: nunca quedan dos niveles con el mismo nombre normalizado", dupNames.length === 0);
  const r2 = await applyOf(s, p.preview_id);
  check("niveles: el reintento devuelve la misma corrida y no duplica", r2.summary.replayed === true && (await count(admin, "custom_levels", A)) === 5);
  const u = await undoPreviewOf(s, a.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("niveles: deshacer vuelve a los 3 niveles de la web", (await count(admin, "custom_levels", A)) === 3);

  // Reemplazo legítimo (el nombre nuevo no choca) y deshacer lo restaura.
  await reset(admin);
  await seedLevel(10, "cv_web", "Nivel A");
  const b2 = emptyBackup();
  b2.customLevels = [{ id: "cv_web", name: "Nivel Renombrado", createdAt: "2025-01-01T00:00:00.000Z" }];
  const p2 = await previewOf(s, b2);
  const row = p2.classification.maestros.custom_levels.conflicts[0].row_id;
  const a2 = await applyOf(s, p2.preview_id, [{ table_name: "custom_levels", row_id: row, fields: ["name"] }]);
  check("niveles: un reemplazo de nombre que NO choca se aplica", (await rows(admin, `select name from public.custom_levels where owner_id = $1`, [A]))[0].name === "Nivel Renombrado");
  const u2 = await undoPreviewOf(s, a2.import_run_id);
  await undoApplyOf(s, u2.undo_preview_id);
  check("niveles: deshacer el reemplazo restaura el nombre original", (await rows(admin, `select name from public.custom_levels where owner_id = $1`, [A]))[0].name === "Nivel A");

  // Un nivel con el mismo nombre aparece en la web DESPUÉS de revisar: la importación se frena con su propio mensaje y no escribe nada.
  await reset(admin);
  const b3 = emptyBackup();
  b3.customLevels = [{ id: "cv_new", name: "Nivel Nuevo", createdAt: "2025-01-01T00:00:00.000Z" }];
  const p3 = await previewOf(s, b3);
  await seedLevel(13, null, "nivel NUEVO");
  const before3 = await fp(admin, A);
  await fails(() => applyOf(s, p3.preview_id), /Apareció un nivel con el mismo nombre/, "niveles: un nivel igual que aparece después de revisar se frena con mensaje propio");
  check("niveles: ese caso no escribe nada ni deja locks", sameFp(before3, await fp(admin, A)) && (await advisoryLocks(admin)) === 0);

  // Dentro de la propia copia, el mismo identificador repetido sigue rechazándose antes de importar.
  await reset(admin);
  const b4 = emptyBackup();
  b4.customLevels = [{ id: "cv_same", name: "Uno", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_same", name: "Dos", createdAt: "2025-01-01T00:00:00.000Z" }];
  await fails(() => previewOf(s, b4), /datos repetidos/, "niveles: el mismo identificador repetido dentro de la copia se rechaza al analizar");
  await s.end();
}

async function sectionBudget(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const seed = (n, w, sv) => admin.query(`insert into public.budget_distribution_settings (owner_id, needs_percent, wants_percent, savings_percent) values ($1, $2, $3, $4) on conflict (owner_id) do update set needs_percent = $2, wants_percent = $3, savings_percent = $4`, [A, n, w, sv]);
  const doc = (n, w, sv, goal = { enabled: true, targetAmount: 5000, targetDate: "2026-12-31" }) => ({ distribution: { needs: n, wants: w, savings: sv }, savingsGoal: goal });
  const budget = async () => (await rows(admin, `select needs_percent n, wants_percent w, savings_percent s, savings_goal_enabled ge, savings_goal_target_amount ga from public.budget_distribution_settings where owner_id = $1`, [A]))[0];
  const ovr = (fields) => [{ table_name: "budget_distribution_settings", row_id: A, fields }];
  const ALL3 = ["needs_percent", "wants_percent", "savings_percent"];

  // (1) Reemplazo válido de los tres porcentajes, vista previa → confirmación → reintento → deshacer.
  await seed(50, 30, 20);
  let b = emptyBackup(); b.budgetDistribution = doc(40, 40, 20);
  const fresh = (bk) => previewOf(s, bk);
  const p = await fresh(b);
  const st = p.classification.maestros.budget_distribution_settings;
  check("presupuesto: la vista previa lo informa como diferencia a decidir (nada se escribe todavía)", st.status === "conflict" && (await budget()).n === 50);
  const a = await applyOf(s, p.preview_id, ovr(ALL3));
  const now = await budget();
  check("presupuesto: el reemplazo válido de los tres porcentajes se aplica y la suma final es exactamente 100", now.n === 40 && now.w === 40 && now.s === 20 && now.n + now.w + now.s === 100, JSON.stringify(now));
  const snap = await rows(admin, `select action, previous_row ->> 'needs_percent' pn, new_row ->> 'needs_percent' nn from public.import_run_row_snapshots where import_run_id = $1 and table_name = 'budget_distribution_settings'`, [a.import_run_id]);
  check("presupuesto: queda UNA instantánea del reemplazo con el estado anterior y el nuevo", snap.length === 1 && snap[0].action === "field_overwritten" && snap[0].pn === "50" && snap[0].nn === "40");
  const again = await applyOf(s, p.preview_id, ovr(ALL3));
  check("presupuesto: respuesta perdida y reintento = la misma corrida, sin cambiar nada", again.import_run_id === a.import_run_id && again.summary.replayed === true && (await budget()).n === 40);
  const u = await undoPreviewOf(s, a.import_run_id);
  check("presupuesto: se puede deshacer (revisión segura)", u.is_safe === true, JSON.stringify(u.unsafe_rows));
  await undoApplyOf(s, u.undo_preview_id);
  const back = await budget();
  check("presupuesto: deshacer restaura exactamente 50/30/20", back.n === 50 && back.w === 30 && back.s === 20, JSON.stringify(back));

  // (2) Parcial INVÁLIDO: la copia (40/40/20) difiere en necesidades y gustos; reemplazar UNO solo deja una suma distinta de 100 → se rechaza sin tocar nada.
  const p2 = await fresh(b);
  const before = await fp(admin, A);
  const e1 = await fails(() => applyOf(s, p2.preview_id, ovr(["needs_percent"])), /no suma 100/, "presupuesto: un reemplazo parcial que no suma 100 (40+30+20) se rechaza con mensaje propio");
  check("presupuesto: ese rechazo no modifica nada, no deja lock y la vista previa sigue pendiente", e1 && e1.code === "22023" && sameFp(before, await fp(admin, A)) && (await advisoryLocks(admin)) === 0 && (await rows(admin, `select status from public.import_previews where id = $1`, [p2.preview_id]))[0].status === "pending");
  await fails(() => applyOf(s, p2.preview_id, ovr(["wants_percent"])), /no suma 100/, "presupuesto: el otro porcentaje suelto (50+40+20) tampoco suma 100");
  await fails(() => applyOf(s, p2.preview_id, ovr(["needs_percent", "savings_percent"])), /no suma 100/, "presupuesto: necesidades + ahorro (40+30+20) tampoco");
  check("presupuesto: tras los rechazos la web sigue EXACTAMENTE igual y la misma revisión sigue sirviendo", sameFp(before, await fp(admin, A)) && (await budget()).n === 50);

  // (3) Parcial VÁLIDO: reemplazar necesidades y gustos (la copia coincide en ahorro) deja 40/40/20 = 100; se aplica de una vez.
  const a3 = await applyOf(s, p2.preview_id, ovr(["needs_percent", "wants_percent"]));
  const n3 = await budget();
  check("presupuesto: un reemplazo parcial que SÍ suma 100 se aplica de una vez (40/40/20)", n3.n === 40 && n3.w === 40 && n3.s === 20, JSON.stringify(n3));
  const u3 = await undoPreviewOf(s, a3.import_run_id);
  await undoApplyOf(s, u3.undo_preview_id);
  check("presupuesto: y también se deshace (50/30/20)", (await budget()).n === 50 && (await budget()).w === 30);

  // (3b) Otra copia (50/20/30): gustos solos → 50+20+20 = 90 se rechaza; gustos + ahorro → 100 se aplica.
  const b3 = emptyBackup(); b3.budgetDistribution = doc(50, 20, 30);
  const p3 = await fresh(b3);
  await fails(() => applyOf(s, p3.preview_id, ovr(["wants_percent"])), /no suma 100/, "presupuesto: sólo los gustos (50+20+20) se rechaza");
  const a3b = await applyOf(s, p3.preview_id, ovr(["wants_percent", "savings_percent"]));
  check("presupuesto: gustos + ahorro (50+20+30) se aplica", (await budget()).w === 20 && (await budget()).s === 30);
  const u3b = await undoPreviewOf(s, a3b.import_run_id);
  await undoApplyOf(s, u3b.undo_preview_id);

  // (4) Repetido: la misma decisión dos veces se rechaza; el mismo campo repetido dentro de la lista cuenta una vez.
  const p4 = await fresh(b3);
  await fails(() => applyOf(s, p4.preview_id, [...ovr(["wants_percent", "savings_percent"]), ...ovr(["wants_percent", "savings_percent"])]), /repetido|no admite overrides/, "presupuesto: la misma decisión repetida se rechaza");
  const a4 = await applyOf(s, p4.preview_id, ovr(["wants_percent", "wants_percent", "savings_percent"]));
  check("presupuesto: el mismo campo repetido dentro de una decisión cuenta una sola vez", (await budget()).w === 20 && a4.summary.replayed === false);
  const u4 = await undoPreviewOf(s, a4.import_run_id);
  await undoApplyOf(s, u4.undo_preview_id);

  // (5) Una copia con la distribución inválida se rechaza al ANALIZAR (no se llega a decidir nada).
  const bad = emptyBackup(); bad.budgetDistribution = doc(50, 30, 10);
  await fails(() => previewOf(s, bad), /sumar 100/, "presupuesto: una copia con una distribución que no suma 100 se rechaza al analizar");
  const bad2 = emptyBackup(); bad2.budgetDistribution = doc(50, 30.5, 19.5);
  await fails(() => previewOf(s, bad2), /entero/, "presupuesto: porcentajes no enteros se rechazan al analizar");

  // (6) Elegir SÓLO la meta de ahorro (sin porcentajes) no toca los porcentajes.
  b = emptyBackup(); b.budgetDistribution = doc(40, 40, 20, { enabled: false, targetAmount: null, targetDate: null });
  await admin.query(`update public.budget_distribution_settings set savings_goal_enabled = true, savings_goal_target_amount = 9000 where owner_id = $1`, [A]);
  const p6 = await previewOf(s, b);
  const a6 = await applyOf(s, p6.preview_id, ovr(["savings_goal_enabled", "savings_goal_target_amount"]));
  const n6 = await budget();
  check("presupuesto: reemplazar sólo la meta de ahorro (aunque la copia difiera en los porcentajes) deja los porcentajes como estaban", n6.n === 50 && n6.w === 30 && n6.s === 20 && n6.ge === false && n6.ga === null, JSON.stringify(n6));
  const u6 = await undoPreviewOf(s, a6.import_run_id);
  await undoApplyOf(s, u6.undo_preview_id);
  check("presupuesto: la meta se restaura al deshacer", (await budget()).ge === true && Number((await budget()).ga) === 9000);

  // (7) La web cambió después de revisar: se frena (nunca se pisa algo que la usuaria no vio).
  b = emptyBackup(); b.budgetDistribution = doc(40, 40, 20);
  const p7 = await previewOf(s, b);
  await admin.query(`update public.budget_distribution_settings set needs_percent = 60, wants_percent = 20 where owner_id = $1`, [A]);
  const before7 = await fp(admin, A);
  await fails(() => applyOf(s, p7.preview_id, ovr(ALL3)), /cambió desde que se generó|desactualiz/, "presupuesto: si la web cambió después de revisar, se frena");
  check("presupuesto: ese caso no escribe nada", sameFp(before7, await fp(admin, A)));

  // (8) Cuenta sin presupuesto: la copia lo AGREGA entero (sin decisiones).
  await admin.query(`delete from public.budget_distribution_settings where owner_id = $1`, [A]);
  b = emptyBackup(); b.budgetDistribution = doc(20, 30, 50);
  const p8 = await previewOf(s, b);
  const a8 = await applyOf(s, p8.preview_id);
  check("presupuesto: en una cuenta sin presupuesto se agrega completo y suma 100", (await budget()).n === 20 && (await budget()).s === 50 && a8.summary.counts_by_table.budget_distribution_settings === 1);
  await s.end();
}

async function sectionOwners(pg) {
  const admin = pg.admin;
  await reset(admin);
  const sa = await newSession(pg, A, 60000);
  const sb = await newSession(pg, B, 60000);
  const b = emptyBackup();
  addChain(b, "same");
  const [pa, pb] = await Promise.all([previewOf(sa, b), previewOf(sb, b)]);
  const [ra, rb] = await Promise.all([applyOf(sa, pa.preview_id), applyOf(sb, pb.preview_id)]);
  const ca = await tableCounts(admin, A); const cb = await tableCounts(admin, B);
  check("dos propietarias en paralelo con la MISMA copia (mismos ids móviles): cada una recibe su cadena completa", JSON.stringify(ca) === JSON.stringify(CHAIN_ROWS) && JSON.stringify(cb) === JSON.stringify(CHAIN_ROWS), JSON.stringify(ca));
  check("dos propietarias: ninguna fila apunta a una fila de la otra cuenta", (await crossOwnerRefs(admin)) === 0);
  const LA = await links(admin, A); const LB = await links(admin, B);
  check("dos propietarias: los vínculos de cada una son idénticos (mismo grafo, ids propios)", JSON.stringify(LA) === JSON.stringify(LB));
  // La de A deshace sin tocar a B.
  const fpB = await fp(admin, B);
  const u = await undoPreviewOf(sa, ra.import_run_id);
  await undoApplyOf(sa, u.undo_preview_id);
  check("deshacer en una cuenta no toca a la otra", sameFp(fpB, await fp(admin, B)) && Object.values(await tableCounts(admin, A)).every((n) => n === 0));
  void rb;
  // Referencia a un id que sólo existe en la OTRA cuenta: para esta cuenta es una referencia realmente faltante.
  const only = emptyBackup();
  only.students.push(student("only_st", { name: "Solo Uno" }));
  only.recurrenceRules.push(rule("only_rr", { primaryStudentId: "only_st", trainingBillingAgreementId: "same_ta1" }));
  only.calendarLessons.push(lesson("only_cl", 10, { primaryStudentId: "only_st", recurrenceId: "same_rr1", isRecurring: true, recurrenceOccurrenceKey: "ok1", recurrenceIndex: 1 }), lesson("only_cl2", 11, { primaryStudentId: "same_st1" }));
  only.pedagogicalLessons.push(reg("only_pl", { calendarLessonId: "same_cl1", roster: [{ studentId: "only_st" }] }));
  const po = await previewOf(sa, only);
  const co = po.classification.aggregates;
  check("referencias a ids que sólo existen en OTRA cuenta se tratan como faltantes (acuerdo, serie, alumno, clase)", co.recurrence_rules[0].status === "omitted_broken_reference" && co.calendar_lessons.every((x) => x.status === "omitted_broken_reference") && co.lesson_registrations[0].status === "omitted_broken_reference", JSON.stringify([co.recurrence_rules[0].status, co.calendar_lessons.map((x) => x.status), co.lesson_registrations[0].status]));
  await sa.end(); await sb.end();
}

async function sectionConcurrent(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s1 = await newSession(pg, A, 60000);
  const s2 = await newSession(pg, A, 60000);
  const b = emptyBackup();
  for (const p of ["k1", "k2"]) addChain(b, p);
  const p = await previewOf(s1, b);
  const [r1, r2] = await Promise.allSettled([applyOf(s1, p.preview_id), applyOf(s2, p.preview_id)]);
  const ok = [r1, r2].filter((r) => r.status === "fulfilled").map((r) => r.value);
  check("dos confirmaciones simultáneas de la MISMA revisión: las dos terminan y devuelven la misma corrida", ok.length === 2 && ok[0].import_run_id === ok[1].import_run_id && ok.filter((x) => x.summary.replayed === true).length === 1, [r1, r2].map((r) => r.status === "fulfilled" ? "ok" : r.reason.message.slice(0, 80)).join(" | "));
  check("dos confirmaciones simultáneas: se escribió UNA sola vez", JSON.stringify(await tableCounts(admin, A)) === JSON.stringify(Object.fromEntries(Object.entries(CHAIN_ROWS).map(([k, v]) => [k, v * 2]))) && (await count(admin, "import_runs", A)) === 1);
  check("sin locks pendientes", (await advisoryLocks(admin)) === 0);
  await s1.end(); await s2.end();
}

async function sectionExpiredAndStale(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const b = emptyBackup();
  addChain(b, "e");
  const p = await previewOf(s, b);
  await admin.query(`update public.import_previews set expires_at = now() - interval '1 minute' where id = $1`, [p.preview_id]);
  await fails(() => applyOf(s, p.preview_id), /ya no es válido/, "revisión vencida: se rechaza y no escribe nada");
  check("revisión vencida: cero filas de negocio", (await count(admin, "students", A)) === 0);
  // Desactualizada: aparece en la web una clase con el mismo id de la copia después de revisar.
  const p2 = await previewOf(s, b);
  await admin.query(`insert into public.students (owner_id, legacy_mobile_id, name, levels, initial_level, modality, status, category, billing_type, date_joined, usual_duration_minutes, weekly_frequency, price) values ($1, 'e_st1', 'Alumna e Uno', array['A1'], 'A1', 'online', 'activo', 'adulto_interes_personal', 'mensual', '2025-01-10', 60, 1, 1000)`, [A]);
  const before = await fp(admin, A);
  await fails(() => applyOf(s, p2.preview_id), /desactualizad|ya existe|cambió/, "revisión desactualizada: un alumno de la copia apareció en la web → se frena");
  check("revisión desactualizada: no escribe nada ni deja locks", sameFp(before, await fp(admin, A)) && (await advisoryLocks(admin)) === 0);
  // Vista previa generada ANTES de R6.1 (la clasificación de niveles no trae `duplicates`): se aplica igual.
  await reset(admin);
  const bl = emptyBackup();
  bl.customLevels = [{ id: "cv_old", name: "Nivel viejo", createdAt: "2025-01-01T00:00:00.000Z" }];
  const pl = await previewOf(s, bl);
  await admin.query(`update public.import_previews set classification = classification #- '{maestros,custom_levels,duplicates}' where id = $1`, [pl.preview_id]);
  const al = await applyOf(s, pl.preview_id);
  check("compatibilidad: una vista previa pendiente SIN la clave de duplicados de niveles se aplica igual", al.summary.counts_by_table.custom_levels === 1);
  await s.end();
}

async function sectionQuotasPurge(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const b = emptyBackup();
  for (const p of ["q1", "q2", "q3"]) addChain(b, p);
  // (a) Cuota de R3 al previsualizar: las clases que se agregarían superan el tope → se rechaza ANTES de guardar nada.
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'calendar_lessons', 5)`, [A]);
  const before = await fp(admin, A);
  const e = await fails(() => previewOf(s, b), /quota_exceeded/, "cuota de R3 al previsualizar: las clases que agrega la cadena superan el tope → se rechaza");
  check("cuota al previsualizar: SQLSTATE 53400, categoría correcta y cero residuos", e && e.code === "53400" && e.detail === "calendar_lessons" && sameFp(before, await fp(admin, A)));
  await admin.query(`delete from public.account_quota_overrides where owner_id = $1`, [A]);
  // (b) Cuota alcanzada a mitad de la aplicación (categoría anidada): se revierte TODO.
  const p = await previewOf(s, b);
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'lesson_registration_attendance', 4)`, [A]);
  const before2 = await fp(admin, A);
  const e2 = await fails(() => applyOf(s, p.preview_id), /quota_exceeded/, "cuota de R3 durante la aplicación: se frena");
  check("cuota durante la aplicación: TODO se revierte (alumnos, series, clases y registros escritos antes también) y no queda lock", e2 && e2.detail === "lesson_registration_attendance" && sameFp(before2, await fp(admin, A)) && (await advisoryLocks(admin)) === 0, diffFp(before2, await fp(admin, A)));
  await admin.query(`delete from public.account_quota_overrides where owner_id = $1`, [A]);
  const ok = await applyOf(s, p.preview_id);
  check("liberada la cuota, la MISMA revisión se aplica completa", JSON.stringify(await tableCounts(admin, A)) === JSON.stringify(Object.fromEntries(Object.entries(CHAIN_ROWS).map(([k, v]) => [k, v * 3]))));
  // (c) Purga de R4 posterior: libera la copia retenida y las instantáneas; los datos de negocio NO se tocan; y el trabajo de la cadena sigue ahí.
  const biz = await fp(admin, A, { business: true });
  await admin.query(`update public.import_runs set undo_expires_at = now() - interval '3 hours' where id = $1`, [ok.import_run_id]);
  await admin.query(`select public.purge_expired_import_data(200)`);
  const run = (await rows(admin, `select retained_payload is null as payload_gone, payload_purged_at is not null as p_at, snapshots_purged_at is not null as s_at from public.import_runs where id = $1`, [ok.import_run_id]))[0];
  check("purga de R4 posterior: libera la copia retenida y las instantáneas de la corrida vencida", run.payload_gone && run.p_at && run.s_at);
  check("purga de R4: los datos importados (la cadena completa) NO se tocan y no quedan instantáneas", sameFp(biz, await fp(admin, A, { business: true })) && (await rows(admin, `select count(*)::int n from public.import_run_row_snapshots where import_run_id = $1`, [ok.import_run_id]))[0].n === 0);
  await fails(() => undoPreviewOf(s, ok.import_run_id), /plazo para deshacer/, "purga de R4: después del plazo ya no se puede deshacer");
  await s.end();
}

async function sectionMidFailure(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg, A, 60000);
  const b = emptyBackup();
  for (const p of ["m1", "m2"]) addChain(b, p);
  b.budgetDistribution = { distribution: { needs: 50, wants: 30, savings: 20 }, savingsGoal: { enabled: false, targetAmount: null, targetDate: null } };
  b.customLevels = [{ id: "cv_m", name: "Nivel M", createdAt: "2025-01-01T00:00:00.000Z" }];
  const p = await previewOf(s, b);
  const before = await fp(admin, A);
  // Falla a MITAD de la aplicación: un disparador de prueba hace fallar la ÚLTIMA tabla que se escribe (los ajustes de cobro).
  await admin.query(`create or replace function public.t_r61_boom() returns trigger language plpgsql as $$ begin raise exception 'falla de prueba'; end $$`);
  await admin.query(`create trigger t_r61_boom before insert on public.payment_adjustments for each statement execute function public.t_r61_boom()`);
  await fails(() => applyOf(s, p.preview_id), /falla de prueba/, "error a mitad de la aplicación de la cadena: la confirmación falla");
  check("error a mitad: TODO se revierte (alumnos, acuerdos, series, clases, registros, cobros, presupuesto y niveles; cero instantáneas y corridas)", sameFp(before, await fp(admin, A)), diffFp(before, await fp(admin, A)));
  check("error a mitad: no queda lock y la vista previa sigue pendiente", (await advisoryLocks(admin)) === 0 && (await rows(admin, `select status from public.import_previews where id = $1`, [p.preview_id]))[0].status === "pending");
  await admin.query(`drop trigger t_r61_boom on public.payment_adjustments`);
  await admin.query(`drop function public.t_r61_boom()`);
  const ok = await applyOf(s, p.preview_id);
  check("corregida la causa, la MISMA revisión se aplica sin duplicados por el intento anterior", ok.summary.replayed === false && (await count(admin, "students", A)) === 6 && (await count(admin, "import_runs", A)) === 1);
  const u = await undoPreviewOf(s, ok.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  await s.end();
}

async function sectionUndoBlocked(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await newSession(pg);
  const b = emptyBackup();
  addChain(b, "u");
  const p = await previewOf(s, b);
  const a = await applyOf(s, p.preview_id);
  // Un dato nuevo (creado DESPUÉS de importar) depende de una serie importada: deshacer queda bloqueado por completo.
  await admin.query(`insert into public.calendar_lessons (owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind, recurrence_id)
    select $1, r.primary_student_id, 'x', 'A1', 'individual', now() + interval '3 days', now() + interval '3 days 1 hour', 'online', 'scheduled', '#DDEEFF', 'class', r.id from public.recurrence_rules r where r.owner_id = $1 and r.legacy_mobile_id = 'u_rr2'`, [A]);
  const u = await undoPreviewOf(s, a.import_run_id);
  check("deshacer bloqueado: se informa que hay datos posteriores que dependen de lo importado", u.is_safe === false && JSON.stringify(u.unsafe_rows).includes("dependen"));
  const before = await fp(admin, A);
  await fails(() => undoApplyOf(s, u.undo_preview_id), /deshacer bloqueado|dependencias/, "deshacer bloqueado: la confirmación se rechaza");
  check("deshacer bloqueado: no toca nada", sameFp(before, await fp(admin, A)));
  await s.end();
}

async function sectionLimitsAndScale(pg) {
  const admin = pg.admin;
  await admin.query(`alter database postgres set track_functions = 'all'`);
  await reset(admin);
  // Límite de R6 con la cadena completa dentro de la copia: el mayor respaldo ENLAZADO que cabe en 7.500 unidades entra, uno más se rechaza antes de procesar.
  let lo = 100; let hi = 20000;
  const fits = (n) => workUnits(generateBackup(n, { levelHistory: false, linked: true })) <= LIM.max_work_units;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  const big = generateBackup(lo, { levelHistory: false, linked: true });
  const u = workUnits(big);
  const s = await apiSession(pg, A, 8000); // el MISMO tope que la API de Production
  const t1 = await timed(() => previewOf(s, big));
  check(`máximo (${u} unidades, cadena completa enlazada): la vista previa entra bajo el tope de 8 s de la API`, t1.ms < 8000, `${t1.ms} ms`);
  const c = t1.value.classification.aggregates;
  check("máximo: las series, clases, registros y cobros ENLAZADOS son importables (no se omiten por depender de lo que agrega la misma copia)", c.recurrence_rules.every((x) => x.status === "insertable") && c.calendar_lessons.every((x) => x.status === "insertable") && c.lesson_registrations.every((x) => x.status === "insertable"), JSON.stringify([c.recurrence_rules, c.calendar_lessons, c.lesson_registrations].map((arr) => arr.filter((x) => x.status !== "insertable").length)));
  const t2 = await timed(() => applyOf(s, t1.value.preview_id));
  check(`máximo (${u} unidades): la confirmación termina bajo el tope de 8 s de la API`, t2.ms < 8000, `${t2.ms} ms`);
  console.log(`   (máximo enlazado: n=${lo}, ${u} unidades; vista previa ${t1.ms} ms, aplicación ${t2.ms} ms)`);
  check("máximo: se escribió todo y las cadenas quedaron unidas", (await count(admin, "students", A)) === big.students.length && (await count(admin, "calendar_lessons", A)) === big.calendarLessons.length && (await rows(admin, `select count(*)::int n from public.calendar_lessons where owner_id = $1 and recurrence_id is not null`, [A]))[0].n === big.calendarLessons.filter((l) => l.recurrenceId).length);
  const uu = await undoPreviewOf(s, t2.value.import_run_id);
  const tu = await timed(() => undoApplyOf(s, uu.undo_preview_id));
  check("máximo: deshacer completo y rápido, y la cuenta queda sin nada", tu.ms < 8000 && (await count(admin, "students", A)) === 0 && (await count(admin, "calendar_lessons", A)) === 0, `${tu.ms} ms`);
  // Una unidad por encima del máximo: se rechaza antes de procesar.
  const over = generateBackup(lo, { levelHistory: false, linked: true });
  over.customLevels = over.customLevels.concat(Array.from({ length: LIM.max_work_units - u + 1 }, (_, i) => ({ id: `over_${i}`, name: `Sobra ${i}`, createdAt: "2025-01-01T00:00:00.000Z" })));
  check("el respaldo de prueba de «una unidad por encima» tiene exactamente una unidad de más", workUnits(over) === LIM.max_work_units + 1, String(workUnits(over)));
  const before = await fp(admin, A);
  await fails(() => previewOf(s, over), /demasiados datos para importar de una vez/, "una unidad por encima del máximo de 7.500: se rechaza antes de procesar");
  check("una unidad por encima: no escribe nada", sameFp(before, await fp(admin, A)));
  await s.end();

  // Escala: el trabajo crece LINEALMENTE (nada de una llamada por elemento, ni tiempos cuadráticos) en la cadena enlazada.
  async function profile(n) {
    const out = {};
    const ss = await pg.session(A);
    await ss.query(`set statement_timeout = 60000`);
    const bk = generateBackup(n, { levelHistory: false, linked: true });
    await ss.query("begin");
    const t0 = Date.now();
    await ss.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk)]);
    out.previewMs = Date.now() - t0;
    const stats = async () => {
      const t = (await ss.query(`select coalesce(sum(seq_scan),0)::int seq, coalesce(sum(idx_scan),0)::int idx from pg_stat_xact_user_tables`)).rows[0];
      const f = (await ss.query(`select funcid::regproc::text f, calls::int calls from pg_stat_xact_user_functions`)).rows;
      return { seq: t.seq, idx: t.idx, calls: Object.fromEntries(f.map((r) => [r.f.replace("public.", ""), r.calls])) };
    };
    out.preview = await stats();
    await ss.query("rollback");
    const pv = await previewOf(ss, bk);
    await ss.query("begin");
    const t1x = Date.now();
    await applyOf(ss, pv.preview_id);
    out.applyMs = Date.now() - t1x;
    out.apply = await stats();
    await ss.query("rollback");
    await ss.end();
    return out;
  }
  const small = await profile(500);
  const large = await profile(2000);
  const callsPerElement = (o) => Object.entries(o.calls).filter(([f]) => /^_import_(available_ids|classify_)/.test(f)).reduce((sum, [, v]) => sum + v, 0);
  check("escala (vista previa): las llamadas a los clasificadores y al mapa de ids NO crecen con el tamaño (4x filas → mismas llamadas)", callsPerElement(large.preview) === callsPerElement(small.preview) && callsPerElement(large.preview) <= 30, `${callsPerElement(small.preview)} → ${callsPerElement(large.preview)}`);
  check("escala (vista previa): las lecturas secuenciales de tabla no crecen con el tamaño", large.preview.seq <= small.preview.seq * 2 + 30, `${small.preview.seq} → ${large.preview.seq}`);
  check("escala (aplicación): el disparador de cuotas de R3 corre UNA vez por tabla, no una vez por fila", (large.apply.calls.tf_quota_after_insert || 0) <= (small.apply.calls.tf_quota_after_insert || 0) + 8 && (large.apply.calls.tf_quota_after_insert || 0) <= 80, `${small.apply.calls.tf_quota_after_insert} → ${large.apply.calls.tf_quota_after_insert}`);
  const ratio = (large.apply.seq + large.apply.idx) / Math.max(1, small.apply.seq + small.apply.idx);
  check("escala (aplicación): las consultas crecen LINEALMENTE con las filas (4x filas → ≤ 4,6x consultas)", ratio <= 4.6, `x${ratio.toFixed(2)}`);
  check("escala: el tiempo de 4x filas es ≪ 16x (no cuadrático): vista previa ≤ 8x y aplicación ≤ 8x", large.previewMs <= small.previewMs * 8 + 400 && large.applyMs <= small.applyMs * 8 + 400, `vista previa ${small.previewMs}→${large.previewMs} ms, aplicación ${small.applyMs}→${large.applyMs} ms`);
  check("escala: las funciones por elemento de la versión anterior no se usan", ["_apply_students", "_apply_calendar_lessons", "_apply_financial_components", "_apply_lesson_registrations", "_external_ref_available"].every((f) => !(large.apply.calls[f] > 0) && !(large.preview.calls[f] > 0)));
}

async function runAll(pg, { quick = false } = {}) {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const run = async (name, fn) => { if (!only || only.includes(name)) await fn(pg); };
  await run("static", sectionStatic);
  await run("chain", sectionChain);
  await run("independent", sectionIndependentChains);
  await run("mixed", sectionMixedWithWeb);
  await run("levels", sectionLevels);
  await run("budget", sectionBudget);
  await run("owners", sectionOwners);
  await run("concurrent", sectionConcurrent);
  await run("stale", sectionExpiredAndStale);
  await run("undoblocked", sectionUndoBlocked);
  await run("quotas", sectionQuotasPurge);
  await run("midfailure", sectionMidFailure);
  if (!quick) await run("scale", sectionLimitsAndScale);
}

async function main() {
  if (!MUTATIONS) {
    const pg = await start({ port: 5701 });
    if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
    await runAll(pg);
    await pg.stop();
    console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
    if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
    return;
  }
  require("./r61_import_mutations.cjs").run({ runAll, state: () => ({ failures, total }), reset: () => { failures = []; total = 0; } }).then((code) => process.exit(code));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { runAll, addChain, CHAIN_ROWS };
void q;
