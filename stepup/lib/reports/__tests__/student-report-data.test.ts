import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStudentReportData, type RegistrationForStudentReport } from "../student-report-data.ts";

function reg(overrides: Partial<RegistrationForStudentReport> = {}): RegistrationForStudentReport {
  return {
    registrationId: "r1",
    dateKey: "2026-05-10",
    scheduledStartAt: "2026-05-10T13:00:00.000Z",
    scheduledEndAt: "2026-05-10T14:00:00.000Z",
    actualStartedAt: "2026-05-10T13:00:00.000Z",
    actualEndedAt: "2026-05-10T14:00:00.000Z",
    homeworkDescription: null,
    attendance: { status: "presente", lateMinutes: null },
    evaluation: { generalGrade: 8, skillGrades: { speaking: 8, listening: 9 }, strengths: [], areasToImprove: [], individualHomeworkDescription: null },
    ...overrides,
  };
}

test("buildStudentReportData: asistencia presente/tarde cuentan como asistió, ausente/ausente_aviso como faltó", () => {
  const data = buildStudentReportData([
    reg({ registrationId: "r1", attendance: { status: "presente", lateMinutes: null } }),
    reg({ registrationId: "r2", attendance: { status: "tarde", lateMinutes: 10 } }),
    reg({ registrationId: "r3", attendance: { status: "ausente", lateMinutes: null } }),
    reg({ registrationId: "r4", attendance: { status: "ausente_aviso", lateMinutes: null } }),
  ]);
  assert.equal(data.attendance.classesHeld, 4);
  assert.equal(data.attendance.classesAttended, 2);
  assert.equal(data.attendance.classesAbsent, 2);
  assert.equal(data.attendance.ratePercent, 50);
});

test("buildStudentReportData: promedio general excluye clases sin evaluación, nunca cuenta 0", () => {
  const data = buildStudentReportData([reg({ evaluation: { generalGrade: 8, skillGrades: {}, strengths: [], areasToImprove: [], individualHomeworkDescription: null } }), reg({ registrationId: "r2", evaluation: null })]);
  assert.equal(data.generalAverageGrade, 8);
});

test("buildStudentReportData: promedio por las 8 habilidades reales, ignora las no calificadas", () => {
  const data = buildStudentReportData([
    reg({
      evaluation: {
        generalGrade: 8,
        skillGrades: { speaking: 7, listening: 9, reading: 8, writing: 6, grammar: 7, vocabulary: 8, pronunciation: 9, participation: 10 },
        strengths: [],
        areasToImprove: [],
        individualHomeworkDescription: null,
      },
    }),
  ]);
  assert.equal(data.skillNotes.length, 8);
  assert.equal(data.skillNotes.find((s) => s.skill === "speaking")?.averageGrade, 7);
  assert.equal(data.skillNotes.find((s) => s.skill === "participation")?.averageGrade, 10);
});

test("buildStudentReportData: una habilidad nunca calificada (0 o ausente) da null, nunca 0", () => {
  const data = buildStudentReportData([reg({ evaluation: { generalGrade: 8, skillGrades: { speaking: 0 }, strengths: [], areasToImprove: [], individualHomeworkDescription: null } })]);
  assert.equal(data.skillNotes.find((s) => s.skill === "speaking")?.averageGrade, null);
});

test("buildStudentReportData: tareas asignadas combina la común del registro + la individual, deduplicadas", () => {
  const data = buildStudentReportData([
    reg({ homeworkDescription: "Leer capítulo 3", evaluation: { generalGrade: null, skillGrades: {}, strengths: [], areasToImprove: [], individualHomeworkDescription: "Repasar verbos" } }),
    reg({ registrationId: "r2", homeworkDescription: "Leer capítulo 3", evaluation: null }), // misma tarea común, no debe duplicarse
  ]);
  assert.deepEqual(data.homeworkAssigned.sort(), ["Leer capítulo 3", "Repasar verbos"]);
});

test("buildStudentReportData: horas dictadas suma minutos reales, nunca cuenta clases canceladas (el input ya viene sólo con clases dictadas)", () => {
  const data = buildStudentReportData([reg(), reg({ registrationId: "r2" })]);
  assert.equal(data.hoursTaught, 2); // 2 clases de 60 min = 2 horas
});

test("buildStudentReportData: nunca incluye información financiera — el tipo de salida no tiene ningún campo de monto/pago", () => {
  const data = buildStudentReportData([reg()]);
  const serialized = JSON.stringify(data).toLowerCase();
  assert.ok(!serialized.includes("amount"));
  assert.ok(!serialized.includes("billed"));
  assert.ok(!serialized.includes("payment"));
});

test("buildStudentReportData: nunca incluye la nota interna (individualObservation) — el tipo de entrada ni siquiera la declara", () => {
  // buildStudentReportData ni recibe individualObservation en su input — la exclusión es estructural,
  // no un filtro que pueda fallar: si el tipo de entrada no lo declara, la función no puede leerlo.
  const data = buildStudentReportData([reg()]);
  assert.ok(!("individualObservation" in JSON.parse(JSON.stringify(data))));
});

test("buildStudentReportData: sin ninguna clase -> classesHeld 0, promedios null, nunca datos inventados", () => {
  const data = buildStudentReportData([]);
  assert.equal(data.classesHeld, 0);
  assert.equal(data.generalAverageGrade, null);
  assert.equal(data.attendance.ratePercent, null);
});
