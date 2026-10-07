// R6 — Generador de respaldos SINTÉTICOS (formato móvil v2) para medir y probar importaciones grandes. Determinista (misma semilla → mismo respaldo).
// Nunca contiene datos reales: nombres «Alumno 000123», ids «<prefijo>_<tabla>_<n>».
//
// `n` = filas contadas por la validación (las 17 colecciones de `ARRAY_COLLECTIONS`, que es lo que mide MAX_ROWS_TOTAL). Además cada
// respaldo trae filas ANIDADAS que esa cuenta no ve (historial de niveles, integrantes, asistencias, evaluaciones, revisiones de tarea):
// `nestedRows(backup)` las suma y `workUnits(backup)` = contadas + anidadas.
const PROFILES = {
  // Mezcla realista de una cuenta grande (proporciones aproximadas de una profesora con muchos años de historia).
  mix: { students: 0.05, trainingBillingAgreements: 0.01, recurrenceRules: 0.03, calendarLessons: 0.28, recurrenceExceptions: 0.03, pedagogicalLessons: 0.15, paymentCharges: 0.15, payments: 0.12, paymentAllocations: 0.12, paymentAdjustments: 0.01, packagePurchases: 0.01, packageCreditMovements: 0.02, firstMonthProrationDecisions: 0.01, initialPaidSurchargeCorrections: 0.005, customLevels: 0.002 },
  // Muchos alumnos con muchas relaciones por alumno.
  students_heavy: { students: 0.25, trainingBillingAgreements: 0.02, recurrenceRules: 0.08, calendarLessons: 0.25, recurrenceExceptions: 0.02, pedagogicalLessons: 0.12, paymentCharges: 0.1, payments: 0.07, paymentAllocations: 0.07, paymentAdjustments: 0.005, packagePurchases: 0.01, packageCreditMovements: 0.01, firstMonthProrationDecisions: 0.005, initialPaidSurchargeCorrections: 0.002, customLevels: 0.001 },
  // Muchas filas ANIDADAS por clase y por registro (integrantes, asistencias, evaluaciones y revisiones de tarea de varios alumnos).
  nested_heavy: { students: 0.04, calendarLessons: 0.2, pedagogicalLessons: 0.5, paymentCharges: 0.04, payments: 0.03, paymentAllocations: 0.03, recurrenceRules: 0.02 },
  // Grafo financiero grande (cada pago se reparte entre varios cargos, pagos que reemplazan a otros).
  financial_heavy: { students: 0.03, calendarLessons: 0.05, pedagogicalLessons: 0.02, paymentCharges: 0.3, payments: 0.2, paymentAllocations: 0.3, paymentAdjustments: 0.05, packagePurchases: 0.02, packageCreditMovements: 0.02, firstMonthProrationDecisions: 0.01 },
};

function pad(n, w = 6) { return String(n).padStart(w, "0"); }

