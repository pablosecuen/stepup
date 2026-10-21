import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptMobileBackup, stableHash, toCivilDateKey } from "../mobile-adapter.ts";
import { validateBackupPayload } from "../validation.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";

/** Traslado desde la app móvil: el respaldo REAL de la app (formato móvil) se adapta al formato que lee la importación, sin perder ni inventar nada. */

type Row = Record<string, unknown>;
const rows = (payload: Row, key: string) => payload[key] as Row[];
const byId = (list: Row[], id: string) => list.find((r) => r.id === id) as Row;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("HOY (antes del adaptador) un respaldo real con series se rechazaba; ahora se valida", () => {
  const result = validateBackupPayload(buildMobileBackup());
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.errors));
  if (result.ok) {
    assert.equal(result.adaptation.shape, "mobile");
    assert.deepEqual(result.adaptation.omitted, []);
  }
});

test("alumnos: la tarjeta de la lista y la ficha se unen en una fila completa, con fechas en día civil de Argentina", () => {
  const { payload, report } = adaptMobileBackup(buildMobileBackup());
  const students = rows(payload, "students");
  assert.equal(students.length, 4);
  const one = byId(students, "stu-1");
  assert.equal(one.category, "adulto_interes_personal");
  assert.equal(one.billingType, "mensual");
  assert.equal(one.phone, "+54 9 11 5550-0001");
  assert.equal(one.email, "zq.uno@example.invalid");
  assert.deepEqual(one.billingPlan, { type: "monthly", amount: 41000.37, dueDay: 10, startPeriod: "2026-03", pendingAmount: 45000.12, pendingAmountEffectiveFrom: "2026-12" });
  assert.equal(one.dateJoined, "2026-03-02");
  assert.equal(one.birthDate, "1990-05-17");
  assert.equal(one.isFeatured, true);
  assert.equal(one.isNew, false);
  assert.equal(byId(students, "stu-3").statusChangeDate, "2026-09-20");
  assert.equal(byId(students, "stu-3").lastReactivatedAt, "2026-02-01");
  assert.ok(report.conversions.some((c) => c.code === "date_to_civil_day"));
});

test("fechas: un instante de la noche argentina es del mismo día civil; medianoche UTC se toma como fecha sin hora; una clave de fecha no cambia", () => {
  assert.equal(toCivilDateKey("2026-03-03T01:30:00.000Z"), "2026-03-02", "22:30 en Buenos Aires");
  assert.equal(toCivilDateKey("2026-03-02T03:00:00.000Z"), "2026-03-02", "medianoche en Buenos Aires");
  assert.equal(toCivilDateKey("2000-01-01T00:00:00.000Z"), "2000-01-01", "medianoche UTC: fecha sin hora");
  assert.equal(toCivilDateKey("2026-10-05"), "2026-10-05");
  assert.equal(toCivilDateKey("no es una fecha"), null);
  assert.equal(toCivilDateKey(null), null);
});

test("alumno sin ficha: no se inventa (categoría, tipo de cobro y fecha de alta); queda listado como omitido con su id", () => {
  const source = buildMobileBackup();
  delete (source.profiles as Row)["stu-4"];
  const { payload, report } = adaptMobileBackup(source);
  assert.equal(rows(payload, "students").length, 3);
  assert.deepEqual(report.omitted.map((o) => [o.collection, o.id, o.code]), [["students", "stu-4", "student_without_profile"]]);
  assert.deepEqual(report.perCollection.students, { source: 4, adapted: 3, omitted: 1 });
});

test("ficha sin alumno en la lista: no se recrea un alumno posiblemente eliminado; queda declarada como omitida", () => {
  const source = buildMobileBackup();
  source.students = (source.students as Row[]).filter((s) => s.id !== "stu-4");
  const { payload, report } = adaptMobileBackup(source);
  assert.equal(rows(payload, "students").length, 3);
  assert.deepEqual(report.omitted.map((o) => [o.collection, o.id, o.code]), [["profiles", "stu-4", "profile_without_student"]]);
});

