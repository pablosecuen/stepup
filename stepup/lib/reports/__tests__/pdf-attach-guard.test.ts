import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldCleanupUnreferencedPdf } from "../pdf-attach-guard.ts";

test("fila sin pdf_url todavía (nadie lo referencia) -> se puede limpiar el objeto huérfano", () => {
  assert.equal(shouldCleanupUnreferencedPdf("owner/student/report.pdf", null), true);
});

test("fila vigente apunta EXACTAMENTE al objeto recién subido (otro request ganador ya lo asoció) -> NUNCA borrarlo", () => {
  assert.equal(shouldCleanupUnreferencedPdf("owner/student/report.pdf", "owner/student/report.pdf"), false);
});

test("fila vigente apunta a otro path distinto (defensivo, no debería pasar para el mismo reportId) -> se puede limpiar", () => {
  assert.equal(shouldCleanupUnreferencedPdf("owner/student/report.pdf", "owner/student/otro.pdf"), true);
});
