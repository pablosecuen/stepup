// R6 — Escenarios SINTÉTICOS compartidos por la prueba diferencial (anterior vs. nuevo) y por la batería de la importación nueva.
// Siembran datos web con ids deterministas (mismas filas en ambas bases) y devuelven el respaldo + las decisiones a tomar.
const { generateBackup, emptyBackup, student } = require("./r6_dataset.cjs");

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FIXED = "2026-01-01T00:00:00+00";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
function seedStudent({ n, legacy = null, name, email = null, phone = null, notes = null }) {
  return `insert into public.students (id, owner_id, legacy_mobile_id, name, phone, email, notes, usual_days, usual_time, levels, initial_level, modality, status, category, billing_type, date_joined, usual_duration_minutes, weekly_frequency, price, created_at, updated_at)
          values ('${uuid(n)}', '${OWNER}', ${legacy ? q(legacy) : "null"}, ${q(name)}, ${phone ? q(phone) : "null"}, ${email ? q(email) : "null"}, ${notes ? q(notes) : "null"}, array['lunes']::text[], '18:00', array['A1']::text[], 'A1', 'online', 'activo', 'adulto_interes_personal', 'mensual', '2025-01-10', 60, 1, 1000, '${FIXED}', '${FIXED}')`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------------------------------------------------
function scenarioDuplicatesAndConflicts() {
  const b = emptyBackup();
  b.students = [
    student("st_eq", { name: "Igual Uno", email: "igual@ejemplo.invalid" }),
    student("st_conf1", { name: "Nombre Backup", phone: "+5491111111" }),
    student("st_conf2", { name: "Conflicto Dos", notes: "nota del backup" }),
    student("st_dup_name", { name: "María Prueba" }),
    student("st_dup_email", { name: "Otro Nombre Email", email: "Dup@Ejemplo.invalid" }),
    student("st_dup_phone", { name: "Otro Nombre Tel", phone: "+54 9 11 2222-3333" }),
    student("st_dup_skip", { name: "Para Omitir" }),
    student("st_new1", { name: "Nuevo Uno", email: "nuevo1@ejemplo.invalid" }),
    student("st_new2", { name: "Nuevo Dos", phone: "+5491133334444" }),
    student("st_new3", { name: "Nuevo Tres" }),
  ];
  b.profiles = { st_new1: { id: "st_new1", levelHistory: [] } };
  b.customLevels = [{ id: "cv_eq", name: "Nivel igual", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_conf", name: "Nivel backup", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_new", name: "Nivel nuevo", createdAt: "2025-01-02T00:00:00.000Z" }];
  b.trainingBillingAgreements = [{ id: "ta_exist", monthlyFee: 5000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null, startPeriod: "2025-01" }, { id: "ta_new", monthlyFee: 7000, pendingMonthlyFee: 8000, pendingMonthlyFeeEffectiveFrom: "2025-09", startPeriod: "2025-02" }];
  const rule = (id, extra) => ({ id, primaryStudentId: "st_new1", ruleType: "weekly", cycleLengthWeeks: 1, weeks: [], modality: "online", timezone: "UTC", startDate: "2025-02-03", endDate: null, status: "active", supersedesRecurrenceId: null, supersededByRecurrenceId: null, effectiveFromDate: "2025-02-03", classTitle: null, activityKind: "class", trainingBillingAgreementId: null, participantStudentIds: ["st_new1", "st_new2"], ...extra });
  b.recurrenceRules = [rule("rr_exist"), rule("rr_new1"), rule("rr_dupref", { primaryStudentId: "st_dup_name" }), rule("rr_badagr", { trainingBillingAgreementId: "ta_missing" }), rule("rr_okagr", { trainingBillingAgreementId: "ta_exist" })];
  const lesson = (id, extra) => ({ id, primaryStudentId: "st_new1", studentName: "x", level: "A1", lessonType: "individual", startAt: "2025-03-03T10:00:00.000Z", endAt: "2025-03-03T11:00:00.000Z", modality: "online", status: "scheduled", color: "#DDEEFF", overlapAllowed: false, notes: null, isRecurring: false, recurrenceId: null, recurrenceOccurrenceKey: null, recurrenceIndex: null, recurrenceOriginalStart: null, scheduleAdjustment: null, classTitle: null, freedByLessonId: null, activityKind: "class", participants: [{ studentId: "st_new1", studentName: "x", level: "A1" }, { studentId: "st_new2", studentName: "y", level: "A1" }, { studentId: "st_unknown", studentName: "z", level: "A1" }], ...extra });
  b.calendarLessons = [lesson("cl_exist"), lesson("cl_new1"), lesson("cl_badstu", { primaryStudentId: "st_unknown" }), lesson("cl_recweb", { recurrenceId: "rr_exist", isRecurring: true, recurrenceOccurrenceKey: "k1", recurrenceIndex: 1 }), lesson("cl_recnew", { recurrenceId: "rr_new1", isRecurring: true, recurrenceOccurrenceKey: "k2", recurrenceIndex: 2 })];
  b.recurrenceExceptions = [{ recurrenceId: "rr_new1", occurrenceKey: "ex1", exceptionType: "cancelled", replacementLessonId: null }, { recurrenceId: "rr_exist", occurrenceKey: "ex2", exceptionType: "cancelled", replacementLessonId: null }, { recurrenceId: "rr_new1", occurrenceKey: "ex1", exceptionType: "excluded", replacementLessonId: "cl_new1" }];
  const reg = (id, extra) => ({ id, calendarLessonId: null, activityKind: "class", countsAsClass: true, homeworkDescription: "tarea", homeworkDueDate: "2025-03-10", billedAmount: 1000, scheduledStartAt: "2025-03-03T10:00:00.000Z", actualStartedAt: "2025-03-03T10:00:00.000Z", actualEndedAt: "2025-03-03T11:00:00.000Z", outcome: "clase_dictada", holidayException: false, modality: "online", scheduledEndAt: "2025-03-03T11:00:00.000Z", lateCancellationPolicy: null, lateCancellationPercentage: null, rescheduledFromRegistrationId: null, roster: [{ studentId: "st_new1" }, { studentId: "st_new2" }, { studentId: "st_new1" }], attendance: [{ studentId: "st_new1", status: "tarde", lateMinutes: 5 }], evaluations: [{ studentId: "st_new1", generalGrade: 9, skillGrades: { speaking: 9 }, strengths: ["a"], areasToImprove: ["b"], individualObservation: "obs", individualHomeworkDescription: null, individualHomeworkDueDate: null, billedAmount: 500 }], homeworkReviews: [{ studentId: "st_new1", taskId: "t1", outcome: "realizada", reviewedAt: "2025-03-04T10:00:00.000Z" }, { studentId: "st_new1", taskId: "t1", outcome: "parcial", reviewedAt: "2025-03-05T10:00:00.000Z" }], ...extra });
  b.pedagogicalLessons = [reg("pl_new"), reg("pl_clweb", { calendarLessonId: "cl_exist" }), reg("pl_badroster", { roster: [{ studentId: "st_unknown" }] }), reg("pl_exist"), reg("pl_clnew", { calendarLessonId: "cl_new1" })];
  const charge = (id, extra) => ({ id, studentId: "st_new1", chargeType: "mensual", originalAmount: 1000, currency: "ARS", dueDate: "2025-04-10", billingPeriod: "2025-04", savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, voidedAt: null, voidReason: null, ...extra });
  const pay = (id, extra) => ({ id, studentId: "st_new1", amount: 1000, currency: "ARS", method: "efectivo", paidAt: "2025-04-12", notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, source: null, ...extra });
  b.paymentCharges = [charge("ch_ok", { billingPeriod: "2025-04" }), charge("ch_inweb_pay", { studentId: "st_new2", billingPeriod: "2025-04" }), charge("ch_missing_pay", { studentId: "st_new3", billingPeriod: "2025-04" }), charge("ch_pkg", { chargeType: "paquete", packageId: "pk1", billingPeriod: "2025-05" }), charge("ch_badagr", { studentId: "st_new2", billingPeriod: "2025-06", trainingBillingAgreementId: "ta_missing" }), charge("ch_agr_ok", { studentId: "st_new3", billingPeriod: "2025-07", trainingBillingAgreementId: "ta_new" }), charge("ch_clnew", { studentId: "st_new2", billingPeriod: "2025-08", calendarLessonId: "cl_new1" })];
  b.payments = [pay("pa_ok"), pay("pa_inweb", { studentId: "st_new2" }), pay("pa_repl", { replacesPaymentId: "pa_ok" }), pay("pa_pkg", { amount: 2000 }), pay("pa_badstu", { studentId: "st_unknown" })];
  const al = (id, p, c, s, amount) => ({ id, paymentId: p, chargeId: c, studentId: s, amount });
  b.paymentAllocations = [al("al_ok", "pa_ok", "ch_ok", "st_new1", 1000), al("al_inweb", "pa_inweb", "ch_inweb_pay", "st_new2", 1000), al("al_missing", "pa_NOEXISTE", "ch_missing_pay", "st_new3", 1000), al("al_pkg", "pa_pkg", "ch_pkg", "st_new1", 1000)];
  b.paymentAdjustments = [{ id: "aj_ok", chargeId: "ch_ok", studentId: "st_new1", reason: "ajuste", voidedAt: null, voidReason: null }];
  b.packagePurchases = [{ id: "pk1", studentId: "st_new1", includedClasses: 10, amount: 10000, validFrom: "2025-01-01", validUntil: "2025-12-31", voidedAt: null, voidReason: null }];
  b.packageCreditMovements = [{ id: "pm1", packageId: "pk1", studentId: "st_new1", movementType: "ajuste_manual", amount: 2, savedLessonId: "pl_new", reason: "r", voidedAt: null, voidReason: null }];
  b.firstMonthProrationDecisions = [{ id: "fm1", studentId: "st_new1", billingPeriod: "2025-04", effectiveJoinDate: "2025-04-15", criterion: "proportional", classesRemaining: 2, classesPerFullPeriod: 4, permanentMonthlyAmount: 1000, chargedAmount: 500, chargeId: "ch_ok", confirmedAt: "2025-04-15T10:00:00.000Z", source: "manual" }];
  b.initialPaidSurchargeCorrections = [{ id: "ip1", studentId: "st_new1", billingPeriod: "2025-04", previousSurchargeAmount: 0, voidedPaymentId: "pa_ok", newPaymentId: "pa_repl", correctedAt: "2025-04-20T10:00:00.000Z", reason: "r" }];
  const seed = [
    seedStudent({ n: 1, legacy: "st_eq", name: "Igual Uno", email: "igual@ejemplo.invalid" }),
    seedStudent({ n: 2, legacy: "st_conf1", name: "Nombre Web", phone: "+5490000000" }),
    seedStudent({ n: 3, legacy: "st_conf2", name: "Conflicto Dos", notes: "nota web" }),
    seedStudent({ n: 4, name: "  maría PRUEBA " }),
    seedStudent({ n: 5, name: "Persona Distinta", email: "dup@ejemplo.invalid" }),
    seedStudent({ n: 6, name: "Persona Tres", phone: "+5491122223333" }),
    seedStudent({ n: 7, name: "para omitir" }),
    `insert into public.custom_levels (id, owner_id, legacy_mobile_id, name, created_at) values ('${uuid(20)}', '${OWNER}', 'cv_eq', 'Nivel igual', '${FIXED}'), ('${uuid(21)}', '${OWNER}', 'cv_conf', 'Nivel web', '${FIXED}')`,
    `insert into public.training_billing_agreements (id, owner_id, legacy_mobile_id, monthly_fee, start_period, created_at) values ('${uuid(30)}', '${OWNER}', 'ta_exist', 5000, '2025-01', '${FIXED}')`,
    `insert into public.recurrence_rules (id, owner_id, legacy_mobile_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status, activity_kind, created_at) values ('${uuid(40)}', '${OWNER}', 'rr_exist', 'weekly', 1, '[]', 'online', 'UTC', '2025-02-03', 'active', 'class', '${FIXED}')`,
    `insert into public.calendar_lessons (id, owner_id, legacy_mobile_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind, created_at) values ('${uuid(50)}', '${OWNER}', 'cl_exist', '${uuid(1)}', 'x', 'A1', 'individual', '2025-03-03T10:00:00Z', '2025-03-03T11:00:00Z', 'online', 'scheduled', '#fff', 'class', '${FIXED}')`,
    `insert into public.lesson_registrations (id, owner_id, legacy_mobile_id, activity_kind, counts_as_class, outcome, holiday_exception, created_at) values ('${uuid(60)}', '${OWNER}', 'pl_exist', 'class', true, 'clase_dictada', false, '${FIXED}')`,
    `insert into public.payments (id, owner_id, legacy_mobile_id, student_id, amount, currency, method, paid_at, created_at) values ('${uuid(70)}', '${OWNER}', 'pa_inweb', '${uuid(1)}', 1000, 'ARS', 'efectivo', '2025-04-12', '${FIXED}')`,
  ];
  return {
    name: "duplicados_conflictos_referencias_rotas", backup: b, seed, links: true,
    decide: (c) => ({
      overrides: [
        ...c.maestros.students.conflicts.filter((x) => x.legacy_mobile_id === "st_conf1").map((x) => ({ table_name: "students", row_id: x.row_id, fields: ["name", "phone"] })),
        ...c.maestros.custom_levels.conflicts.map((x) => ({ table_name: "custom_levels", row_id: x.row_id, fields: ["name"] })),
      ],
      decisions: c.maestros.students.duplicates.map((d) => ({ backup_legacy_mobile_id: d.backup_legacy_mobile_id, decision: { st_dup_name: "link", st_dup_email: "create_separate" }[d.backup_legacy_mobile_id] || "skip", candidate_student_id: d.candidate_student_id })),
    }),
  };
}

function scenarioSingletons() {
  const b = emptyBackup();
  b.students = [student("st_s1", { name: "Solo Uno" })];
  b.teacherProfile = { displayName: "Prof Backup" };
  b.budgetDistribution = { distribution: { needs: 40, wants: 40, savings: 20 }, savingsGoal: { enabled: true, targetAmount: 5000, targetDate: "2026-12-31" } };
  b.teacherAvailability = { timezone: "America/Argentina/Buenos_Aires", weeklyBlocks: [{ id: "wb1", day: 1 }], exceptions: [] };
  b.surchargeSettings = { current: { enabled: true, graceDay: 5, firstLateDay: 10, firstLatePercentage: 5, secondLateDay: 15, secondLatePercentage: 10, lastLateDay: 20, lastLatePercentage: 15 }, pending: null, pendingEffectiveFrom: null };
  const seed = [
    `insert into public.teacher_profiles (owner_id, display_name) values ('${OWNER}', 'Prof Web')`,
    `insert into public.budget_distribution_settings (owner_id, needs_percent, wants_percent, savings_percent) values ('${OWNER}', 50, 30, 20)`,
  ];
  return { name: "singletons", backup: b, seed, links: false, // (Los reemplazos de porcentajes del presupuesto fallan en ambas versiones: cada campo se actualiza por separado y la suma deja de dar 100. Es un límite
  // previo de `_apply_singleton`, que R6 no toca: se documenta en docs/R6_IMPORTACIONES_GRANDES.md.)
  decide: (c) => ({ overrides: [{ table_name: "teacher_profiles", row_id: OWNER, fields: ["display_name"] }], decisions: [] }) };
}

function scenarioFromGenerator(name, n, opts = {}) {
  return { name, backup: generateBackup(n, { levelHistory: false, ...opts }), seed: [], links: opts.selfLinks !== false, decide: () => ({ overrides: [], decisions: [] }), undoComparable: opts.selfLinks === false };
}


module.exports = { OWNER, uuid, FIXED, q, seedStudent, scenarioDuplicatesAndConflicts, scenarioSingletons, scenarioFromGenerator };
