/**
 * Respaldo SINTÉTICO con la forma REAL que escribe la app móvil (`TeacherFlowBackupV2`: el JSON crudo de AsyncStorage, sin renombrar nada),
 * armado a mano a partir de los tipos del móvil (`src/features/…/types`). Sirve para probar el traslado sin datos personales: ningún nombre,
 * teléfono, correo ni importe es real. Cada campo opcional de cada tipo aparece al menos una vez, y cada texto libre lleva una marca única
 * («ZQ…») para poder comprobar, después de importar, que ese dato llegó a algún lado (o que se identificó como sin destino).
 *
 * Ojo con lo que NO se parece al formato de la web: el móvil usa `studentId`/`start`/`end` en las clases, `recurrenceId`/`type`/`participantIds`
 * en las series, `type` en los cobros, y guarda cada clase registrada como un `form` anidado. Esa diferencia es el defecto que este fixture
 * deja a la vista (ver docs/TRASLADO_EXPO_GO_A_WEB.md).
 */

const TZ = "America/Argentina/Buenos_Aires";

export function buildMobileBackup(): Record<string, unknown> {
  const profile = (id: string, extra: Record<string, unknown>) => ({
    id,
    name: "",
    levels: ["B1"],
    initialLevel: "A2",
    modality: "presencial",
    status: "activo",
    category: "adulto_interes_personal",
    billingType: "mensual",
    dateJoined: "2026-03-02T15:30:00.000Z",
    lastReactivatedAt: null,
    statusChangeDate: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 2,
    price: 41000.37,
    averageGrade: 8.5,
    classesThisMonth: 3,
    attendanceRate: 91.5,
    paymentStatus: "verde",
    nextClassAt: "2026-10-20T13:00:00.000Z",
    nextClassEndAt: "2026-10-20T14:00:00.000Z",
    lastClassAt: "2026-10-13T13:00:00.000Z",
    pendingHomework: null,
    alerts: [],
    currentGoals: [],
    strengths: [],
    areasToImprove: [],
    totalClasses: 14,
    totalHoursTaken: 14.75,
    totalInvested: 574000.5,
    statusHistory: [],
    levelHistory: [],
    priceHistory: [],
    skillGradesHistory: [],
    ...extra,
  });

  const students = [
    { id: "stu-1", name: "ZQ Alumna Uno", levels: ["B1"], modality: "presencial", status: "activo", nextClassAt: "2026-10-20T13:00:00.000Z", nextClassEndAt: "2026-10-20T14:00:00.000Z", paymentStatus: "verde", averageGrade: 8.5, classesThisMonth: 3, lastPaymentAt: "2026-10-05", isFeatured: true, isNew: false, hasOverduePayment: false, hasPendingReport: true, hasPendingHomework: true, monthlyStatusLabel: "Al día", monthlyStatusColorKey: "verde", monthlyStatusBalance: 0, monthlyStatusKind: "paid", overdueDebtLabel: null },
    { id: "stu-2", name: "ZQ Alumno Dos", levels: ["A2", "Intermedio ZQ"], modality: "online", status: "activo", nextClassAt: null, paymentStatus: "amarillo", averageGrade: null, classesThisMonth: 1, lastPaymentAt: null, isFeatured: false, isNew: true, hasOverduePayment: true, hasPendingReport: false, hasPendingHomework: false },
    { id: "stu-3", name: "ZQ Alumna Tres", levels: ["C1"], modality: "mixta", status: "pausado", nextClassAt: null, paymentStatus: "naranja", averageGrade: 9, classesThisMonth: 0, lastPaymentAt: "2026-08-10", isFeatured: false, isNew: false, hasOverduePayment: false, hasPendingReport: false, hasPendingHomework: false },
    { id: "stu-4", name: "ZQ Alumno Cuatro", levels: ["A1"], modality: "presencial", status: "archivado", nextClassAt: null, paymentStatus: "rojo", averageGrade: null, classesThisMonth: 0, lastPaymentAt: null, isFeatured: false, isNew: false, hasOverduePayment: false, hasPendingReport: false, hasPendingHomework: false },
  ];

  const profiles = {
    "stu-1": profile("stu-1", {
      name: "ZQ Alumna Uno",
      phone: "+54 9 11 5550-0001",
      whatsapp: "+54 9 11 5550-0002",
      email: "zq.uno@example.invalid",
      usualDays: ["lunes", "jueves"],
      usualTime: "10:00",
      notes: "ZQ nota privada de la alumna uno",
      birthDate: "1990-05-17T03:00:00.000Z",
      billingPlan: { type: "monthly", amount: 41000.37, dueDay: 10, startPeriod: "2026-03", pendingAmount: 45000.12, pendingAmountEffectiveFrom: "2026-12" },
      pendingHomework: "ZQ tarea pendiente uno",
      alerts: ["ZQ alerta uno"],
      currentGoals: ["ZQ objetivo uno"],
      strengths: ["ZQ fortaleza uno"],
      areasToImprove: ["ZQ aspecto a mejorar uno"],
      statusHistory: [{ status: "activo", date: "2026-03-02T15:30:00.000Z", reason: "ZQ alta", internalNote: "ZQ nota interna de estado" }],
      priceHistory: [{ price: 38000.25, date: "2026-03-02T15:30:00.000Z" }, { price: 41000.37, date: "2026-08-01T03:00:00.000Z" }],
      levelHistory: [
        { id: "lvl-1", level: "A2", date: "2026-03-02", fromLevel: null, recordedAt: "2026-03-02T15:30:00.000Z", previousMilestoneAt: null, durationDays: null, note: "ZQ nota nivel", origin: "manual" },
        { level: "B1", date: "2026-09-01", fromLevel: "A2", recordedAt: "2026-09-01T12:00:00.000Z", previousMilestoneAt: "2026-03-02T15:30:00.000Z", durationDays: 183 },
      ],
      skillGradesHistory: [{ date: "2026-10-13", grades: { speaking: 8.5, grammar: 7.5 } }],
    }),
    "stu-2": profile("stu-2", {
      name: "ZQ Alumno Dos",
      levels: ["A2", "Intermedio ZQ"],
      modality: "online",
      category: "secundaria",
      billingType: "por_clase",
      billingPlan: { type: "per_class", amount: 9000.61 },
      price: 9000.61,
      weeklyFrequency: 1,
      usualDays: ["martes"],
      statusHistory: [],
      priceHistory: [{ price: 9000.61, date: "2026-04-01" }],
    }),
    "stu-3": profile("stu-3", {
      name: "ZQ Alumna Tres",
      levels: ["C1"],
      modality: "mixta",
      status: "pausado",
      category: "profesorado_ingles",
      billingType: "mensual",
      billingPlan: { type: "complimentary" },
      price: 0,
      statusChangeDate: "2026-09-20T03:00:00.000Z",
      lastReactivatedAt: "2026-02-01T03:00:00.000Z",
      statusHistory: [{ status: "pausado", date: "2026-09-20", reason: "ZQ vacaciones largas" }],
    }),
    "stu-4": profile("stu-4", {
      name: "ZQ Alumno Cuatro",
      levels: ["A1"],
      status: "archivado",
      category: "otro",
      billingType: "por_clase",
      billingPlan: { type: "class_package", amount: 80000.43, includedClasses: 10, validFrom: "2026-05-01", validUntil: "2026-12-31" },
      statusChangeDate: "2026-07-01T03:00:00.000Z",
    }),
  };

  const calendarLessons = [
    { id: "cal-1", studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1", participants: [{ studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1" }], lessonType: "individual", start: "2026-10-13T13:00:00.000Z", end: "2026-10-13T14:00:00.000Z", modality: "presencial", status: "completed", color: "#FCE4D2", overlapAllowed: false, overlapGroupId: null, notes: "ZQ nota de la clase 1", isRecurring: true, recurrenceId: "rule-1", recurrenceOccurrenceKey: "rule-1:2026-10-13:0", recurrenceIndex: 7, recurrenceOriginalStart: "2026-10-13T13:00:00.000Z", classTitle: "ZQ Conversación", activityKind: "class" },
    { id: "cal-2", studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1", participants: [{ studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1" }], lessonType: "individual", start: "2026-10-15T13:00:00.000Z", end: "2026-10-15T14:00:00.000Z", modality: "presencial", status: "cancelled", color: "#FFF1B8", overlapAllowed: false, overlapGroupId: null, isRecurring: true, recurrenceId: "rule-1", recurrenceOccurrenceKey: "rule-1:2026-10-15:0", recurrenceIndex: 8, recurrenceOriginalStart: "2026-10-15T13:00:00.000Z", activityKind: "class" },
    { id: "cal-3", studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1", participants: [{ studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1" }], lessonType: "individual", start: "2026-10-16T14:00:00.000Z", end: "2026-10-16T15:00:00.000Z", modality: "online", status: "scheduled", color: "#FCE8E6", overlapAllowed: false, overlapGroupId: null, isRecurring: false, recurrenceId: null, recurrenceOccurrenceKey: null, recurrenceIndex: null, recurrenceOriginalStart: null, freedByLessonId: "cal-2", activityKind: "class", scheduleAdjustment: { direction: "delayed", minutes: 15, reason: "mutual_agreement", adjustedAt: "2026-10-16T13:50:00.000Z" } },
    { id: "cal-4", studentId: "stu-2", studentName: "ZQ Alumno Dos", level: "A2", participants: [{ studentId: "stu-2", studentName: "ZQ Alumno Dos", level: "A2" }, { studentId: "stu-3", studentName: "ZQ Alumna Tres", level: "C1" }], lessonType: "group", start: "2026-10-14T20:00:00.000Z", end: "2026-10-14T21:30:00.000Z", modality: "online", status: "completed", color: "#DDEEFF", overlapAllowed: true, overlapGroupId: "ovl-ZQ-1", isRecurring: false, recurrenceId: null, recurrenceOccurrenceKey: null, recurrenceIndex: null, recurrenceOriginalStart: null, classTitle: "ZQ Clase grupal", activityKind: "class" },
    { id: "cal-5", studentId: "stu-3", studentName: "ZQ Alumna Tres", level: "C1", participants: [{ studentId: "stu-3", studentName: "ZQ Alumna Tres", level: "C1" }], lessonType: "individual", start: "2026-10-12T22:00:00.000Z", end: "2026-10-12T23:00:00.000Z", modality: "mixta", status: "rescheduled", color: "#E9DDFC", overlapAllowed: false, overlapGroupId: null, isRecurring: true, recurrenceId: "rule-2", recurrenceOccurrenceKey: "rule-2:2026-10-12:0", recurrenceIndex: 3, recurrenceOriginalStart: "2026-10-12T22:00:00.000Z", activityKind: "training", classTitle: "ZQ Entrenamiento" },
    { id: "cal-6", studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1", participants: [{ studentId: "stu-1", studentName: "ZQ Alumna Uno", level: "B1" }], lessonType: "individual", start: "2026-10-20T13:00:00.000Z", end: "2026-10-20T14:00:00.000Z", modality: "presencial", status: "scheduled", color: "#FCE4D2", overlapAllowed: false, overlapGroupId: null, isRecurring: true, recurrenceId: "rule-1", recurrenceOccurrenceKey: "rule-1:2026-10-20:0", recurrenceIndex: 9, recurrenceOriginalStart: "2026-10-20T13:00:00.000Z", activityKind: "class" },
  ];

  const recurrenceRules = [
    { recurrenceId: "rule-1", studentId: "stu-1", participantIds: ["stu-1"], type: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }, { weekday: 4, hour: 10, minute: 0, durationMinutes: 60 }] }], modality: "presencial", timezone: TZ, startDate: "2026-03-02", endDate: null, status: "active", supersedesRecurrenceId: null, supersededByRecurrenceId: null, effectiveFromDate: "2026-03-02", classTitle: "ZQ Conversación", activityKind: "class" },
    { recurrenceId: "rule-2", studentId: "stu-3", participantIds: ["stu-3"], type: "custom", cycleLengthWeeks: 2, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 19, minute: 0, durationMinutes: 60 }] }, { weekIndex: 1, sessions: [] }], modality: "mixta", timezone: TZ, startDate: "2026-04-06", endDate: "2026-12-14", status: "paused", supersedesRecurrenceId: "rule-0", supersededByRecurrenceId: null, effectiveFromDate: "2026-04-06", classTitle: "ZQ Entrenamiento", activityKind: "training", trainingBillingAgreementId: "agr-1" },
    { recurrenceId: "rule-0", studentId: "stu-3", type: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 19, minute: 0, durationMinutes: 45 }] }], modality: "mixta", timezone: TZ, startDate: "2026-02-02", endDate: "2026-04-05", status: "ended", supersededByRecurrenceId: "rule-2", activityKind: "training", trainingBillingAgreementId: "agr-1" },
  ];

  const recurrenceExceptions = [
    { occurrenceKey: "rule-1:2026-10-15:0", recurrenceId: "rule-1", type: "cancelled", createdAt: "2026-10-14T11:00:00.000Z" },
    { occurrenceKey: "rule-2:2026-10-12:0", recurrenceId: "rule-2", type: "rescheduled", replacementLessonId: "cal-5", createdAt: "2026-10-10T11:00:00.000Z" },
    { occurrenceKey: "rule-1:2026-10-22:0", recurrenceId: "rule-1", type: "excluded", createdAt: "2026-10-14T11:05:00.000Z" },
  ];

  const form = (extra: Record<string, unknown>) => ({
    eventType: "clase_dictada",
    activityKind: "class",
    studentIds: ["stu-1"],
    date: "2026-10-13",
    time: "10:00",
    scheduledDurationMinutes: 60,
    actualDurationMinutes: 70,
    modality: "presencial",
    attendance: [{ studentId: "stu-1", present: true, status: "presente" }],
    topics: [],
    objectives: [],
    activities: [],
    activityNotes: "",
    activityAttachments: [],
    materialIds: [],
    evaluations: [],
    internalNotes: "",
    homeworkDescription: "",
    homeworkDueDate: null,
    isBillable: true,
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
    consumesMonthlyPackage: true,
    holidayException: false,
    rescheduledFromLessonId: null,
    ...extra,
  });

  const pedagogicalLessons = [
    {
      id: "les-1",
      createdAt: "2026-10-13T14:20:00.000Z",
      form: form({
        topics: [{ id: "top-1", text: "ZQ tema visto uno", status: "visto" }, { id: "top-2", text: "ZQ tema planificado dos", status: "planificado" }],
        objectives: ["ZQ objetivo de la clase"],
        activities: ["ZQ actividad uno"],
        activityNotes: "ZQ notas de actividades",
        activityAttachments: [{ id: "att-1", name: "ZQ guia.pdf", uri: "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf", addedAt: "2026-10-13T14:00:00.000Z", kind: "pdf", mimeType: "application/pdf", sizeBytes: 20480, caption: "ZQ leyenda", studentId: "stu-1" }],
        materialIds: ["mat-1"],
        evaluations: [{ studentId: "stu-1", generalGrade: 8.5, skillGrades: { speaking: 8.5, grammar: 7.5 }, strengths: ["ZQ fortaleza de la clase"], areasToImprove: ["ZQ mejora de la clase"], individualObservation: "ZQ observación individual", individualHomeworkDescription: "ZQ tarea individual", individualHomeworkDueDate: "2026-10-20" }],
        internalNotes: "ZQ notas internas de la clase",
        homeworkDescription: "ZQ tarea común",
        homeworkDueDate: "2026-10-20",
      }),
      countsAsClass: true,
      billedAmount: 9000.61,
      billedAmountByStudent: { "stu-1": 9000.61 },
      appliedPolicy: null,
      calendarReservationKey: "rule-1:2026-10-13:0",
      calendarLessonId: "cal-1",
      calendarRegistration: { reservationKey: "rule-1:2026-10-13:0", lessonId: "cal-1", studentId: "stu-1", start: "2026-10-13T13:00:00.000Z", end: "2026-10-13T14:00:00.000Z", modality: "presencial", recurrenceId: "rule-1", recurrenceOccurrenceKey: "rule-1:2026-10-13:0" },
      profileAppliedAt: "2026-10-13T14:21:00.000Z",
      scheduledStartAt: "2026-10-13T13:00:00.000Z",
      effectiveStartAt: "2026-10-13T13:00:00.000Z",
      actualStartedAt: "2026-10-13T13:02:00.000Z",
      actualEndedAt: "2026-10-13T14:12:00.000Z",
      scheduleAdjustment: { direction: "advanced", minutes: 15, reason: "teacher", adjustedAt: "2026-10-13T12:50:00.000Z" },
      studentArrival: { arrivedAt: "2026-10-13T13:02:00.000Z", status: "within_grace", lateMinutes: 2, manuallyCorrected: false },
      startSource: "button",
      endSource: "button",
      sessionUpdatedAt: "2026-10-13T14:12:00.000Z",
      updatedAt: "2026-10-13T14:30:00.000Z",
      editHistory: [{ editedAt: "2026-10-13T14:30:00.000Z", previousForm: form({ internalNotes: "ZQ nota previa a la edición" }), previousCountsAsClass: true, previousBilledAmount: 8000.11, previousBilledAmountByStudent: { "stu-1": 8000.11 }, previousAppliedPolicy: null }],
      homeworkReviews: [{ taskId: "common:les-0", studentId: "stu-1", outcome: "parcial", reviewedAt: "2026-10-13T14:10:00.000Z" }],
      registrationStatus: "completed",
    },
    {
      id: "les-2",
      createdAt: "2026-10-14T21:40:00.000Z",
      form: form({
        studentIds: ["stu-2", "stu-3"],
        date: "2026-10-14",
        time: "17:00",
        scheduledDurationMinutes: 90,
        actualDurationMinutes: 90,
        modality: "online",
        attendance: [{ studentId: "stu-2", present: true, status: "tarde", lateMinutes: 7 }, { studentId: "stu-3", present: false, status: "ausente_aviso" }],
        evaluations: [{ studentId: "stu-2", generalGrade: null, skillGrades: {}, strengths: [], areasToImprove: [] }],
        topics: [{ id: "top-3", text: "ZQ tema grupal", status: "visto" }],
      }),
      countsAsClass: true,
      billedAmount: null,
      appliedPolicy: null,
      calendarLessonId: "cal-4",
      scheduledStartAt: "2026-10-14T20:00:00.000Z",
      registrationStatus: "partially_registered",
      groupProgress: { participantOrder: ["stu-2", "stu-3"], participantStatus: { "stu-2": "completed", "stu-3": "pending" } },
    },
    {
      id: "les-3",
      createdAt: "2026-10-12T23:30:00.000Z",
      form: form({ eventType: "alumno_ausente", studentIds: ["stu-3"], date: "2026-10-12", time: "19:00", attendance: [{ studentId: "stu-3", present: false }], actualDurationMinutes: null }),
      countsAsClass: false,
      billedAmount: 0,
      appliedPolicy: null,
    },
    {
      id: "les-4",
      createdAt: "2026-10-09T15:00:00.000Z",
      form: form({ eventType: "cancelada_tarde", studentIds: ["stu-1"], date: "2026-10-09", time: "10:00", attendance: [{ studentId: "stu-1", present: false, status: "ausente" }], lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 50, actualDurationMinutes: null }),
      countsAsClass: false,
      billedAmount: 4500.31,
      appliedPolicy: "cobrar_porcentaje",
    },
    {
      id: "les-5",
      createdAt: "2026-10-08T15:00:00.000Z",
      form: form({ eventType: "reprogramada", studentIds: ["stu-1"], date: "2026-10-08", time: "10:00", attendance: [], rescheduledFromLessonId: "les-4", actualDurationMinutes: null }),
      countsAsClass: false,
      billedAmount: null,
      appliedPolicy: null,
    },
    {
      id: "les-6",
      createdAt: "2026-10-07T15:00:00.000Z",
      form: form({ eventType: "profesora_ausente", studentIds: ["stu-1"], date: "2026-10-07", time: "10:00", attendance: [], actualDurationMinutes: null }),
      countsAsClass: false,
      billedAmount: null,
      appliedPolicy: null,
    },
    {
      id: "les-7",
      createdAt: "2026-10-06T15:00:00.000Z",
      form: form({ eventType: "feriado", studentIds: ["stu-1"], date: "2026-10-06", time: "10:00", attendance: [], holidayException: true, actualDurationMinutes: null }),
      countsAsClass: false,
      billedAmount: null,
      appliedPolicy: null,
    },
    {
      id: "les-8",
      createdAt: "2026-10-05T15:00:00.000Z",
      form: form({
        studentIds: ["stu-1"],
        date: "2026-10-05",
        time: "10:00",
        attendance: [{ studentId: "stu-1", present: true, status: "presente" }],
        evaluations: [{ studentId: "stu-1", generalGrade: 12, skillGrades: { speaking: 0, grammar: 11, writing: 7.5, listening: "ocho" }, strengths: [], areasToImprove: [] }],
      }),
      countsAsClass: true,
      billedAmount: null,
      appliedPolicy: null,
      scheduledStartAt: "2026-10-05T13:00:00.000Z",
    },
    {
      id: "les-9",
      createdAt: "2026-10-04T15:00:00.000Z",
      form: form({
        studentIds: ["stu-2", "stu-3"],
        date: "2026-10-04",
        time: "17:00",
        attendance: [{ studentId: "stu-2", present: true, status: "presente" }, { studentId: "stu-3", present: true, status: "presente" }],
        evaluations: [{ studentId: "stu-2", generalGrade: 9, skillGrades: { speaking: 9 }, strengths: [], areasToImprove: [] }, { studentId: "stu-3", generalGrade: 7, skillGrades: { speaking: 7 }, strengths: [], areasToImprove: [] }],
      }),
      countsAsClass: true,
      billedAmount: null,
      appliedPolicy: null,
      scheduledStartAt: "2026-10-04T20:00:00.000Z",
      registrationStatus: "completed",
    },
  ];

  const teacherAvailability = {
    schemaVersion: 1,
    timezone: TZ,
    weeklyBlocks: [{ id: "blk-1", weekday: 2, startTime: "13:00", endTime: "14:30", reason: "personal", note: "ZQ almuerzo" }],
    exceptions: [
      { id: "exc-1", date: "2026-12-21", endDate: "2027-01-04", type: "unavailable_full_day", reason: "vacation", note: "ZQ vacaciones" },
      { id: "exc-2", date: "2026-11-02", type: "unavailable_block", startTime: "09:00", endTime: "12:00", reason: "other" },
      { id: "exc-3", date: "2026-11-07", type: "available_extra", startTime: "10:00", endTime: "13:00", reason: "other" },
    ],
  };

  const paymentCharges = [
    { id: "chg-1", studentId: "stu-1", type: "mensual", originalAmount: 41000.37, currency: "ARS", dueDate: "2026-10-10", createdAt: "2026-10-01T03:00:00.000Z", billingPeriod: "2026-10", voidedAt: null, voidReason: null },
    { id: "chg-2", studentId: "stu-2", type: "por_clase", originalAmount: 9000.61, currency: "ARS", dueDate: "2026-10-14", createdAt: "2026-10-14T21:41:00.000Z", savedLessonId: "les-2", calendarLessonId: "cal-4", voidedAt: null, voidReason: null },
    { id: "chg-3", studentId: "stu-4", type: "paquete", originalAmount: 80000.43, currency: "ARS", dueDate: "2026-05-01", createdAt: "2026-05-01T12:00:00.000Z", packageId: "pkg-1", voidedAt: null, voidReason: null },
    { id: "chg-4", studentId: "stu-3", type: "entrenamiento", originalAmount: 20000.19, currency: "ARS", dueDate: "2026-10-10", createdAt: "2026-10-01T03:00:00.000Z", billingPeriod: "2026-10", trainingBillingAgreementId: "agr-1", trainingSeriesName: "ZQ Entrenamiento", voidedAt: null, voidReason: null },
    { id: "chg-5", studentId: "stu-1", type: "mensual", originalAmount: 39000.77, currency: "ARS", dueDate: "2026-09-10", createdAt: "2026-09-01T03:00:00.000Z", billingPeriod: "2026-09", voidedAt: "2026-09-15T12:00:00.000Z", voidReason: "ZQ cobro cargado por error" },
    { id: "chg-6", studentId: "stu-1", type: "por_clase", originalAmount: 4500.31, currency: "ARS", dueDate: "2026-10-09", createdAt: "2026-10-09T15:01:00.000Z", savedLessonId: "les-4", voidedAt: null, voidReason: null },
  ];

  const payments = [
    { id: "pay-1", studentId: "stu-1", amount: 41000.37, currency: "ARS", method: "transferencia", paidAt: "2026-10-05", recordedAt: "2026-10-05T18:30:00.000Z", notes: "ZQ nota del pago uno", voidedAt: null, voidReason: null },
    { id: "pay-2", studentId: "stu-2", amount: 4000.07, currency: "ARS", method: "efectivo", paidAt: "2026-10-15", recordedAt: "2026-10-15T12:00:00.000Z", voidedAt: null, voidReason: null },
    { id: "pay-3", studentId: "stu-1", amount: 500.5, currency: "ARS", method: "otro", paidAt: "2026-03-02", recordedAt: "2026-03-02T15:35:00.000Z", voidedAt: "2026-03-03T12:00:00.000Z", voidReason: "ZQ pago anulado", source: "initial_student_setup" },
    { id: "pay-4", studentId: "stu-1", amount: 4500.31, currency: "ARS", method: "efectivo", paidAt: "2026-10-09", recordedAt: "2026-10-09T15:05:00.000Z", voidedAt: null, voidReason: null, replacesPaymentId: "pay-3" },
  ];

  const paymentAllocations = [
    { id: "alo-1", paymentId: "pay-1", chargeId: "chg-1", studentId: "stu-1", amount: 41000.37 },
    { id: "alo-2", paymentId: "pay-2", chargeId: "chg-2", studentId: "stu-2", amount: 4000.07 },
    { id: "alo-3", paymentId: "pay-4", chargeId: "chg-6", studentId: "stu-1", amount: 4500.31 },
  ];

  const paymentAdjustments = [{ id: "adj-1", chargeId: "chg-2", studentId: "stu-2", reason: "ZQ ajuste de cobro", createdAt: "2026-10-15T12:10:00.000Z", voidedAt: null, voidReason: null }];

  return {
    schemaVersion: 2,
    exportedAt: "2026-10-19T12:00:00.000Z",
    appVersion: "1.0.0",
    students,
    profiles,
    pedagogicalLessons,
    calendarLessons,
    recurrenceRules,
    recurrenceExceptions,
    teacherAvailability,
    paymentCharges,
    payments,
    paymentAllocations,
    paymentAdjustments,
    reportRecords: [
      { id: "rep-1", studentId: "stu-1", title: "ZQ Reporte septiembre", selectedMonths: ["2026-09"], periodStart: "2026-09-01", periodEnd: "2026-09-30", generatedAt: "2026-10-01T12:00:00.000Z", schemaVersion: 1, permanentPdfUri: "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf", snapshot: { narrativeText: "ZQ narrativa del reporte", includeClassDetail: true, selectedEvidenceIds: [], data: { studentId: "stu-1", studentName: "ZQ Alumna Uno", period: { startDate: "2026-09-01", endDate: "2026-09-30", label: "Septiembre" }, topicsSeen: ["ZQ tema del reporte"], skillNotes: [], generalAverageGrade: 8.5, strengths: [], areasToImprove: [], homeworkAssigned: [], attendance: { classesHeld: 8, classesAttended: 8, classesAbsent: 0, ratePercent: 100 }, hoursTaught: 8, lessonDetails: [], evidenceCandidates: [] } } },
    ],
    packagePurchases: [{ id: "pkg-1", studentId: "stu-4", includedClasses: 10, amount: 80000.43, validFrom: "2026-05-01", validUntil: "2026-12-31", createdAt: "2026-05-01T12:00:00.000Z", voidedAt: null, voidReason: null }],
    packageCreditMovements: [
      { id: "mov-1", packageId: "pkg-1", studentId: "stu-4", type: "consumo", amount: 1, savedLessonId: "les-3", createdAt: "2026-05-10T12:00:00.000Z", voidedAt: null, voidReason: null },
      { id: "mov-2", packageId: "pkg-1", studentId: "stu-4", type: "ajuste_manual", amount: 2, reason: "ZQ ajuste manual de paquete", createdAt: "2026-05-11T12:00:00.000Z", voidedAt: "2026-05-12T12:00:00.000Z", voidReason: "ZQ ajuste anulado" },
    ],
    teacherProfile: { displayName: "ZQ Profesora Demo", createdAt: "2026-03-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z", schemaVersion: 1, completedTutorialVersion: 2, tutorialCompletedAt: "2026-03-05T12:00:00.000Z" },
    monthlyAmountCorrections: [{ id: "mac-1", studentId: "stu-1", billingPeriod: "2026-08", previousAmount: 38000.25, newAmount: 41000.37, changedAt: "2026-08-02T12:00:00.000Z", reason: "ZQ actualización de precio", effectiveFrom: "this_month" }],
    initialPaidSurchargeCorrections: [{ id: "isc-1", studentId: "stu-1", billingPeriod: "2026-03", previousSurchargeAmount: 500.5, voidedPaymentId: "pay-3", newPaymentId: "pay-4", correctedAt: "2026-03-03T12:00:00.000Z", reason: "ZQ corrección de alta" }],
    surchargeSettings: { current: { enabled: false, graceDay: 10, firstLateDay: 11, firstLatePercentage: 5, secondLateDay: 16, secondLatePercentage: 10, lastLateDay: 21, lastLatePercentage: 15 }, pending: { enabled: false, graceDay: 12, firstLateDay: 13, firstLatePercentage: 6, secondLateDay: 18, secondLatePercentage: 11, lastLateDay: 23, lastLatePercentage: 16 }, pendingEffectiveFrom: "2027-01" },
    budgetDistribution: { distribution: { needs: 55, wants: 25, savings: 20 }, savingsGoal: { enabled: true, targetAmount: 1500000.77, targetDate: "2027-06-30" } },
    customLevels: [{ id: "cl-1", name: "Intermedio ZQ", createdAt: "2026-04-01T12:00:00.000Z" }],
    firstMonthProrationDecisions: [{ id: "fmp-1", studentId: "stu-1", billingPeriod: "2026-03", effectiveJoinDate: "2026-03-02", criterion: "proportional", classesRemaining: 7, classesPerFullPeriod: 8, permanentMonthlyAmount: 38000.25, chargedAmount: 33250.22, chargeId: "chg-1", createdAt: "2026-03-02T15:40:00.000Z", confirmedAt: "2026-03-02T15:41:00.000Z", source: "manual", recurrenceIds: ["rule-1"], seriesPatternSnapshot: [{ recurrenceId: "rule-1", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }] }] }], ruleVersion: 2 }],
    trainingBillingAgreements: [{ id: "agr-1", monthlyFee: 20000.19, pendingMonthlyFee: 22000.88, pendingMonthlyFeeEffectiveFrom: "2027-01", startPeriod: "2026-02", createdAt: "2026-02-01T12:00:00.000Z" }],
  };
}