test("series: `recurrenceId`/`type`/`participantIds` pasan a `id`/`ruleType`/`participantStudentIds`; las semanas viajan tal cual", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const rules = rows(payload, "recurrenceRules");
  assert.equal(rules.length, 3);
  const two = byId(rules, "rule-2");
  assert.equal(two.primaryStudentId, "stu-3");
  assert.equal(two.ruleType, "custom");
  assert.deepEqual(two.participantStudentIds, ["stu-3"]);
  assert.equal(two.supersedesRecurrenceId, "rule-0");
  assert.equal(two.trainingBillingAgreementId, "agr-1");
  assert.equal(two.activityKind, "training");
  assert.deepEqual(two.weeks, (buildMobileBackup().recurrenceRules as Row[])[1].weeks, "el motor de series lee `sessions`: no se reescribe");
  assert.equal(byId(rules, "rule-0").supersededByRecurrenceId, "rule-2");
});

test("clases de calendario: `studentId`/`start`/`end` pasan a `primaryStudentId`/`startAt`/`endAt`; participantes y ajustes se conservan", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const lessons = rows(payload, "calendarLessons");
  assert.equal(lessons.length, 6);
  const group = byId(lessons, "cal-4");
  assert.equal(group.primaryStudentId, "stu-2");
  assert.equal(group.startAt, "2026-10-14T20:00:00.000Z");
  assert.equal(group.endAt, "2026-10-14T21:30:00.000Z");
  assert.equal((group.participants as Row[]).length, 2);
  assert.equal(group.overlapGroupId, "ovl-ZQ-1");
  assert.equal(byId(lessons, "cal-3").freedByLessonId, "cal-2");
  assert.deepEqual(byId(lessons, "cal-3").scheduleAdjustment, { direction: "delayed", minutes: 15, reason: "mutual_agreement", adjustedAt: "2026-10-16T13:50:00.000Z" });
  assert.equal(byId(lessons, "cal-1").recurrenceId, "rule-1");
  assert.equal(byId(lessons, "cal-1").recurrenceOccurrenceKey, "rule-1:2026-10-13:0");
});

test("excepciones: `type` pasa a `exceptionType` y el reemplazo se conserva", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const exceptions = rows(payload, "recurrenceExceptions");
  assert.deepEqual(exceptions.map((e) => e.exceptionType), ["cancelled", "rescheduled", "excluded"]);
  assert.equal(exceptions[1].replacementLessonId, "cal-5");
});

test("filas sin identificador, repetidas o sin alumno principal: no se importan y quedan listadas (nada se descarta en silencio)", () => {
  const source = buildMobileBackup();
  (source.recurrenceRules as Row[]).push({ studentId: "stu-1", type: "weekly" });
  (source.recurrenceRules as Row[]).push({ ...(source.recurrenceRules as Row[])[0] });
  (source.calendarLessons as Row[]).push({ ...(source.calendarLessons as Row[])[0], id: "cal-sin-alumno", studentId: "" });
  (source.paymentCharges as Row[]).push({ type: "mensual" });
  const { report } = adaptMobileBackup(source);
  const codes = report.omitted.map((o) => `${o.collection}:${o.code}`).sort();
  assert.deepEqual(codes, ["calendarLessons:missing_primary_student", "paymentCharges:missing_id", "recurrenceRules:duplicate_id", "recurrenceRules:missing_id"]);
});

