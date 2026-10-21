import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLabel, toLessonContent, type LessonAttachmentRow, type MaterialRow } from "../lesson-content-mapping.ts";

const EMPTY = { topics: [], objectives: [], activities: [], activity_notes: "", internal_notes: "", material_ids: [], is_billable: true, consumes_monthly_package: true };
const attachment = (over: Partial<LessonAttachmentRow> = {}): LessonAttachmentRow => ({ id: "a1", name: "guia.pdf", kind: "pdf", caption: null, student_id: null, size_bytes: 10, file_status: "pendiente", ...over });
const material = (over: Partial<MaterialRow> = {}): MaterialRow => ({ id: "m-uuid", legacy_mobile_id: "mat-1", name: "Unidad 3", note: "una nota", attachment_name: "u3.pdf", attachment_kind: "pdf", file_status: "disponible", ...over });

test("una clase sin contenido propio no muestra nada (la tarjeta no aparece vacía)", () => {
  assert.equal(toLessonContent(EMPTY, [], []), null);
  assert.equal(toLessonContent({}, [], []), null, "una fila anterior a la migración (sin las columnas) tampoco");
});

test("temas con su estado, objetivos, actividades y notas llegan tal cual; lo vacío se descarta", () => {
  const content = toLessonContent(
    { ...EMPTY, topics: [{ id: "t1", text: "  pasado simple ", status: "visto" }, { id: "t2", text: "", status: "visto" }, { text: "futuro", status: "x" }, "basura"], objectives: ["a", "  ", 3], activities: ["act"], activity_notes: " notas ", internal_notes: "privado" },
    [],
    []
  );
  assert.deepEqual(content?.topics, [{ id: "t1", text: "pasado simple", status: "visto" }, { id: null, text: "futuro", status: "planificado" }]);
  assert.deepEqual(content?.objectives, ["a"]);
  assert.deepEqual(content?.activities, ["act"]);
  assert.equal(content?.activityNotes, "notas");
  assert.equal(content?.internalNotes, "privado");
});

test("materiales: los de la biblioteca traen su nombre y estado de archivo; uno que todavía no se trasladó se avisa (nunca se oculta)", () => {
  const content = toLessonContent({ ...EMPTY, material_ids: ["mat-1", "mat-2", "mat-9"] }, [], [material(), material({ id: "m2", legacy_mobile_id: "mat-2", name: "Sólo nota", attachment_name: null, file_status: "sin_archivo", note: null })]);
  assert.deepEqual(content?.materials.map((m) => [m.legacyId, m.name, m.hasFile, m.availability, m.inLibrary, m.id]), [
    ["mat-1", "Unidad 3", true, "disponible", true, "m-uuid"],
    ["mat-2", "Sólo nota", false, "sin_archivo", true, "m2"],
    ["mat-9", "Material sin identificar", false, "pendiente", false, null],
  ]);
});

test("adjuntos: común a toda la clase o de un alumno, con su estado de archivo en palabras", () => {
  const content = toLessonContent(EMPTY, [attachment({ file_status: "disponible", student_id: "s1", caption: "leyenda" }), attachment({ id: "a2", name: "foto.jpg", kind: "image", file_status: "no_disponible" }), attachment({ id: "a3" })], []);
  assert.deepEqual(content?.attachments.map((a) => [a.id, a.kind, a.studentId, a.caption, a.availability]), [
    ["a1", "pdf", "s1", "leyenda", "disponible"],
    ["a2", "image", null, null, "no_disponible"],
    ["a3", "pdf", null, null, "pendiente"],
  ]);
  assert.equal(availabilityLabel("disponible"), "Archivo disponible");
  assert.equal(availabilityLabel("pendiente"), "El archivo todavía no se trasladó");
  assert.equal(availabilityLabel("no_disponible"), "El archivo ya no existía en el origen");
});

test("las marcas «no facturable» y «no consume paquete» alcanzan para mostrar la tarjeta", () => {
  assert.equal(toLessonContent({ ...EMPTY, is_billable: false }, [], [])?.isBillable, false);
  assert.equal(toLessonContent({ ...EMPTY, consumes_monthly_package: false }, [], [])?.consumesMonthlyPackage, false);
});
