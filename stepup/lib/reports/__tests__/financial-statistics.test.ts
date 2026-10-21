import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialStatistics, type FinancialStatisticsInput, type RegistrationRowWithExtras } from "../financial-statistics.ts";
import { toRegisteredLessonFacts, webOccurrenceKeyFromReservationKey } from "../registered-lessons.ts";

const RULE = "11111111-1111-1111-1111-111111111111";

function registration(overrides: Partial<RegistrationRowWithExtras> & { id: string }): RegistrationRowWithExtras {
  return {
    calendar_lesson_id: null,
    source_event_type: null,
    outcome: "clase_dictada",
    holiday_exception: false,
    is_billable: null,
    scheduled_start_at: "2026-10-06T13:00:00.000Z",
    scheduled_end_at: "2026-10-06T14:00:00.000Z",
    actual_started_at: null,
    actual_ended_at: null,
    scheduled_duration_minutes: null,
    actual_duration_minutes: null,
    modality: "online",
    billed_amount: null,
    created_at: "2026-10-06T15:00:00.000Z",
    source_extras: null,
    ...overrides,
  };
}

const student = { id: "s1", levels: ["B1"], status: "activo", billingType: "por_clase" as const, billingPlan: null, price: 10000, dateJoined: "2026-01-10" };
const base: Omit<FinancialStatisticsInput, "periodItems" | "registrations"> = {
  evaluationDate: "2026-10-20",
  evaluationInstant: "2026-10-21T01:53:00.000Z",
  range: { rangeStart: "2026-10-01", rangeEnd: "2026-10-31" },
  year: 2026,
  demandItems: [],
  roster: [{ lesson_registration_id: "r1", student_id: "s1" }],
  evaluationAmounts: [],
  rules: [{ id: RULE, legacy_mobile_id: "legacy-rule" }],
  students: [student],
  charges: [],
  packageConsumptions: [],
  availabilityExceptions: [],
};

test("el resultado de una clase dictada en la web (sin datos de la app: sin resultado original ni duraciones) se deduce del resultado y de los horarios", () => {
  const facts = toRegisteredLessonFacts(registration({ id: "r1", scheduled_start_at: "2026-10-07T01:30:00.000Z", scheduled_end_at: "2026-10-07T02:30:00.000Z" }), { studentIds: ["s1"], billedAmountByStudent: null, occurrenceKey: null });
  assert.equal(facts.eventType, "clase_dictada");
  assert.equal(facts.scheduledDurationMinutes, 60);
  assert.equal(facts.actualDurationMinutes, null);
  assert.equal(facts.isBillable, true);
  // 22:30 del 6 de octubre en Argentina: la fecha civil es el 6, no el 7.
  assert.equal(facts.dateKey, "2026-10-06");
});

test("un registro importado conserva el resultado original (alumno ausente) y las duraciones de la app", () => {
  const facts = toRegisteredLessonFacts(registration({ id: "r1", source_event_type: "alumno_ausente", scheduled_duration_minutes: 45, actual_duration_minutes: 50, is_billable: false }), { studentIds: [], billedAmountByStudent: null, occurrenceKey: null });
  assert.equal(facts.eventType, "alumno_ausente");
  assert.equal(facts.scheduledDurationMinutes, 45);
  assert.equal(facts.actualDurationMinutes, 50);
  assert.equal(facts.isBillable, false);
});

test("la clave de reserva de la app se traduce a la ocurrencia de la web (serie nueva, misma semana y horario); sin serie conocida o sin clave -> null", () => {
  const legacy = new Map([["legacy-rule", RULE]]);
  assert.equal(webOccurrenceKeyFromReservationKey("recurrence:legacy-rule:legacy-rule:w2:c0:d1:t1800:s0", legacy), `${RULE}|${RULE}:w2:c0:d1:t1800:s0`);
  assert.equal(webOccurrenceKeyFromReservationKey("recurrence:otra:otra:w2:c0:d1:t1800:s0", legacy), null);
  assert.equal(webOccurrenceKeyFromReservationKey("lesson:abc", legacy), null);
  assert.equal(webOccurrenceKeyFromReservationKey(null, legacy), null);
});