test("clases registradas: el `form` anidado se convierte en registro, asistencia, evaluaciones y revisiones, con su contenido propio (sin `_src`)", () => {
  const source = buildMobileBackup();
  const { payload } = adaptMobileBackup(source);
  const regs = rows(payload, "pedagogicalLessons");
  assert.equal(regs.length, 9);
  const first = byId(regs, "les-1");
  assert.equal(first.calendarLessonId, "cal-1");
  assert.equal(first.outcome, "clase_dictada");
  assert.equal(first.homeworkDescription, "ZQ tarea común");
  assert.equal(first.homeworkDueDate, "2026-10-20");
  assert.equal(first.billedAmount, 9000.61);
  assert.equal(first.scheduledStartAt, "2026-10-13T13:00:00.000Z");
  assert.equal(first.actualStartedAt, "2026-10-13T13:02:00.000Z");
  assert.deepEqual(first.roster, [{ studentId: "stu-1" }]);
  assert.deepEqual(first.attendance, [{ studentId: "stu-1", status: "presente", lateMinutes: null }]);
  const evaluation = (first.evaluations as Row[])[0];
  assert.equal(evaluation.generalGrade, 8.5);
  assert.deepEqual(evaluation.skillGrades, { speaking: 8.5, grammar: 7.5 });
  assert.equal(evaluation.billedAmount, 9000.61, "el importe por alumno sale de billedAmountByStudent");
  assert.equal(evaluation.individualHomeworkDueDate, "2026-10-20");
  assert.deepEqual(first.homeworkReviews, [{ taskId: "common:les-0", studentId: "stu-1", outcome: "parcial", reviewedAt: "2026-10-13T14:10:00.000Z" }]);
  assert.equal("_src" in first, false, "ya no se duplica el objeto original: cada campo tiene su destino");
  assert.deepEqual(first.topics, [{ id: "top-1", text: "ZQ tema visto uno", status: "visto" }, { id: "top-2", text: "ZQ tema planificado dos", status: "planificado" }]);
  assert.deepEqual(first.objectives, ["ZQ objetivo de la clase"]);
  assert.deepEqual(first.activities, ["ZQ actividad uno"]);
  assert.equal(first.activityNotes, "ZQ notas de actividades");
  assert.equal(first.internalNotes, "ZQ notas internas de la clase");
  assert.deepEqual(first.materialIds, ["mat-1"]);
  assert.equal(first.createdAt, "2026-10-13T14:20:00.000Z");
  assert.equal(first.updatedAt, "2026-10-13T14:30:00.000Z");
  assert.equal(first.registrationStatus, "completed");
  assert.deepEqual((first.attachments as Row[])[0], { id: "les-1:att-1", sourceAttachmentId: "att-1", name: "ZQ guia.pdf", kind: "pdf", mimeType: "application/pdf", sizeBytes: 20480, caption: "ZQ leyenda", addedAt: "2026-10-13T14:00:00.000Z", studentId: "stu-1", sourceUri: "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf" });
  assert.equal((first.editHistory as Row[]).length, 1);
  assert.deepEqual(first.sourceExtras, {
    calendarReservationKey: "rule-1:2026-10-13:0", profileAppliedAt: "2026-10-13T14:21:00.000Z", effectiveStartAt: "2026-10-13T13:00:00.000Z", startSource: "button", endSource: "button",
    sessionUpdatedAt: "2026-10-13T14:12:00.000Z", scheduleAdjustment: (source.pedagogicalLessons as Row[])[0].scheduleAdjustment, studentArrival: (source.pedagogicalLessons as Row[])[0].studentArrival,
    calendarRegistration: (source.pedagogicalLessons as Row[])[0].calendarRegistration, appliedPolicy: null, billedAmountByStudent: { "stu-1": 9000.61 }, formDate: (((source.pedagogicalLessons as Row[])[0].form) as Row).date, formTime: (((source.pedagogicalLessons as Row[])[0].form) as Row).time,
  });
  const group = byId(regs, "les-2");
  assert.deepEqual(group.attendance, [{ studentId: "stu-2", status: "tarde", lateMinutes: 7 }, { studentId: "stu-3", status: "ausente_aviso", lateMinutes: null }]);
  assert.equal(((group.evaluations as Row[])[0]).generalGrade, null);
});