/**
 * Lo que sale del TELÉFONO y nunca viaja en el respaldo: la biblioteca de materiales y las claves que la app guarda sólo en el dispositivo.
 * (Sintético: nombres de archivo y rutas de ejemplo; el contenido de cada archivo lo define la prueba.)
 */
export function buildPhoneExtraction() {
  return {
    materials: [
      {
        id: "mat-1",
        name: "ZQ Unidad 3 - verbos irregulares",
        note: "ZQ nota del material",
        createdAt: "2026-07-16T12:00:00.000Z",
        attachment: { id: "matatt-1", name: "ZQ unidad3.pdf", uri: "file:///data/user/0/host.exp.exponent/files/attachments/matatt-1.pdf", addedAt: "2026-07-16T12:00:00.000Z", kind: "pdf", mimeType: "application/pdf", sizeBytes: 4096 },
      },
      { id: "mat-2", name: "ZQ Solo una nota", note: "ZQ material sin archivo", createdAt: "2026-07-17T12:00:00.000Z", attachment: null },
    ],
    deviceLocal: {
      "@teacherflow/pending_training_billing_operations": "[]",
      "@teacherflow/reschedule_cancellation_notices": JSON.stringify([{ id: "ntc-1", studentId: "stu-2", cancelledLessonStartIso: "2026-10-12T20:00:00.000Z", createdAt: "2026-10-12T21:00:00.000Z" }]),
      "@teacherflow/live_class_tracking_enabled": "true",
    },
  };
}
