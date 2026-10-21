import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStudentReportData, type RegistrationForStudentReport } from "../student-report-data.ts";
import { buildDeterministicReportNarrative } from "../narrative.ts";
import { computeGenerateRequestFingerprint, evaluateGenerateReportOutcome } from "../generate-outcome.ts";
import { MAX_REPORT_EVIDENCE, normalizeEvidenceIds, ReportEvidenceError, resolveSelectedEvidence } from "../evidence.ts";
import { toReportJpeg } from "../evidence-image.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "images", "__tests__", "fixtures");
const noNotes = { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" };

function registration(over: Partial<RegistrationForStudentReport> & { registrationId: string; dateKey: string }): RegistrationForStudentReport {
  return {
    scheduledStartAt: `${over.dateKey}T13:00:00.000Z`, scheduledEndAt: `${over.dateKey}T14:00:00.000Z`, actualStartedAt: null, actualEndedAt: null, homeworkDescription: null,
    attendance: { status: "presente", lateMinutes: null }, evaluation: null, ...over,
  };
}

test("temas vistos: se juntan sin repetir en el período y quedan clase por clase; sin contenido (datos anteriores) no hay temas", () => {
  const data = buildStudentReportData([
    registration({ registrationId: "r1", dateKey: "2026-10-02", topicsSeen: ["Passive voice", "  Past perfect  "] }),
    registration({ registrationId: "r2", dateKey: "2026-10-09", topicsSeen: ["Passive voice", "Phrasal verbs"] }),
    registration({ registrationId: "r3", dateKey: "2026-10-16" }),
  ]);
  assert.deepEqual(data.topicsSeen, ["Passive voice", "Past perfect", "Phrasal verbs"]);
  assert.deepEqual(data.lessonDetails.map((l) => l.topicsSeen), [["Passive voice", "Past perfect"], ["Passive voice", "Phrasal verbs"], []]);
  assert.deepEqual(buildStudentReportData([registration({ registrationId: "r", dateKey: "2026-10-02" })]).topicsSeen, []);
});

test("la narrativa sugerida menciona los temas trabajados sólo si los hay (y no cambia para un período sin temas)", () => {
  const withTopics = buildDeterministicReportNarrative(buildStudentReportData([registration({ registrationId: "r1", dateKey: "2026-10-02", topicsSeen: ["Passive voice", "Past perfect"] })]), noNotes);
  assert.match(withTopics, /Temas trabajados durante el período: Passive voice, Past perfect\./);
  const without = buildDeterministicReportNarrative(buildStudentReportData([registration({ registrationId: "r1", dateKey: "2026-10-02" })]), noNotes);
  assert.doesNotMatch(without, /Temas trabajados/);
});

test("evidencias candidatas: sólo los adjuntos de las clases del período (comunes a la clase o del propio alumno), ordenados por fecha; nada viene elegido", () => {
  const data = buildStudentReportData([
    registration({ registrationId: "r2", dateKey: "2026-10-09", attachments: [{ attachmentId: "a2", kind: "pdf", name: "ejercicios.pdf", caption: null }] }),
    registration({ registrationId: "r1", dateKey: "2026-10-02", attachments: [{ attachmentId: "a1", kind: "image", name: "pizarron.jpg", caption: "Pizarrón" }] }),
  ]);
  assert.deepEqual(data.evidenceCandidates?.map((c) => [c.attachmentId, c.dateKey, c.kind, c.caption]), [["a1", "2026-10-02", "image", "Pizarrón"], ["a2", "2026-10-09", "pdf", null]]);
});

test("la selección de evidencias se valida contra los candidatos: sin repetidos, sin ajenos y con tope", () => {
  const candidates = [
    { attachmentId: "a1", registrationId: "r1", dateKey: "2026-10-02", kind: "image" as const, name: "f.jpg", caption: null },
    { attachmentId: "a2", registrationId: "r2", dateKey: "2026-10-09", kind: "pdf" as const, name: "g.pdf", caption: null },
  ];
  assert.deepEqual(resolveSelectedEvidence(undefined, candidates), []);
  assert.deepEqual(resolveSelectedEvidence([], candidates), []);
  assert.deepEqual(resolveSelectedEvidence(["a2", "a1", "a1"], candidates).map((c) => c.attachmentId), ["a1", "a2"]);
  assert.throws(() => resolveSelectedEvidence(["de-otro-alumno"], candidates), ReportEvidenceError);
  assert.throws(() => resolveSelectedEvidence("a1", candidates), ReportEvidenceError);
  const many = Array.from({ length: MAX_REPORT_EVIDENCE + 1 }, (_, i) => ({ attachmentId: `a${i}`, registrationId: "r", dateKey: "2026-10-02", kind: "image" as const, name: `f${i}.jpg`, caption: null }));
  assert.throws(() => resolveSelectedEvidence(many.map((c) => c.attachmentId), many), ReportEvidenceError);
  assert.deepEqual(normalizeEvidenceIds(["b", "a", "b"]), ["a", "b"]);
});

test("la huella de un pedido: sin evidencias queda IGUAL que siempre (reportes anteriores); con evidencias cambia y no depende del orden", () => {
  const base = { selectedMonths: ["2026-10"], narrativeText: "x", teacherNotes: noNotes, includeClassDetail: true, includePunctualitySummary: true };
  const legacy = computeGenerateRequestFingerprint(base);
  assert.equal(computeGenerateRequestFingerprint({ ...base, selectedEvidenceIds: [] }), legacy);
  assert.equal(computeGenerateRequestFingerprint({ ...base, selectedEvidenceIds: undefined }), legacy);
  const one = computeGenerateRequestFingerprint({ ...base, selectedEvidenceIds: ["a1", "a2"] });
  assert.notEqual(one, legacy);
  assert.equal(computeGenerateRequestFingerprint({ ...base, selectedEvidenceIds: ["a2", "a1"] }), one);
  // Un reporte ya generado sin evidencias y un pedido NUEVO con evidencias no son el mismo pedido (no se devuelve el viejo en silencio).
  const outcome = evaluateGenerateReportOutcome({ ...base, pdfPath: "x.pdf" }, { ...base, selectedEvidenceIds: ["a1"] }, false);
  assert.equal(outcome.staleClaim, true);
  assert.equal(evaluateGenerateReportOutcome({ ...base, pdfPath: "x.pdf" }, { ...base, selectedEvidenceIds: [] }, false).staleClaim, false);
});

test("fotos para el PDF: JPEG y PNG se reducen a JPEG; HEIC (iPhone) se convierte; un archivo que no es foto se rechaza", async () => {
  const sharp = (await import("sharp")).default;
  const meta = async (bytes: Uint8Array) => sharp(bytes).metadata();
  const jpeg = await toReportJpeg(readFileSync(join(FIXTURES, "plana.jpg")));
  assert.equal((await meta(jpeg)).format, "jpeg");
  const png = await toReportJpeg(readFileSync(join(FIXTURES, "plana.png")));
  assert.equal((await meta(png)).format, "jpeg");
  const heic = await toReportJpeg(readFileSync(join(FIXTURES, "plana.heic")));
  const heicMeta = await meta(heic);
  assert.equal(heicMeta.format, "jpeg");
  assert.ok((heicMeta.width ?? 0) > 0 && (heicMeta.width ?? 0) <= 900);
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  const reduced = await meta(await toReportJpeg(big));
  assert.deepEqual([reduced.width, reduced.height], [900, 600], "se reduce a 900 px de ancho conservando la proporción");
  await assert.rejects(toReportJpeg(readFileSync(join(FIXTURES, "texto.jpg"))), /not_an_image|Input/);
  await assert.rejects(toReportJpeg(new Uint8Array(0)));
});