test("registro grupal: «a medio completar» queda EN CURSO con el estado y el orden de cada participante; uno finalizado deja a todos «completados»", () => {
  const { payload, report } = adaptMobileBackup(buildMobileBackup());
  const regs = rows(payload, "pedagogicalLessons");
  const partial = byId(regs, "les-2");
  assert.equal(partial.registrationStatus, "in_progress");
  assert.deepEqual(partial.participantProgress, [{ studentId: "stu-2", status: "completed", position: 0 }, { studentId: "stu-3", status: "pending", position: 1 }]);
  const done = byId(regs, "les-9");
  assert.equal(done.registrationStatus, "completed");
  assert.deepEqual((done.participantProgress as Row[]).map((p) => p.status), ["completed", "completed"]);
  assert.deepEqual((byId(regs, "les-1").participantProgress as Row[]).map((p) => p.status), ["completed"]);
  assert.ok(report.conversions.some((c) => c.code === "partial_group_registration_kept_in_progress" && c.count === 1));
});

test("resultado «alumno ausente»: la web no lo tiene; se guarda como clase dictada con asistencia «ausente» y se declara", () => {
  const { payload, report } = adaptMobileBackup(buildMobileBackup());
  const absent = byId(rows(payload, "pedagogicalLessons"), "les-3");
  assert.equal(absent.outcome, "clase_dictada");
  assert.deepEqual(absent.attendance, [{ studentId: "stu-3", status: "ausente", lateMinutes: null }]);
  assert.ok(report.conversions.some((c) => c.code === "student_absent_event_to_attendance" && c.count === 1));
});

test("cancelada tarde / reprogramada / ausencia de la profesora / feriado: resultado, política y vínculo se conservan", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const regs = rows(payload, "pedagogicalLessons");
  const late = byId(regs, "les-4");
  assert.equal(late.outcome, "cancelada_tarde");
  assert.equal(late.lateCancellationPolicy, "cobrar_porcentaje");
  assert.equal(late.lateCancellationPercentage, 50);
  assert.equal(byId(regs, "les-5").outcome, "reprogramada");
  assert.equal(byId(regs, "les-5").rescheduledFromRegistrationId, "les-4");
  assert.equal(byId(regs, "les-6").outcome, "profesora_ausente");
  assert.equal(byId(regs, "les-7").outcome, "feriado");
  assert.equal(byId(regs, "les-7").holidayException, true);
  // la política sólo vale para «cancelada tarde» (la base lo exige)
  assert.equal(byId(regs, "les-1").lateCancellationPolicy, null);
});

test("horas de una clase dictada sin horas reales guardadas: se derivan del horario y la duración real, y se declara", () => {
  const source = buildMobileBackup();
  const lesson = (source.pedagogicalLessons as Row[])[1];
  const { payload, report } = adaptMobileBackup(source);
  const adapted = byId(rows(payload, "pedagogicalLessons"), lesson.id as string);
  assert.equal(adapted.actualStartedAt, "2026-10-14T20:00:00.000Z");
  assert.equal(adapted.actualEndedAt, "2026-10-14T21:30:00.000Z");
  assert.ok(report.conversions.some((c) => c.code === "actual_times_from_duration"));
});

test("clase registrada sin horario guardado: se arma con la fecha y la hora de la clase en horario de Argentina", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const absent = byId(rows(payload, "pedagogicalLessons"), "les-3");
  assert.equal(absent.scheduledStartAt, "2026-10-12T22:00:00.000Z", "19:00 en Buenos Aires = 22:00 UTC");
  assert.equal(absent.scheduledEndAt, "2026-10-12T23:00:00.000Z");
});

test("notas fuera de 1–10: la nota válida queda vacía PERO el valor original se conserva y se marca (no se pierde ni se da por bueno)", () => {
  const { payload, report } = adaptMobileBackup(buildMobileBackup());
  const evaluation = ((byId(rows(payload, "pedagogicalLessons"), "les-8").evaluations as Row[])[0]);
  assert.equal(evaluation.generalGrade, null);
  assert.deepEqual(evaluation.skillGrades, { writing: 7.5 }, "sólo lo que está en 1–10 y es una habilidad conocida");
  assert.deepEqual(evaluation.sourceGrades, {
    generalGrade: 12,
    skillGrades: { speaking: 0, grammar: 11, writing: 7.5, listening: "ocho" },
    flags: ["generalGrade:out_of_range", "skillGrades.speaking:unset", "skillGrades.grammar:out_of_range", "skillGrades.listening:out_of_range"],
  });
  assert.ok(report.conversions.some((c) => c.code === "grade_kept_as_source_value"));
  const ok = ((byId(rows(payload, "pedagogicalLessons"), "les-1").evaluations as Row[])[0]);
  assert.deepEqual((ok.sourceGrades as Row).flags, [], "una nota válida no se marca");
  assert.equal((ok.sourceGrades as Row).generalGrade, 8.5);
});

