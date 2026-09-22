import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrainingFirstPeriodCharge,
  countRuleOccurrencesInRange,
  isStudentEligibleForTrainingCharge,
  resolveEarliestParticipantOccurrenceDateInRange,
  resolveEffectiveTrainingFee,
  type CalendarLessonWithRosterForEngine,
} from "../training-charge-plan.ts";
import type { CalendarLessonForEngine, RecurrenceExceptionForEngine, RecurrenceRuleForEngine } from "../../calendar/types.ts";

// Serie semanal (martes y jueves 10:00), arranca el lunes 2026-09-07 (mitad de septiembre) — caso real: "entrenamiento creado durante un mes".
function weeklyTuesdayThursdayRule(overrides: Partial<RecurrenceRuleForEngine> = {}): RecurrenceRuleForEngine {
  return {
    recurrenceId: "r1",
    studentId: "s1",
    participantIds: ["s1"],
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }, // martes
          { weekday: 3, hour: 10, minute: 0, durationMinutes: 60 }, // jueves
        ],
      },
    ],
    modality: "online",
    timezone: "America/Argentina/Buenos_Aires",
    startDate: "2026-09-07",
    endDate: null,
    status: "active",
    classTitle: "Entrenamiento",
    activityKind: "training",
    ...overrides,
  };
}