function generateBackup(n, { profile = "mix", prefix = "s", giantComponent = false, chainReplaces = false, levelHistory = true, selfLinks = true, brokenLinks = false, linked = brokenLinks, nested = 0 } = {}) {
  // `linked` (R6.1; antes `brokenLinks`): las clases pertenecen a series que ESTA copia agrega, los registros a clases que esta copia agrega y los cobros a registros y clases de la copia
  // (la cadena acuerdo → serie → clase → registro → cobro completa, sobre una cuenta vacía).
  const mix = PROFILES[profile];
  const cnt = {};
  for (const [k, v] of Object.entries(mix)) cnt[k] = Math.max(k === "students" ? 1 : 0, Math.round(n * v));
  const P = (t, i) => `${prefix}_${t}_${pad(i)}`;
  const S = cnt.students;
  const students = [];
  const profiles = {};
  for (let i = 0; i < S; i++) {
    const id = P("st", i);
    students.push({
      id, name: `Alumno ${pad(i)}`, phone: `+54911${pad(i, 8)}`, email: `alumno${pad(i)}@ejemplo.invalid`, usualDays: ["lunes", "miercoles"], usualTime: "18:00", notes: i % 7 === 0 ? `Nota ${pad(i)}` : null,
      birthDate: "2000-01-15", levels: ["A1", "A2"], initialLevel: "A1", modality: ["presencial", "online", "mixta"][i % 3], status: "activo", category: "adulto_interes_personal",
      billingType: i % 2 === 0 ? "mensual" : "por_clase", billingPlan: null, dateJoined: "2025-01-10", lastReactivatedAt: null, statusChangeDate: null, usualDurationMinutes: 60, weeklyFrequency: 1,
      price: 1000, pendingHomework: null, alerts: i % 5 === 0 ? ["alerta"] : [], currentGoals: ["meta 1"], strengths: ["fortaleza"], areasToImprove: ["mejora"], isFeatured: false, isNew: false,
    });
    profiles[id] = { id, levelHistory: !levelHistory ? [] : [{ id: P("lh", i), level: "A2", date: "2025-06-01", fromLevel: "A1", recordedAt: "2025-06-01T12:00:00.000Z", previousMilestoneAt: null, durationDays: 100, note: "n", origin: "manual" }], statusHistory: [], priceHistory: [] };
  }
  const sid = (i) => P("st", i % S);

  const trainingBillingAgreements = [];
  for (let i = 0; i < (cnt.trainingBillingAgreements || 0); i++) trainingBillingAgreements.push({ id: P("ta", i), monthlyFee: 5000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null, startPeriod: "2025-01" });

  const recurrenceRules = [];
  for (let i = 0; i < (cnt.recurrenceRules || 0); i++) {
    recurrenceRules.push({
      id: P("rr", i), primaryStudentId: sid(i), ruleType: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, days: [{ weekday: 1, startTime: "18:00", endTime: "19:00" }] }], modality: "online", timezone: "America/Argentina/Buenos_Aires",
      startDate: "2025-02-03", endDate: null, status: "active", supersedesRecurrenceId: selfLinks && i > 0 && i % 10 === 0 ? P("rr", i - 1) : null, supersededByRecurrenceId: null, effectiveFromDate: "2025-02-03", classTitle: null, activityKind: "class",
      trainingBillingAgreementId: trainingBillingAgreements.length && i % 4 === 0 ? P("ta", i % trainingBillingAgreements.length) : null, participantStudentIds: [sid(i), sid(i + 1)],
    });
  }

  const calendarLessons = [];
  for (let i = 0; i < (cnt.calendarLessons || 0); i++) {
    const day = 1 + (i % 28);
    const month = 1 + (Math.floor(i / 28) % 12);
    const start = `2025-${pad(month, 2)}-${pad(day, 2)}T${pad(8 + (i % 10), 2)}:00:00.000Z`;
    const end = `2025-${pad(month, 2)}-${pad(day, 2)}T${pad(9 + (i % 10), 2)}:00:00.000Z`;
    // Una clase que pertenece a una serie NUEVA de la misma copia se OMITE en la primera importación (la clasificación sólo reconoce series ya existentes
    // en la web): por defecto las clases son importables; `linked` arma la cadena completa dentro de la copia.
    const rid = linked && recurrenceRules.length && i % 3 === 0 ? P("rr", i % recurrenceRules.length) : null;
    calendarLessons.push({
      id: P("cl", i), primaryStudentId: sid(i), studentName: `Alumno ${pad(i % S)}`, level: "A1", lessonType: i % 6 === 0 ? "group" : "individual", startAt: start, endAt: end, modality: "online", status: i % 9 === 0 ? "cancelled" : "scheduled",
      color: "#DDEEFF", overlapAllowed: false, notes: null, isRecurring: rid !== null, recurrenceId: rid, recurrenceOccurrenceKey: rid ? `${rid}:${i}` : null, recurrenceIndex: rid ? i : null, recurrenceOriginalStart: rid ? start : null,
      scheduleAdjustment: null, classTitle: null, freedByLessonId: selfLinks && i > 0 && i % 25 === 0 ? P("cl", i - 1) : null, activityKind: "class",
      participants: nested > 0 ? Array.from({ length: nested }, (_, j) => ({ studentId: sid(i + j), studentName: "x", level: "A1" }))
        : i % 6 === 0 ? [{ studentId: sid(i), studentName: "x", level: "A1" }, { studentId: sid(i + 1), studentName: "y", level: "A1" }] : [{ studentId: sid(i), studentName: "x", level: "A1" }],
    });
  }

  const recurrenceExceptions = [];
  for (let i = 0; i < (cnt.recurrenceExceptions || 0); i++) {
    if (!recurrenceRules.length) break;
    recurrenceExceptions.push({ recurrenceId: P("rr", i % recurrenceRules.length), occurrenceKey: `ex_${prefix}_${pad(i)}`, exceptionType: "cancelled", replacementLessonId: null });
  }

  const pedagogicalLessons = [];
  for (let i = 0; i < (cnt.pedagogicalLessons || 0); i++) {
    const cl = calendarLessons.length ? calendarLessons[i % calendarLessons.length] : null;
    const a = sid(i); const b = sid(i + 1);
    pedagogicalLessons.push({
      id: P("pl", i), calendarLessonId: linked && cl && i < calendarLessons.length ? cl.id : null, activityKind: "class", countsAsClass: true, homeworkDescription: null, homeworkDueDate: null, billedAmount: 1000, scheduledStartAt: cl ? cl.startAt : "2025-03-01T10:00:00.000Z",
      actualStartedAt: "2025-03-01T10:00:00.000Z", actualEndedAt: "2025-03-01T11:00:00.000Z", outcome: "clase_dictada", holidayException: false, modality: "online", scheduledEndAt: cl ? cl.endAt : "2025-03-01T11:00:00.000Z",
      lateCancellationPolicy: null, lateCancellationPercentage: null, rescheduledFromRegistrationId: selfLinks && i > 0 && i % 20 === 0 ? P("pl", i - 1) : null,
      roster: nested > 0 ? Array.from({ length: nested }, (_, j) => ({ studentId: sid(i + j) })) : [{ studentId: a }, { studentId: b }],
      attendance: nested > 0 ? Array.from({ length: nested }, (_, j) => ({ studentId: sid(i + j), status: "presente", lateMinutes: null })) : [{ studentId: a, status: "presente", lateMinutes: null }, { studentId: b, status: "presente", lateMinutes: null }],
      evaluations: nested > 0 ? Array.from({ length: nested }, (_, j) => ({ studentId: sid(i + j), generalGrade: 8, skillGrades: { speaking: 8 }, strengths: ["x"], areasToImprove: ["y"], individualObservation: null, individualHomeworkDescription: null, individualHomeworkDueDate: null, billedAmount: 500 }))
        : [{ studentId: a, generalGrade: 8, skillGrades: { speaking: 8 }, strengths: ["x"], areasToImprove: ["y"], individualObservation: null, individualHomeworkDescription: null, individualHomeworkDueDate: null, billedAmount: 500 }],
      homeworkReviews: nested > 0 ? Array.from({ length: nested }, (_, j) => ({ studentId: sid(i + j), taskId: `task_${i}_${j}`, outcome: "realizada", reviewedAt: "2025-03-02T10:00:00.000Z" })) : [{ studentId: a, taskId: `task_${i}`, outcome: "realizada", reviewedAt: "2025-03-02T10:00:00.000Z" }],
    });
  }

  const packagePurchases = [];
  for (let i = 0; i < (cnt.packagePurchases || 0); i++) packagePurchases.push({ id: P("pk", i), studentId: sid(i), includedClasses: 10, amount: 10000, validFrom: "2025-01-01", validUntil: "2025-12-31", voidedAt: null, voidReason: null });
  const packageCreditMovements = [];
  for (let i = 0; i < (cnt.packageCreditMovements || 0); i++) {
    if (!packagePurchases.length) break;
    const p = packagePurchases[i % packagePurchases.length];
    packageCreditMovements.push({ id: P("pm", i), packageId: p.id, studentId: p.studentId, movementType: "ajuste_manual", amount: 1, savedLessonId: null, reason: "ajuste", voidedAt: null, voidReason: null });
  }

  const paymentCharges = [];
  const nCharges = cnt.paymentCharges || 0;
  for (let i = 0; i < nCharges; i++) {
    // Un cargo mensual por alumno y período (la base lo exige): el período avanza cada vez que se recorren todos los alumnos.
    const k = Math.floor(i / S);
    const period = `${2015 + Math.floor(k / 12)}-${pad(1 + (k % 12), 2)}`;
    // Cobro enlazado a un registro y a una clase de la MISMA copia (del mismo alumno: el alumno del registro / clase j es `sid(j)`, con j = i % S).
    const j = i % S;
    const linkReg = linked && i % 5 === 0 && j < pedagogicalLessons.length;
    const linkLesson = linked && i % 5 === 0 && j < calendarLessons.length;
    paymentCharges.push({ id: P("ch", i), studentId: sid(i), chargeType: "mensual", originalAmount: 1000, currency: "ARS", dueDate: `${period}-10`, billingPeriod: period, savedLessonId: linkReg ? P("pl", j) : null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: linkLesson ? P("cl", j) : null, voidedAt: null, voidReason: null });
  }
  const payments = [];
  const nPayments = cnt.payments || 0;
  for (let i = 0; i < nPayments; i++) {
    payments.push({ id: P("pa", i), studentId: sid(i), amount: giantComponent ? 1000000 : 1000, currency: "ARS", method: "efectivo", paidAt: `2025-${pad(1 + (i % 12), 2)}-12`, notes: null, voidedAt: null, voidReason: null, replacesPaymentId: selfLinks && chainReplaces && i > 0 ? P("pa", i - 1) : null, source: null });
  }
  const paymentAllocations = [];
  const nAlloc = Math.min(cnt.paymentAllocations || 0, nCharges);
  for (let i = 0; i < nAlloc; i++) {
    const pay = giantComponent ? payments[0] : payments[i % Math.max(1, nPayments)];
    const ch = paymentCharges[i];
    if (!pay) break;
    paymentAllocations.push({ id: P("al", i), paymentId: pay.id, chargeId: ch.id, studentId: ch.studentId, amount: giantComponent ? 1 : 1000 / Math.max(1, Math.ceil(nAlloc / Math.max(1, nPayments))) });
  }
  // La asignación debe pertenecer al mismo alumno que el cargo (trigger de coherencia) y no superar el pago: se alinea al alumno del cargo.
  const paymentAdjustments = [];
  for (let i = 0; i < (cnt.paymentAdjustments || 0) && nCharges; i++) paymentAdjustments.push({ id: P("aj", i), chargeId: P("ch", i % nCharges), studentId: paymentCharges[i % nCharges].studentId, reason: "ajuste", voidedAt: null, voidReason: null });
  const firstMonthProrationDecisions = [];
  for (let i = 0; i < (cnt.firstMonthProrationDecisions || 0); i++) { const linked = nCharges > 0 && i % 2 === 0; firstMonthProrationDecisions.push({ id: P("fm", i), studentId: linked ? paymentCharges[i % nCharges].studentId : sid(i), billingPeriod: "2025-01", effectiveJoinDate: "2025-01-15", criterion: linked ? "proportional" : "no_charge", classesRemaining: 2, classesPerFullPeriod: 4, permanentMonthlyAmount: 1000, chargedAmount: 500, chargeId: linked ? paymentCharges[i % nCharges].id : null, confirmedAt: "2025-01-15T10:00:00.000Z", source: "manual" }); }
  const initialPaidSurchargeCorrections = [];
  for (let i = 0; i < (cnt.initialPaidSurchargeCorrections || 0); i++) initialPaidSurchargeCorrections.push({ id: P("ip", i), studentId: sid(i), billingPeriod: "2025-01", previousSurchargeAmount: 0, voidedPaymentId: null, newPaymentId: null, correctedAt: "2025-01-20T10:00:00.000Z", reason: "r" });
  const customLevels = [];
  for (let i = 0; i < (cnt.customLevels || 0); i++) customLevels.push({ id: P("cv", i), name: `Nivel ${prefix} ${pad(i)}`, createdAt: "2025-01-01T00:00:00.000Z" });

  return {
    schemaVersion: 2, exportedAt: "2026-01-01T00:00:00.000Z", appVersion: "r6-synthetic",
    students, profiles, recurrenceRules, recurrenceExceptions, calendarLessons, teacherAvailability: null, pedagogicalLessons,
    paymentCharges, payments, paymentAllocations, paymentAdjustments, reportRecords: [], packagePurchases, packageCreditMovements,
    teacherProfile: null, monthlyAmountCorrections: [], initialPaidSurchargeCorrections, surchargeSettings: null, budgetDistribution: null,
    firstMonthProrationDecisions, trainingBillingAgreements, customLevels,
  };
}

