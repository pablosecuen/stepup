import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgrammedHourlyRateSummary, type HourlyRateOccurrence, type HourlyRateStudent } from "../hourly-rate.ts";
import type { RegisteredLessonFacts } from "../registered-lessons.ts";

const RANGE = { rangeStart: "2026-10-01", rangeEnd: "2026-10-31" };
const NOW = "2026-10-20";

function fact(overrides: Partial<RegisteredLessonFacts> & { id: string }): RegisteredLessonFacts {
  return {
    calendarLessonId: null,
    occurrenceKey: null,
    eventType: "clase_dictada",
    holidayException: false,
    isBillable: true,
    dateKey: "2026-10-05",
    scheduledDurationMinutes: 60,
    actualDurationMinutes: null,
    modality: "online",
    studentIds: [],
    billedAmount: null,
    billedAmountByStudent: null,
    ...overrides,
  };
}

/** Una hora a partir de las 10:00 ART (13:00Z) del día indicado. */
function occurrence(id: string, day: string, participantIds: string[], registration: RegisteredLessonFacts | null = null, status = "scheduled"): HourlyRateOccurrence {
  return { id, start: `${day}T13:00:00.000Z`, end: `${day}T14:00:00.000Z`, status, participantIds, registration };
}

const monthly = (id: string, amount: number, level = "B1"): HourlyRateStudent => ({ id, level, billingPlan: { type: "monthly", amount, dueDay: 10 } });
const perClass = (id: string, amount: number, level = "B1"): HourlyRateStudent => ({ id, level, billingPlan: { type: "per_class", amount } });

function summarize(over: Partial<Parameters<typeof buildProgrammedHourlyRateSummary>[0]>) {
  return buildProgrammedHourlyRateSummary({ occurrences: [], registeredLessons: [], charges: [], students: [], availabilityExceptions: [], ...RANGE, evaluationDate: NOW, ...over });
}

test("mensual: el total del mes del alumno se reparte por minutos entre sus clases; el importe que cada registro lleva (el mes entero) NUNCA se suma por clase", () => {
  // Caso real del traslado: cada clase registrada de un alumno mensual guarda el importe del MES completo. Sumarlo por clase inflaba el valor de la hora 4 veces.
  const registered = [1, 2, 3, 4].map((n) => fact({ id: `r${n}`, studentIds: ["m1"], billedAmount: 120000 }));
  const occurrences = registered.map((registration, index) => occurrence(`o${index}`, `2026-10-0${index + 1}`, ["m1"], registration, "completed"));
  const result = summarize({
    occurrences,
    registeredLessons: registered,
    students: [monthly("m1", 100000)],
    charges: [{ studentId: "m1", chargeType: "mensual", billingPeriod: "2026-10", packageId: null, originalAmount: 120000, voidedAt: null }],
  });
  assert.equal(result.totalRevenueAttributed, 120000);
  assert.equal(result.totalProgrammedHours, 4);
  assert.equal(result.generalRatePerHour, 30000);
  assert.equal(result.lessonCount, 4);
});

test("mensual sin cargo real todavía: usa el plan vigente del alumno (incluido el cambio de monto aplicado desde un mes)", () => {
  const student: HourlyRateStudent = { id: "m1", level: "B1", billingPlan: { type: "monthly", amount: 100000, dueDay: 10, pendingAmount: 150000, pendingAmountEffectiveFrom: "2026-10" } };
  const result = summarize({ occurrences: [occurrence("a", "2026-10-06", ["m1"]), occurrence("b", "2026-10-13", ["m1"])], students: [student] });
  assert.equal(result.totalRevenueAttributed, 150000);
  assert.equal(result.generalRatePerHour, 75000);
});

test("por clase: registrada usa el importe facturado; sin registrar se proyecta con el valor del plan", () => {
  const registered = fact({ id: "r1", studentIds: ["p1"], billedAmount: 20000 });
  const result = summarize({
    occurrences: [occurrence("a", "2026-10-06", ["p1"], registered, "completed"), occurrence("b", "2026-10-13", ["p1"])],
    registeredLessons: [registered],
    students: [perClass("p1", 18000)],
  });
  assert.equal(result.totalRevenueAttributed, 38000);
  assert.equal(result.unregisteredCount, 1);
  assert.equal(result.lessonCount, 2);
});