test("countRuleOccurrencesInRange: cuenta las ocurrencias reales de un período completo, respetando el inicio real de la serie", () => {
  const count = countRuleOccurrencesInRange({
    rule: weeklyTuesdayThursdayRule(),
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  // martes 8/15/22/29 (4) + jueves 10/17/24 (3) = 7 — nunca cuenta el 1/09 ni el 3/09 (antes del inicio real de la serie).
  assert.equal(count, 7);
});

test("countRuleOccurrencesInRange: nunca cuenta una ocurrencia cancelada", () => {
  const exceptions: RecurrenceExceptionForEngine[] = [{ recurrenceId: "r1", occurrenceKey: "r1:w1:c0:d1:t1000:s0", type: "cancelled" }];
  const withoutCancel = countRuleOccurrencesInRange({ rule: weeklyTuesdayThursdayRule(), exceptions: [], existingLessons: [], rangeStartDateKey: "2026-09-01", rangeEndDateKey: "2026-09-30" });
  const withCancel = countRuleOccurrencesInRange({ rule: weeklyTuesdayThursdayRule(), exceptions, existingLessons: [], rangeStartDateKey: "2026-09-01", rangeEndDateKey: "2026-09-30" });
  assert.equal(withCancel, withoutCancel - 1);
});

test("computeTrainingFirstPeriodCharge: caso real — entrenamiento incorporado el 19/09, quedan 3+ ocurrencias -> cuota completa", () => {
  const result = computeTrainingFirstPeriodCharge({
    rule: weeklyTuesdayThursdayRule(),
    exceptions: [],
    existingLessons: [],
    effectiveJoinDate: "2026-09-19",
    monthlyFee: 80000,
  });
  assert.equal(result.billingPeriod, "2026-09");
  assert.equal(result.dueDate, "2026-09-19"); // vencimiento = fecha efectiva de incorporación, NUNCA el día 10.
  assert.equal(result.classesPerFullPeriod, 7);
  assert.equal(result.classesRemaining, 3); // martes 22/29 + jueves 24
  assert.equal(result.amount, 80000); // 3+ restantes -> cuota completa
});

test("computeTrainingFirstPeriodCharge: sólo queda 1 ocurrencia real -> valor de UNA clase, nunca la cuota completa", () => {
  const result = computeTrainingFirstPeriodCharge({
    rule: weeklyTuesdayThursdayRule(),
    exceptions: [],
    existingLessons: [],
    effectiveJoinDate: "2026-09-29", // sólo queda el martes 29
    monthlyFee: 70000,
  });
  assert.equal(result.classesRemaining, 1);
  assert.equal(result.amount, Math.round(70000 / 7)); // cuota / classesPerFullPeriod
});

test("computeTrainingFirstPeriodCharge: nunca cuenta clases anteriores al inicio real de la serie ni retroactivas", () => {
  const result = computeTrainingFirstPeriodCharge({
    rule: weeklyTuesdayThursdayRule(),
    exceptions: [],
    existingLessons: [] as CalendarLessonForEngine[],
    effectiveJoinDate: "2026-09-01", // antes del startDate real de la serie (07/09)
    monthlyFee: 80000,
  });
  // classesRemaining se acota al rango pedido, pero generateOccurrences igual nunca produce nada antes del 07/09 real.
  assert.equal(result.classesRemaining, 7);
  assert.equal(result.classesPerFullPeriod, 7);
});

test("resolveEffectiveTrainingFee: sin cambio pendiente devuelve el importe vigente", () => {
  assert.equal(resolveEffectiveTrainingFee({ monthlyFee: 80000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null }, "2026-09"), 80000);
});

test("resolveEffectiveTrainingFee: cambio 'desde el próximo mes' — septiembre conserva $80.000, octubre y noviembre pasan a $90.000", () => {
  const agreement = { monthlyFee: 80000, pendingMonthlyFee: 90000, pendingMonthlyFeeEffectiveFrom: "2026-10" };
  assert.equal(resolveEffectiveTrainingFee(agreement, "2026-09"), 80000);
  assert.equal(resolveEffectiveTrainingFee(agreement, "2026-10"), 90000);
  assert.equal(resolveEffectiveTrainingFee(agreement, "2026-11"), 90000);
});

test("resolveEffectiveTrainingFee: nunca muta monthlyFee — el mismo acuerdo resuelve distinto según el período consultado, sin escribir nada", () => {
  const agreement = { monthlyFee: 80000, pendingMonthlyFee: 90000, pendingMonthlyFeeEffectiveFrom: "2026-10" };
  // Tres consultas puras sobre el MISMO objeto — nunca se muta entre llamadas (mismo criterio que resolveEffectiveMonthlyAmount).
  assert.equal(resolveEffectiveTrainingFee(agreement, "2026-09"), 80000);
  assert.equal(resolveEffectiveTrainingFee(agreement, "2026-10"), 90000);
  assert.equal(agreement.monthlyFee, 80000); // nunca se "promociona" — el original_amount ya congelado en cada cargo real es la única fuente de verdad histórica.
});

test("isStudentEligibleForTrainingCharge: sólo 'activo' es elegible — más estricto que la mensualidad de clases", () => {
  assert.equal(isStudentEligibleForTrainingCharge("activo"), true);
  assert.equal(isStudentEligibleForTrainingCharge("pausado"), false);
  assert.equal(isStudentEligibleForTrainingCharge("inactivo"), false);
  assert.equal(isStudentEligibleForTrainingCharge("archivado"), false);
});

function lessonWithRoster(overrides: Partial<CalendarLessonWithRosterForEngine> = {}): CalendarLessonWithRosterForEngine {
  return {
    id: "cl1",
    recurrenceId: "r1",
    recurrenceOccurrenceKey: "r1:w0:c0:d1:t1000:s0",
    status: "completed",
    startAt: "2026-09-08T13:00:00.000Z", // 10:00 Argentina (UTC-3)
    participantIds: ["s1"],
    ...overrides,
  };
}

test("resolveEarliestParticipantOccurrenceDateInRange: clase MATERIALIZADA cuenta aunque la regla esté hoy pausada/finalizada", () => {
  const rule = weeklyTuesdayThursdayRule({ status: "ended" });
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [lessonWithRoster()],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  assert.equal(result, "2026-09-08");
});

test("resolveEarliestParticipantOccurrenceDateInRange: ocurrencia VIRTUAL nunca cuenta si la regla no está activa", () => {
  const rule = weeklyTuesdayThursdayRule({ status: "paused" });
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [], // sin ninguna clase materializada real
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  assert.equal(result, null);
});

test("resolveEarliestParticipantOccurrenceDateInRange: diferencia UTC/Argentina — 23:30 Argentina del 08/09 nunca se confunde con el 09/09 UTC", () => {
  const rule = weeklyTuesdayThursdayRule({ status: "ended" });
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [lessonWithRoster({ startAt: "2026-09-09T02:30:00.000Z" })], // 23:30 del 08/09 en Argentina (UTC-3)
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  assert.equal(result, "2026-09-08");
});

test("resolveEarliestParticipantOccurrenceDateInRange: toma la MÁS TEMPRANA entre clase materializada y ocurrencia virtual", () => {
  const rule = weeklyTuesdayThursdayRule(); // activa desde 2026-09-07
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [lessonWithRoster({ startAt: "2026-09-10T13:00:00.000Z" })], // jueves 10/09 materializada
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  // la ocurrencia VIRTUAL del martes 08/09 es más temprana que la materializada del 10/09.
  assert.equal(result, "2026-09-08");
});

test("resolveEarliestParticipantOccurrenceDateInRange: alumno agregado a mitad de serie ('esta y las siguientes') — sólo cuenta desde que aparece en el roster real", () => {
  const rule = weeklyTuesdayThursdayRule({ participantIds: ["s1", "s2"] }); // s2 recién agregado
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s2",
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  // s2 aparece en TODAS las ocurrencias virtuales generadas (participantIds es de la regla completa) — la más temprana real de la serie.
  assert.equal(result, "2026-09-08");
});

test("resolveEarliestParticipantOccurrenceDateInRange: sin ninguna ocurrencia real en el rango, devuelve null", () => {
  const rule = weeklyTuesdayThursdayRule({ startDate: "2026-11-02", status: "active" });
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-09-30",
  });
  assert.equal(result, null);
});

