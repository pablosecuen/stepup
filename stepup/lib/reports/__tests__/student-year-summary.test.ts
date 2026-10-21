import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStudentYearActivitySummary, buildNewStudentsPerMonthSummary } from "../student-year-summary.ts";
import type { RegisteredLessonFacts } from "../registered-lessons.ts";

function fact(overrides: Partial<RegisteredLessonFacts> & { id: string }): RegisteredLessonFacts {
  return {
    calendarLessonId: null,
    occurrenceKey: null,
    eventType: "clase_dictada",
    holidayException: false,
    isBillable: true,
    dateKey: "2026-05-05",
    scheduledDurationMinutes: 60,
    actualDurationMinutes: null,
    modality: "online",
    studentIds: ["s1"],
    billedAmount: null,
    billedAmountByStudent: null,
    ...overrides,
  };
}
const student = (id: string, status: string, dateJoined: string) => ({ id, status, dateJoined });

test("alumno único atendido cuenta una sola vez aunque tenga varias clases; una clase compartida cuenta a cada participante", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [student("s1", "activo", "2020-01-01"), student("s2", "activo", "2020-01-01")],
    lessons: [fact({ id: "a", dateKey: "2026-03-01" }), fact({ id: "b", dateKey: "2026-05-01" }), fact({ id: "c", dateKey: "2026-08-01", studentIds: ["s1", "s2"] })],
  });
  assert.equal(summary.uniqueStudentsAttended, 2);
});

test("una clase que no se dictó (cancelada, alumno ausente) nunca suma al alumno atendido; un feriado con excepción sí", () => {
  const students = [student("s1", "activo", "2020-01-01")];
  assert.equal(buildStudentYearActivitySummary({ year: 2026, students, lessons: [fact({ id: "a", eventType: "cancelada_tarde" }), fact({ id: "b", eventType: "alumno_ausente" })] }).uniqueStudentsAttended, 0);
  assert.equal(buildStudentYearActivitySummary({ year: 2026, students, lessons: [fact({ id: "c", eventType: "feriado", holidayException: true })] }).uniqueStudentsAttended, 1);
});

test("sólo cuentan alumnos que existen y clases del año pedido", () => {
  const summary = buildStudentYearActivitySummary({ year: 2026, students: [student("s1", "activo", "2020-01-01")], lessons: [fact({ id: "a", studentIds: ["borrado"] }), fact({ id: "b", dateKey: "2025-12-31" })] });
  assert.equal(summary.uniqueStudentsAttended, 0);
});

test("activos es el estado ACTUAL y nuevos usa la fecha real de alta, nunca la de la primera clase o pago", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [student("s1", "activo", "2026-03-15"), student("s2", "pausado", "2025-12-01"), student("s3", "activo", "")],
    lessons: [],
  });
  assert.equal(summary.activeStudentsNow, 2);
  assert.equal(summary.newStudentsThisYear, 1);
});

test("incorporación mensual: 12 meses siempre, mes sin altas en 0, mes pico y comparación con el año anterior (null si no hay datos)", () => {
  const summary = buildNewStudentsPerMonthSummary({ year: 2026, students: [{ dateJoined: "2026-03-15" }, { dateJoined: "2026-03-20" }, { dateJoined: "2026-07-01" }, { dateJoined: "" }] });
  assert.equal(summary.months.length, 12);
  assert.equal(summary.months[0].count, 0);
  assert.equal(summary.months[2].count, 2);
  assert.deepEqual(summary.peakMonths, [3]);
  assert.equal(summary.total, 3);
  assert.equal(summary.previousYearTotal, null);
  assert.equal(buildNewStudentsPerMonthSummary({ year: 2026, students: [{ dateJoined: "2025-11-01" }] }).previousYearTotal, 1);
});