test("exclusiones: cancelada sin registro, cancelada tarde (aunque cobre), no facturable, feriado sin excepción, día no disponible y clase sin alumnos", () => {
  const lateCancel = fact({ id: "r1", eventType: "cancelada_tarde", studentIds: ["p1"], billedAmount: 10000 });
  const notBillable = fact({ id: "r2", isBillable: false, studentIds: ["p1"], billedAmount: 10000 });
  const holiday = fact({ id: "r3", eventType: "feriado", studentIds: ["p1"] });
  const holidayWorked = fact({ id: "r4", eventType: "feriado", holidayException: true, studentIds: ["p1"], billedAmount: 10000 });
  const result = summarize({
    occurrences: [
      occurrence("cancelada", "2026-10-02", ["p1"], null, "cancelled"),
      occurrence("tarde", "2026-10-03", ["p1"], lateCancel, "completed"),
      occurrence("nofact", "2026-10-04", ["p1"], notBillable, "completed"),
      occurrence("feriado", "2026-10-05", ["p1"], holiday, "completed"),
      occurrence("feriado-dado", "2026-10-06", ["p1"], holidayWorked, "completed"),
      occurrence("vacaciones", "2026-10-07", ["p1"]),
      occurrence("vacia", "2026-10-08", []),
    ],
    registeredLessons: [lateCancel, notBillable, holiday, holidayWorked],
    students: [perClass("p1", 10000)],
    availabilityExceptions: [{ id: "e1", date: "2026-10-07", type: "unavailable_full_day", reason: "vacation" }],
  });
  assert.equal(result.lessonCount, 1);
  assert.equal(result.totalProgrammedHours, 1);
  assert.equal(result.totalRevenueAttributed, 10000);
});

test("una clase reprogramada SIN registro se proyecta (como en la app); una cancelada con registro «dictada» cuenta por su registro", () => {
  const worked = fact({ id: "r1", studentIds: ["p1"], billedAmount: 9000 });
  const result = summarize({
    occurrences: [occurrence("repro", "2026-10-02", ["p1"], null, "rescheduled"), occurrence("c", "2026-10-03", ["p1"], worked, "cancelled")],
    registeredLessons: [worked],
    students: [perClass("p1", 10000)],
  });
  assert.equal(result.lessonCount, 2);
  assert.equal(result.totalRevenueAttributed, 19000);
});

test("clase grupal: las horas cuentan UNA vez y el ingreso suma el de cada alumno; niveles distintos -> «nivel_mixto»", () => {
  const result = summarize({
    occurrences: [occurrence("g", "2026-10-06", ["p1", "p2"]), occurrence("s", "2026-10-07", ["p1"])],
    students: [perClass("p1", 10000, "B1"), perClass("p2", 6000, "A2")],
  });
  assert.equal(result.totalProgrammedHours, 2);
  assert.equal(result.totalRevenueAttributed, 26000);
  const byLevel = Object.fromEntries(result.byLevel.map((entry) => [entry.level, entry.ratePerHour]));
  assert.deepEqual(byLevel, { B1: 10000, nivel_mixto: 16000 });
});

test("usa la duración REAL de la clase registrada cuando existe", () => {
  const registered = fact({ id: "r1", studentIds: ["p1"], billedAmount: 15000, actualDurationMinutes: 90 });
  const result = summarize({ occurrences: [occurrence("a", "2026-10-06", ["p1"], registered, "completed")], registeredLessons: [registered], students: [perClass("p1", 10000)] });
  assert.equal(result.totalProgrammedHours, 1.5);
  assert.equal(result.generalRatePerHour, 10000);
});

test("valor «estimado» mientras el período no cerró; definitivo cuando ya cerró; sin clases -> null (nunca 0 inventado)", () => {
  const open = summarize({ evaluationDate: "2026-10-20" });
  assert.equal(open.generalRatePerHour, null);
  assert.equal(open.isEstimate, true);
  assert.equal(summarize({ evaluationDate: "2026-11-02" }).isEstimate, false);
});
