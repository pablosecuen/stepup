import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGenerateReportOutcome, isSameRequestContent, computeGenerateRequestFingerprint, STALE_CLAIM_WARNING } from "../generate-outcome.ts";
import type { StudentReportTeacherNotes } from "../narrative.ts";

const emptyNotes: StudentReportTeacherNotes = { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" };

function baseContent(overrides: Partial<{ selectedMonths: string[]; narrativeText: string; teacherNotes: StudentReportTeacherNotes; includeClassDetail: boolean; includePunctualitySummary: boolean }> = {}) {
  return {
    selectedMonths: ["2026-09"],
    narrativeText: "texto base",
    teacherNotes: emptyNotes,
    includeClassDetail: true,
    includePunctualitySummary: true,
    ...overrides,
  };
}

test("fila recién creada -> nunca reused, nunca staleClaim, sin aviso", () => {
  const content = baseContent();
  const outcome = evaluateGenerateReportOutcome({ ...content, pdfPath: null }, content, true);
  assert.deepEqual(outcome, { reused: false, staleClaim: false, warning: null });
});

test("REINTENTO tras respuesta perdida — mismo pedido EXACTO reutilizado -> reused, nunca staleClaim", () => {
  const content = baseContent({ selectedMonths: ["2026-06", "2026-05"] });
  const sameRequestDifferentMonthOrder = baseContent({ selectedMonths: ["2026-05", "2026-06"] });
  const outcome = evaluateGenerateReportOutcome({ ...content, pdfPath: "x/y/z.pdf" }, sameRequestDifferentMonthOrder, false);
  assert.deepEqual(outcome, { reused: true, staleClaim: false, warning: null });
});

test("claim obsoleto — fila reutilizada YA completa (con PDF) pero con OTROS meses -> staleClaim con aviso claro", () => {
  const persisted = baseContent({ selectedMonths: ["2026-04"] });
  const requested = baseContent({ selectedMonths: ["2026-05"] });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: "x/y/z.pdf" }, requested, false);
  assert.deepEqual(outcome, { reused: true, staleClaim: true, warning: STALE_CLAIM_WARNING });
});

test("fila reutilizada TODAVÍA en curso (sin PDF) con otros meses -> nunca staleClaim, sigue siendo la misma operación", () => {
  const persisted = baseContent({ selectedMonths: ["2026-04"] });
  const requested = baseContent({ selectedMonths: ["2026-05"] });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: null }, requested, false);
  assert.deepEqual(outcome, { reused: true, staleClaim: false, warning: null });
});

test("MISMOS meses pero narrativeText distinto -> staleClaim (el contenido cambió, no sólo los meses)", () => {
  const persisted = baseContent({ narrativeText: "texto original" });
  const requested = baseContent({ narrativeText: "texto editado por la profesora" });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: "x/y/z.pdf" }, requested, false);
  assert.equal(outcome.staleClaim, true);
});

test("MISMOS meses pero teacherNotes distintas -> staleClaim", () => {
  const persisted = baseContent();
  const requested = baseContent({ teacherNotes: { ...emptyNotes, recommendations: "practicar más" } });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: "x/y/z.pdf" }, requested, false);
  assert.equal(outcome.staleClaim, true);
});

test("MISMOS meses pero includeClassDetail distinto -> staleClaim", () => {
  const persisted = baseContent({ includeClassDetail: true });
  const requested = baseContent({ includeClassDetail: false });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: "x/y/z.pdf" }, requested, false);
  assert.equal(outcome.staleClaim, true);
});

test("MISMOS meses pero includePunctualitySummary distinto -> staleClaim", () => {
  const persisted = baseContent({ includePunctualitySummary: true });
  const requested = baseContent({ includePunctualitySummary: false });
  const outcome = evaluateGenerateReportOutcome({ ...persisted, pdfPath: "x/y/z.pdf" }, requested, false);
  assert.equal(outcome.staleClaim, true);
});

test("computeGenerateRequestFingerprint: nunca depende de metadatos inestables — dos llamadas con el mismo contenido dan la MISMA huella siempre", () => {
  const content = baseContent();
  assert.equal(computeGenerateRequestFingerprint(content), computeGenerateRequestFingerprint(baseContent()));
});

test("isSameRequestContent: contenido idéntico salvo el orden de los meses -> mismo pedido", () => {
  const a = baseContent({ selectedMonths: ["2026-05", "2026-06"] });
  const b = baseContent({ selectedMonths: ["2026-06", "2026-05"] });
  assert.equal(isSameRequestContent(a, b), true);
});
