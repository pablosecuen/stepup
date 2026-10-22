import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentBelongsToStudent } from "../attachment-scope.ts";

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";

test("adjuntos de una clase grupal: lo común sale en el reporte de todos; lo de un alumno sólo en el suyo", () => {
  assert.equal(attachmentBelongsToStudent(null, ANA), true, "común a la clase: lo ve Ana");
  assert.equal(attachmentBelongsToStudent(null, BETO), true, "común a la clase: lo ve Beto");
  assert.equal(attachmentBelongsToStudent(ANA, ANA), true, "de Ana: sale en su reporte");
  assert.equal(attachmentBelongsToStudent(ANA, BETO), false, "de Ana: NUNCA en el reporte de Beto");
  assert.equal(attachmentBelongsToStudent(BETO, ANA), false);
});

test("la lista de evidencias de un reporte sólo se arma con esa regla", () => {
  const rows = [
    { id: "comun", student_id: null },
    { id: "de-ana", student_id: ANA },
    { id: "de-beto", student_id: BETO },
  ];
  assert.deepEqual(rows.filter((r) => attachmentBelongsToStudent(r.student_id, ANA)).map((r) => r.id), ["comun", "de-ana"]);
  assert.deepEqual(rows.filter((r) => attachmentBelongsToStudent(r.student_id, BETO)).map((r) => r.id), ["comun", "de-beto"]);
});
