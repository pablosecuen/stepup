import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStudentYearActivitySummary, buildNewStudentsPerMonthSummary, type StudentForYearSummary } from "../student-year-summary.ts";

test("buildStudentYearActivitySummary: alumno único atendido cuenta una sola vez aunque tenga varias clases", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [{ id: "s1", status: "activo", dateJoined: "2020-01-01" }],
    registrations: [
      { studentId: "s1", countsAsClass: true, dateKey: "2026-03-01" },
      { studentId: "s1", countsAsClass: true, dateKey: "2026-05-01" },
      { studentId: "s1", countsAsClass: true, dateKey: "2026-08-01" },
    ],
  });
  assert.equal(summary.uniqueStudentsAttended, 1);
});

test("buildStudentYearActivitySummary: una clase que no cuenta (cancelada) nunca suma al alumno atendido", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [{ id: "s1", status: "activo", dateJoined: "2020-01-01" }],
    registrations: [{ studentId: "s1", countsAsClass: false, dateKey: "2026-03-01" }],
  });
  assert.equal(summary.uniqueStudentsAttended, 0);
});

test("buildStudentYearActivitySummary: activeStudentsNow es el estado ACTUAL, nunca inferido por tener clase futura", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [
      { id: "s1", status: "activo", dateJoined: "2020-01-01" },
      { id: "s2", status: "pausado", dateJoined: "2020-01-01" },
    ],
    registrations: [],
  });
  assert.equal(summary.activeStudentsNow, 1);
});

test("buildStudentYearActivitySummary: newStudentsThisYear usa dateJoined real, nunca la fecha de la primera clase/pago", () => {
  const summary = buildStudentYearActivitySummary({
    year: 2026,
    students: [
      { id: "s1", status: "activo", dateJoined: "2026-03-15" },
      { id: "s2", status: "activo", dateJoined: "2025-12-01" },
    ],
    registrations: [],
  });
  assert.equal(summary.newStudentsThisYear, 1);
});

test("buildNewStudentsPerMonthSummary: mes sin altas queda en 0, nunca omitido (12 entradas siempre)", () => {
  const summary = buildNewStudentsPerMonthSummary({ year: 2026, students: [{ id: "s1", status: "activo", dateJoined: "2026-03-15" } as StudentForYearSummary] });
  assert.equal(summary.entries.length, 12);
  assert.equal(summary.entries.find((e) => e.month === "2026-01")?.count, 0);
  assert.equal(summary.entries.find((e) => e.month === "2026-03")?.count, 1);
});

test("buildNewStudentsPerMonthSummary: sin datos del año anterior -> previousYearTotal es null, nunca 0 fabricado", () => {
  const summary = buildNewStudentsPerMonthSummary({ year: 2026, students: [{ id: "s1", status: "activo", dateJoined: "2026-03-15" } as StudentForYearSummary] });
  assert.equal(summary.previousYearTotal, null);
});

test("buildNewStudentsPerMonthSummary: con datos reales del año anterior, previousYearTotal es el conteo real", () => {
  const summary = buildNewStudentsPerMonthSummary({
    year: 2026,
    students: [
      { id: "s1", status: "activo", dateJoined: "2025-05-01" },
      { id: "s2", status: "activo", dateJoined: "2025-11-01" },
    ],
  });
  assert.equal(summary.previousYearTotal, 2);
});

test("buildNewStudentsPerMonthSummary: peakMonths soporta empates", () => {
  const summary = buildNewStudentsPerMonthSummary({
    year: 2026,
    students: [
      { id: "s1", status: "activo", dateJoined: "2026-03-01" },
      { id: "s2", status: "activo", dateJoined: "2026-07-01" },
    ],
  });
  assert.deepEqual(summary.peakMonths.sort(), ["2026-03", "2026-07"]);
});