const COUNTED = ["students", "pedagogicalLessons", "calendarLessons", "recurrenceRules", "recurrenceExceptions", "paymentCharges", "payments", "paymentAllocations", "paymentAdjustments", "reportRecords", "packagePurchases", "packageCreditMovements", "monthlyAmountCorrections", "initialPaidSurchargeCorrections", "firstMonthProrationDecisions", "trainingBillingAgreements", "customLevels"];

function countedRows(b) { return COUNTED.reduce((s, k) => s + (Array.isArray(b[k]) ? b[k].length : 0), 0); }
function nestedRows(b) {
  let n = 0;
  for (const p of Object.values(b.profiles || {})) n += (p.levelHistory || []).length;
  for (const c of b.calendarLessons || []) n += (c.participants || []).length;
  for (const r of b.recurrenceRules || []) n += (r.participantStudentIds || []).length;
  for (const l of b.pedagogicalLessons || []) n += (l.roster || []).length + (l.attendance || []).length + (l.evaluations || []).length + (l.homeworkReviews || []).length;
  return n;
}
const workUnits = (b) => countedRows(b) + nestedRows(b);

/** Respaldo vacío (formato móvil v2) con las colecciones obligatorias presentes. */
function emptyBackup() {
  return {
    schemaVersion: 2, exportedAt: "2026-01-01T00:00:00.000Z", appVersion: "r6-synthetic", students: [], profiles: {}, recurrenceRules: [], recurrenceExceptions: [], calendarLessons: [],
    teacherAvailability: null, pedagogicalLessons: [], paymentCharges: [], payments: [], paymentAllocations: [], paymentAdjustments: [], reportRecords: [], packagePurchases: [],
    packageCreditMovements: [], teacherProfile: null, monthlyAmountCorrections: [], initialPaidSurchargeCorrections: [], surchargeSettings: null, budgetDistribution: null,
    firstMonthProrationDecisions: [], trainingBillingAgreements: [], customLevels: [],
  };
}

/** Un alumno del respaldo con todos los campos que lee la importación. */
function student(id, extra = {}) {
  return {
    id, name: `Alumno ${id}`, phone: null, whatsapp: null, email: null, usualDays: ["lunes"], usualTime: "18:00", notes: null, birthDate: null, levels: ["A1"], initialLevel: "A1", modality: "online",
    status: "activo", category: "adulto_interes_personal", billingType: "mensual", billingPlan: null, dateJoined: "2025-01-10", lastReactivatedAt: null, statusChangeDate: null, usualDurationMinutes: 60,
    weeklyFrequency: 1, price: 1000, pendingHomework: null, alerts: [], currentGoals: [], strengths: [], areasToImprove: [], isFeatured: false, isNew: false, ...extra,
  };
}

module.exports = { generateBackup, countedRows, nestedRows, workUnits, PROFILES, emptyBackup, student };