test("cobros, pagos y paquetes: `type` pasa a `chargeType`/`movementType`; fechas, anulaciones y vínculos se conservan", () => {
  const { payload } = adaptMobileBackup(buildMobileBackup());
  const charge = byId(rows(payload, "paymentCharges"), "chg-1");
  assert.equal(charge.chargeType, "mensual");
  assert.equal(charge.dueDate, "2026-10-10");
  assert.equal(charge.billingPeriod, "2026-10");
  assert.equal(byId(rows(payload, "paymentCharges"), "chg-5").voidReason, "ZQ cobro cargado por error");
  assert.equal(byId(rows(payload, "paymentCharges"), "chg-2").savedLessonId, "les-2");
  assert.equal(byId(rows(payload, "paymentCharges"), "chg-4").trainingSeriesName, "ZQ Entrenamiento");
  const payment = byId(rows(payload, "payments"), "pay-4");
  assert.equal(payment.replacesPaymentId, "pay-3");
  assert.equal(payment.recordedAt, "2026-10-09T15:05:00.000Z");
  assert.equal(byId(rows(payload, "payments"), "pay-3").source, "initial_student_setup");
  assert.equal(byId(rows(payload, "packageCreditMovements"), "mov-1").movementType, "consumo");
  assert.equal(byId(rows(payload, "packageCreditMovements"), "mov-2").reason, "ZQ ajuste manual de paquete");
  assert.equal(byId(rows(payload, "packagePurchases"), "pkg-1").validUntil, "2026-12-31");
});

test("historial de niveles: las entradas sin identificador reciben uno determinístico (mismo respaldo, mismos identificadores)", () => {
  const a = adaptMobileBackup(buildMobileBackup()).payload.profiles as Record<string, Row>;
  const b = adaptMobileBackup(buildMobileBackup()).payload.profiles as Record<string, Row>;
  const history = a["stu-1"].levelHistory as Row[];
  assert.equal(history[0].id, "lvl-1", "la que ya tenía identificador no cambia");
  assert.match(String(history[1].id), /^lvl_[0-9a-f]{8}$/);
  assert.deepEqual(history.map((e) => e.id), (b["stu-1"].levelHistory as Row[]).map((e) => e.id));
  assert.equal(stableHash("a"), stableHash("a"));
  assert.notEqual(stableHash("a"), stableHash("b"));
});

test("historiales de estado y de precio: la entrada original viaja con cada una y las inválidas NO se pierden (quedan en la ficha del alumno)", () => {
  const source = buildMobileBackup();
  const profile = (source.profiles as Record<string, Row>)["stu-1"];
  (profile.statusHistory as Row[]).push({ status: "inventado", date: "2026-03-01" }, { status: "activo", date: "no-fecha" });
  (profile.priceHistory as Row[]).push({ price: -5, date: "2026-03-01" });
  const { payload, report } = adaptMobileBackup(source);
  const adapted = (payload.profiles as Record<string, Row>)["stu-1"];
  assert.deepEqual((adapted.statusHistory as Row[]).map((e) => [e.status, e.date, e.reason, e.internalNote]), [["activo", "2026-03-02", "ZQ alta", "ZQ nota interna de estado"]]);
  assert.deepEqual(((adapted.statusHistory as Row[])[0]).sourceEntry, ((source.profiles as Record<string, Row>)["stu-1"].statusHistory as Row[])[0], "la entrada ORIGINAL (con la hora) viaja junto a la fecha civil");
  assert.deepEqual((adapted.priceHistory as Row[]).map((e) => e.date), ["2026-03-02", "2026-08-01"]);
  assert.equal(report.omitted.filter((o) => o.code === "invalid_history_entry").length, 0, "no son omisiones: no se pierden");
  const student = byId(rows(payload, "students"), "stu-1");
  assert.deepEqual((student.sourceExtras as Row).invalidHistory, {
    statusHistory: [{ status: "inventado", date: "2026-03-01" }, { status: "activo", date: "no-fecha" }],
    priceHistory: [{ price: -5, date: "2026-03-01" }],
  });
  assert.ok(report.conversions.some((c) => c.code === "invalid_history_entry_kept" && c.count === 3));
});

