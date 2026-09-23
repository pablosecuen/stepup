import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeterministicReportNarrative } from "../narrative.ts";
import { buildStudentReportData, type RegistrationForStudentReport } from "../student-report-data.ts";

const EMPTY_NOTES = { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" };

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
    evaluation: { generalGrade: 8, skillGrades: { speaking: 8 }, strengths: ["Buena pronunciación"], areasToImprove: ["Tiempos verbales"], individualHomeworkDescription: null },
    ...overrides,
  };
}

test("buildDeterministicReportNarrative: nunca inventa información — sin clases, dice explícitamente que no hubo clases", () => {
  const data = buildStudentReportData([]);
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert.ok(text.includes("No se registraron clases"));
  assert.ok(!text.includes("undefined"));
  assert.ok(!text.includes("null"));
});

test("buildDeterministicReportNarrative: con datos reales, menciona horas/asistencia/promedio/fortalezas/a mejorar", () => {
  const data = buildStudentReportData([reg()]);
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert.ok(text.includes("1 clase"));
  assert.ok(text.includes("8")); // promedio
  assert.ok(text.includes("Buena pronunciación"));
  assert.ok(text.includes("Tiempos verbales"));
});

test("buildDeterministicReportNarrative: las 4 notas manuales de la profesora se incluyen tal cual, con sus prefijos reales", () => {
  const data = buildStudentReportData([reg()]);
  const text = buildDeterministicReportNarrative(data, {
    generalComment: "Excelente progreso este mes.",
    behaviorAndParticipation: "Muy participativo.",
    nextObjectives: "Reforzar tiempos verbales.",
    recommendations: "Practicar 15 minutos diarios.",
  });
  assert.ok(text.includes("Excelente progreso este mes."));
  assert.ok(text.includes("Comportamiento y participación: Muy participativo."));
  assert.ok(text.includes("Próximos objetivos: Reforzar tiempos verbales."));
  assert.ok(text.includes("Recomendaciones: Practicar 15 minutos diarios."));
});

test("buildDeterministicReportNarrative: una nota manual vacía nunca genera un párrafo vacío/con prefijo huérfano", () => {
  const data = buildStudentReportData([reg()]);
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES);
  assert.ok(!text.includes("Comportamiento y participación:"));
  assert.ok(!text.includes("Próximos objetivos:"));
  assert.ok(!text.includes("Recomendaciones:"));
});

test("buildDeterministicReportNarrative: nunca menciona información financiera ni notas internas (no están en StudentReportData)", () => {
  const data = buildStudentReportData([reg()]);
  const text = buildDeterministicReportNarrative(data, EMPTY_NOTES).toLowerCase();
  assert.ok(!text.includes("$"));
  assert.ok(!text.includes("pago"));
  assert.ok(!text.includes("cobr"));
});