test("resolveEarliestParticipantOccurrenceDateInRange: acuerdo configurado MESES después de creada la serie — el piso del rango (agreement.startPeriod) excluye ocurrencias reales anteriores", () => {
  // La serie arrancó el 07/09 (real), pero el acuerdo de cobro recién se configura desde octubre —
  // ensureTrainingCharges pasa rangeStartDateKey = max(rule.startDate, firstDayOfBillingPeriod(agreement.startPeriod)) = "2026-10-01".
  const rule = weeklyTuesdayThursdayRule(); // ocurrencias reales desde 08/09
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-10-01", // piso real: nunca antes del inicio del acuerdo.
    rangeEndDateKey: "2026-10-31",
  });
  // NUNCA devuelve una fecha de septiembre (08/09, 10/09, etc.) aunque sean ocurrencias reales de la serie — el piso las excluye.
  assert.equal(result, "2026-10-01"); // jueves 1/10/2026 — primera ocurrencia real DENTRO del piso del rango.
});

test("resolveEarliestParticipantOccurrenceDateInRange: split 'esta y las siguientes' con incorporación futura — sólo cuenta desde que el alumno aparece en la regla sucesora", () => {
  // Regla sucesora real de un split, con startDate futuro respecto de la regla original — el alumno nuevo sólo puede tener ocurrencias reales a partir de ahí.
  const successorRule = weeklyTuesdayThursdayRule({ recurrenceId: "r2", startDate: "2026-10-05", participantIds: ["s1", "s3"] });
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule: successorRule,
    studentId: "s3",
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-09-01", // rango amplio, incluye fechas ANTERIORES al split
    rangeEndDateKey: "2026-10-31",
  });
  // Nunca antes del startDate real de la regla sucesora (06/10, primer martes desde el 05/10).
  assert.equal(result, "2026-10-06");
});

// --- Ronda 5: correcciones de `ensureTrainingCharges` (lib/repositories/payments.ts) ---

test("resolveEarliestParticipantOccurrenceDateInRange: el piso del PERÍODO ACTUAL evita backfill — nunca encuentra una ocurrencia de un período ya cerrado aunque la regla/acuerdo hayan empezado antes", () => {
  // Serie real desde 07/09 (ocurrencias reales de septiembre existen: 08, 10, 15, 17, 22, 24, 29).
  // `ensureTrainingCharges` corriendo en OCTUBRE debe pasar como rangeStartDateKey el máximo entre
  // currentPeriodStartDateKey ("2026-10-01"), agreementStartDateKey y rule.startDate — NUNCA septiembre,
  // aunque nadie haya corrido el generador en septiembre (hueco real, igual que el móvil: nunca se rellena).
  const rule = weeklyTuesdayThursdayRule();
  const result = resolveEarliestParticipantOccurrenceDateInRange({
    rule,
    studentId: "s1",
    exceptions: [],
    existingLessons: [],
    rangeStartDateKey: "2026-10-01", // piso ya acotado al período actual, como lo calcula ensureTrainingCharges corregido
    rangeEndDateKey: "2026-10-31",
  });
  // Nunca devuelve una fecha de septiembre (08/09, 29/09, etc.) — sólo la primera ocurrencia real de octubre.
  assert.equal(result, "2026-10-01"); // jueves 1/10/2026 — primera ocurrencia real de octubre.
});

test("resolveEarliestParticipantOccurrenceDateInRange: linaje con AMBAS reglas materializadas — cada una encuentra sólo SU PROPIA ocurrencia real, nunca la de la otra (defensa en profundidad)", () => {
  const originalRule = weeklyTuesdayThursdayRule({ recurrenceId: "r1", participantIds: ["s1"] }); // s3 nunca participó de r1
  const successorRule = weeklyTuesdayThursdayRule({ recurrenceId: "r2", startDate: "2026-10-05", participantIds: ["s3"] }); // s3 sólo está en la sucesora

  const originalLesson = lessonWithRoster({ recurrenceId: "r1", startAt: "2026-09-08T13:00:00.000Z", participantIds: ["s1"] });
  const successorLesson = lessonWithRoster({ recurrenceId: "r2", startAt: "2026-10-06T13:00:00.000Z", participantIds: ["s3"] });

  // Evaluando la ORIGINAL para s3 (que en realidad sólo está en la sucesora) con AMBAS lecciones mezcladas por error
  // del llamador (simula el bug real: `lessonsPerRule.flat()` pasando lecciones de r2 al evaluar r1).
  const resultOriginalForS3 = resolveEarliestParticipantOccurrenceDateInRange({
    rule: originalRule,
    studentId: "s3",
    exceptions: [],
    existingLessons: [originalLesson, successorLesson],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-10-31",
  });
  assert.equal(resultOriginalForS3, null); // s3 nunca participó de r1 -> la regla original nunca se apropia de la ocurrencia de la sucesora.

  // Evaluando la SUCESORA para s3, con las MISMAS lecciones mezcladas — encuentra correctamente su propia ocurrencia,
  // con el patrón/fechas de SU PROPIA regla, nunca afectada por la lección de r1.
  const resultSuccessorForS3 = resolveEarliestParticipantOccurrenceDateInRange({
    rule: successorRule,
    studentId: "s3",
    exceptions: [],
    existingLessons: [originalLesson, successorLesson],
    rangeStartDateKey: "2026-09-01",
    rangeEndDateKey: "2026-10-31",
  });
  assert.equal(resultSuccessorForS3, "2026-10-06"); // su propia lección materializada real.
});