test("correcciones de importe mensual: el cambio programado sólo admite «este mes» o «el próximo»", () => {
  const source = buildMobileBackup();
  (source.monthlyAmountCorrections as Row[])[0].effectiveFrom = "otro";
  const { payload } = adaptMobileBackup(source);
  assert.equal(rows(payload, "monthlyAmountCorrections")[0].effectiveFrom, null);
});

test("cada dato del origen tiene destino: los datos calculados de la ficha y los campos desconocidos se conservan y se cuentan", () => {
  const { payload, report } = adaptMobileBackup(buildMobileBackup());
  assert.deepEqual(report.notRepresented, [], "con el fixture completo no queda ningún campo sin destino");
  const stu1 = byId(rows(payload, "students"), "stu-1");
  assert.equal(((stu1.sourceExtras as Row).profile as Row).totalClasses !== undefined, true, "totales calculados por la app");
  assert.equal(((stu1.sourceExtras as Row).card as Row).paymentStatus !== undefined, true, "etiquetas de la tarjeta de la lista");

  const source = buildMobileBackup();
  ((source.pedagogicalLessons as Row[])[0] as Row).campoNuevo = "ZQ nuevo";
  (((source.pedagogicalLessons as Row[])[0].form) as Row).otroCampoNuevo = { a: 1 };
  const again = adaptMobileBackup(source);
  assert.deepEqual(again.report.notRepresented.map((n) => [n.collection, n.field, n.rows]).sort(), [["pedagogicalLessons", "campoNuevo", 1], ["pedagogicalLessons", "form.otroCampoNuevo", 1]]);
  const first = byId(rows(again.payload, "pedagogicalLessons"), "les-1");
  assert.deepEqual(((first.sourceExtras as Row).unknown as Row), { campoNuevo: "ZQ nuevo", "form.otroCampoNuevo": { a: 1 } });
});

test("reportes: el snapshot convertido tiene EXACTAMENTE la forma que la web usa para volver a generar el PDF (mismas claves que buildStudentReportData)", async () => {
  const { buildStudentReportData } = await import("../../reports/student-report-data.ts");
  const reference = buildStudentReportData([]) as unknown as Row;
  const snap = (rows(adaptMobileBackup(buildMobileBackup()).payload, "reportRecords")[0].snapshot) as Row;
  const data = snap.data as Row;
  assert.deepEqual(Object.keys(data).sort(), Object.keys(reference).sort());
  assert.deepEqual(Object.keys(data.attendance as Row).sort(), Object.keys(reference.attendance as Row).sort());
  assert.deepEqual(Object.keys(data.punctuality as Row).sort(), Object.keys(reference.punctuality as Row).sort());
  for (const key of ["narrativeText", "includeClassDetail", "includePunctualitySummary", "teacherNotes", "studentName", "monthsSummaryLabel"]) assert.ok(key in snap, key);
  assert.deepEqual(Object.keys(snap.teacherNotes as Row).sort(), ["behaviorAndParticipation", "generalComment", "nextObjectives", "recommendations"]);
});