test("el valor de la hora cruza cada ocurrencia con SU registro: por clase enlazada, o por la clave de la ocurrencia cuando el registro quedó sin enlazar", () => {
  const key = "w2:c0:d1:t1800:s0";
  const result = buildFinancialStatistics({
    ...base,
    roster: [],
    registrations: [
      registration({ id: "r1", calendar_lesson_id: "L1", billed_amount: 20000 }),
      registration({ id: "r2", billed_amount: 30000, source_extras: { calendarReservationKey: `recurrence:legacy-rule:legacy-rule:${key}` } }),
    ],
    periodItems: [
      { id: "L1", recurrenceId: null, occurrenceKey: null, materializedLessonId: "L1", start: "2026-10-06T13:00:00.000Z", end: "2026-10-06T14:00:00.000Z", status: "completed", participantIds: ["s1"] },
      { id: `virtual:${RULE}:${key}`, recurrenceId: RULE, occurrenceKey: `${RULE}:${key}`, materializedLessonId: null, start: "2026-10-13T21:00:00.000Z", end: "2026-10-13T22:00:00.000Z", status: "scheduled", participantIds: ["s1"] },
      { id: "L3", recurrenceId: null, occurrenceKey: null, materializedLessonId: "L3", start: "2026-10-14T13:00:00.000Z", end: "2026-10-14T14:00:00.000Z", status: "scheduled", participantIds: ["s1"] },
    ],
  });
  // L1 (registrada, 20.000) + ocurrencia sin enlazar (registrada, 30.000) + L3 sin registro (proyectada con el valor del plan, 10.000).
  assert.equal(result.hourlyRate.lessonCount, 3);
  assert.equal(result.hourlyRate.unregisteredCount, 1);
  assert.equal(result.hourlyRate.totalRevenueAttributed, 60000);
  assert.equal(result.hourlyRate.generalRatePerHour, 20000);
});

test("el importe de cada alumno de una clase registrada sale del detalle por alumno cuando existe", () => {
  const result = buildFinancialStatistics({
    ...base,
    students: [student, { ...student, id: "s2" }],
    roster: [],
    evaluationAmounts: [
      { lesson_registration_id: "r1", student_id: "s1", billed_amount: 8000 },
      { lesson_registration_id: "r1", student_id: "s2", billed_amount: "7000.00" },
    ],
    registrations: [registration({ id: "r1", calendar_lesson_id: "L1", billed_amount: 15000 })],
    periodItems: [{ id: "L1", recurrenceId: null, occurrenceKey: null, materializedLessonId: "L1", start: "2026-10-06T13:00:00.000Z", end: "2026-10-06T14:00:00.000Z", status: "completed", participantIds: ["s1", "s2"] }],
  });
  assert.equal(result.hourlyRate.totalRevenueAttributed, 15000);
  assert.equal(result.hourlyRate.totalProgrammedHours, 1);
});

test("el resumen anual y el período usan las mismas reglas sobre el MISMO registro; la demanda no depende de los registros", () => {
  const result = buildFinancialStatistics({
    ...base,
    roster: [],
    registrations: [
      registration({ id: "r1", calendar_lesson_id: "L1" }),
      registration({ id: "r2", calendar_lesson_id: "L2", scheduled_start_at: "2026-03-02T13:00:00.000Z", scheduled_end_at: "2026-03-02T14:00:00.000Z", source_event_type: "cancelada_con_aviso" }),
    ],
    periodItems: [],
    demandItems: [{ id: "L1", recurrenceId: null, occurrenceKey: null, materializedLessonId: "L1", start: "2026-10-16T13:00:00.000Z", end: "2026-10-16T14:00:00.000Z", status: "completed", participantIds: ["s1"] }],
  });
  assert.equal(result.annualActivity.heldHours, 1);
  assert.equal(result.annualActivity.cancelledHours, 1);
  assert.equal(result.periodActivity.heldHours, 1);
  assert.equal(result.periodActivity.cancelledHours, 0);
  assert.equal(result.demand.topWeekdays[0].weekday, 4);
  assert.equal(result.studentYear.uniqueStudentsAttended, 0, "sin alumnos en el registro (roster vacío) no hay alumno atendido");
  assert.equal(result.studentYear.newStudentsThisYear, 1);
});