test("reportes: el snapshot de la app se pasa al formato de la web y el registro original queda completo adentro", () => {
  const source = buildMobileBackup();
  const { payload, report } = adaptMobileBackup(source);
  const rep = rows(payload, "reportRecords")[0];
  assert.equal(rep.id, "rep-1");
  assert.equal(rep.generatedAt, "2026-10-01T12:00:00.000Z");
  const snap = rep.snapshot as Row;
  assert.equal(((snap.data as Row).attendance as Row).classesHeld, 8);
  assert.equal(snap.narrativeText, "ZQ narrativa del reporte");
  assert.equal(snap.studentName, "ZQ Alumna Uno");
  assert.deepEqual(((snap._mobileRecord as Row).snapshot), ((source.reportRecords as Row[])[0].snapshot));
  assert.equal((snap._mobileRecord as Row).permanentPdfUri, "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf");
  assert.ok(report.conversions.some((c) => c.code === "snapshot_to_web_format"));
  const orphan = buildMobileBackup();
  (orphan.reportRecords as Row[])[0].studentId = "stu-fantasma";
  assert.deepEqual(adaptMobileBackup(orphan).report.omitted.map((o) => [o.collection, o.id, o.code]), [["reportRecords", "rep-1", "report_without_student"]]);
});

test("idempotente: adaptar lo ya adaptado no cambia nada, y un documento ya en formato de la web pasa tal cual", () => {
  const once = adaptMobileBackup(buildMobileBackup());
  const twice = adaptMobileBackup(clone(once.payload));
  assert.equal(twice.report.shape, "canonical");
  assert.deepEqual(twice.payload, once.payload);

  const canonical = {
    schemaVersion: 2, exportedAt: "2026-10-01T00:00:00.000Z", appVersion: "1", students: [], profiles: {}, pedagogicalLessons: [], calendarLessons: [], recurrenceRules: [{ id: "r1", primaryStudentId: null, ruleType: "weekly" }],
    recurrenceExceptions: [], teacherAvailability: null, paymentCharges: [{ id: "c1", chargeType: "mensual" }], payments: [], paymentAllocations: [], paymentAdjustments: [],
  };
  const result = adaptMobileBackup(clone(canonical));
  assert.equal(result.report.shape, "canonical");
  assert.deepEqual(result.payload, canonical);
});

test("una colección ausente sigue ausente (la validación la señala) y una clave desconocida se lista", () => {
  const source = buildMobileBackup();
  delete source.students;
  source.coleccionNueva = [{ x: 1 }];
  const { payload, report } = adaptMobileBackup(source);
  assert.equal("students" in payload, false);
  assert.ok(report.omitted.some((o) => o.code === "unknown_top_level_key" && o.id === "coleccionNueva"));
  const validation = validateBackupPayload(source);
  assert.equal(validation.ok, false);
});

test("el informe nunca copia datos personales: sólo identificadores, códigos, textos fijos y cantidades", () => {
  const { report } = adaptMobileBackup(buildMobileBackup());
  const text = JSON.stringify(report);
  for (const secret of ["ZQ Alumna Uno", "zq.uno@example.invalid", "5550-0001", "ZQ nota privada", "ZQ tema visto uno", "ZQ notas internas"]) assert.equal(text.includes(secret), false, secret);
});

test("el aviso al usuario por filas omitidas sólo lleva cantidades (sin nombres, ids ni códigos internos)", async () => {
  const { translateAdaptationOmitted } = await import("../import-copy.ts");
  const one = translateAdaptationOmitted(1);
  const many = translateAdaptationOmitted(1234);
  assert.match(one.message, /^Hay 1 dato /);
  assert.match(many.message, /^Hay 1\.234 datos /);
  for (const text of [one.message, many.message]) {
    assert.match(text, /No se cambió nada/);
    assert.doesNotMatch(text, /stu-|student_without_profile|legacy|payload|JSON/i);
  }
});

test("cierre del traslado: el rechazo de la base se muestra en lenguaje simple (sin «app», códigos ni nombres internos)", async () => {
  const { translateImportError } = await import("../import-copy.ts");
  const translated = translateImportError("El traslado desde la app anterior ya se cerró: la web es la única fuente de datos. Para importar otra copia hay que reabrirlo explícitamente.", "analyze");
  assert.equal(translated.code, "transfer_closed");
  assert.match(translated.message, /^El traslado de tus datos anteriores ya se cerró/);
  assert.doesNotMatch(translated.message, /\bapp\b|aplicación|móvil|celular|P0001|trigger|public\./i);
});
