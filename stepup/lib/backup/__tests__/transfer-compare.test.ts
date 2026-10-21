import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareTransfer, type DestinationDump, type PhoneExtractionManifest, type TransferComparison } from "../transfer-compare.ts";
import { buildMobileBackup, buildPhoneExtraction } from "../__fixtures__/mobile-real-shape.ts";

/**
 * Comparación origen ↔ destino del traslado. El volcado de referencia (`mobile-real-shape.destination.json`) es lo que la base REAL (Postgres) deja al
 * importar el respaldo sintético: se regenera con `node supabase/tests/postgres/transfer_rehearsal.cjs --write-golden`. Cada prueba altera una copia a
 * propósito y exige que el comparador lo note — por entidad, identificador de origen, campo y relación; nunca porque «el valor aparece en algún lado».
 */

type Row = Record<string, unknown>;
const GOLDEN = JSON.parse(readFileSync(new URL("../__fixtures__/mobile-real-shape.destination.json", import.meta.url), "utf8")) as DestinationDump;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const SOURCE = buildMobileBackup();
const PHONE = buildPhoneExtraction() as unknown as PhoneExtractionManifest;

function compare(mutate?: (d: DestinationDump) => void, source: Record<string, unknown> = SOURCE, extra: { archive?: unknown } = {}): TransferComparison {
  const dump = clone(GOLDEN);
  if (extra.archive !== undefined) dump.import_source_archives = [{ source_payload: extra.archive } as Row];
  mutate?.(dump);
  return compareTransfer(source, dump, { phoneExtraction: PHONE, revealValues: true });
}
const field = (c: TransferComparison, entity: string, name: string) => c.fields.find((f) => f.entity === entity && f.field === name);
const byLegacy = (rows: Row[], legacy: string) => rows.find((r) => r.legacy_mobile_id === legacy) as Row;

test("el volcado completo (con los archivos del teléfono registrados) da veredicto COMPLETO, con cada campo comparado", () => {
  const c = compare();
  assert.deepEqual(c.verdict.reasons, []);
  assert.equal(c.verdict.complete, true);
  assert.equal(c.summary.fieldMismatches, 0);
  assert.ok(c.summary.fieldChecks > 900, `se compararon ${c.summary.fieldChecks} campos`);
  assert.ok(c.entities.every((e) => e.ok && e.missing.length === 0 && (e.destination > 0 || e.source === 0)), "todas las entidades del fixture llegaron");
  assert.equal(c.entities.length, 33);
  assert.deepEqual(c.undeclared, []);
  assert.deepEqual(c.preservedOnlyInArchive, []);
});

test("teléfonos intercambiados entre dos alumnos: se detecta aunque los dos números sigan existiendo en el destino", () => {
  const c = compare((d) => {
    const a = byLegacy(d.students, "stu-1");
    const b = byLegacy(d.students, "stu-2");
    [a.phone, b.phone] = [b.phone, a.phone];
  });
  assert.equal(field(c, "Alumnos", "phone")?.mismatched, 2);
  assert.equal(c.verdict.complete, false);
  assert.match(c.verdict.reasons.join("\n"), /Alumnos · phone: 2 de 4/);
});

test("cobros intercambiados entre dos alumnos: la relación (alumno) se compara contra la fila a la que apunta de verdad", () => {
  const c = compare((d) => {
    const a = byLegacy(d.payment_charges, "chg-1");
    const b = byLegacy(d.payment_charges, "chg-2");
    [a.student_id, b.student_id] = [b.student_id, a.student_id];
  });
  const line = field(c, "Cobros", "alumno (relación)");
  assert.equal(line?.mismatched, 2);
  assert.deepEqual(line?.examples.map((e) => [e.id, e.source, e.destination]).sort(), [["chg-1", "stu-1", "stu-2"], ["chg-2", "stu-2", "stu-1"]]);
});

test("importe incorrecto: un solo centavo de diferencia no pasa", () => {
  const c = compare((d) => {
    (byLegacy(d.payment_charges, "chg-1").original_amount as number) += 0.01;
  });
  assert.equal(field(c, "Cobros", "originalAmount")?.mismatched, 1);
  assert.equal(c.verdict.complete, false);
});

test("asignaciones de pago apuntando a otro cobro: relación rota", () => {
  const c = compare((d) => {
    const a = byLegacy(d.payment_allocations, "alo-1");
    a.charge_id = byLegacy(d.payment_charges, "chg-4").id;
  });
  assert.equal(field(c, "Asignaciones de pago", "cobro (relación)")?.mismatched, 1);
});

test("temas, notas y objetivos intercambiados entre dos clases se detectan", () => {
  const c = compare((d) => {
    const a = byLegacy(d.lesson_registrations, "les-1");
    const b = byLegacy(d.lesson_registrations, "les-2");
    for (const k of ["topics", "objectives", "internal_notes"]) [a[k], b[k]] = [b[k], a[k]];
  });
  assert.equal(field(c, "Clases registradas", "form.topics")?.mismatched, 2);
  assert.equal(field(c, "Clases registradas", "form.internalNotes")?.mismatched, 2);
  assert.equal(c.verdict.complete, false);
});

test("un dato presente SÓLO en el archivo del origen NO cuenta como migrado, aunque el archivo lo tenga", () => {
  const archive = { pedagogicalLessons: SOURCE.pedagogicalLessons, students: SOURCE.students };
  const c = compare(
    (d) => {
      for (const r of d.lesson_registrations) {
        r.topics = [];
        r.internal_notes = "";
        r.activity_notes = "";
      }
    },
    SOURCE,
    { archive }
  );
  assert.equal(c.verdict.complete, false);
  assert.ok((field(c, "Clases registradas", "form.topics")?.mismatched ?? 0) >= 1);
  assert.ok((field(c, "Clases registradas", "form.internalNotes")?.mismatched ?? 0) >= 1);
  assert.ok(c.verdict.reasons.some((r) => r.includes("form.topics")));
});

test("un campo del origen que ningún mapeo conoce se informa, y si el archivo lo tiene se dice «sólo preservado en el archivo» (igual incompleto)", () => {
  const source = clone(SOURCE);
  (source.paymentCharges as Row[])[0].campoNuevoDeLaApp = "ZQ-solo-en-archivo";
  const c = compare(undefined, source, { archive: { paymentCharges: source.paymentCharges } });
  assert.deepEqual(c.undeclared.map((u) => [u.entity, u.key, u.rows, u.preservedInArchive]), [["Cobros", "campoNuevoDeLaApp", 1, true]]);
  assert.deepEqual(c.preservedOnlyInArchive, ["Cobros.campoNuevoDeLaApp"]);
  assert.equal(c.verdict.complete, false);
  assert.match(c.verdict.reasons.join("\n"), /sólo preservado en el archivo/);
  // un campo nuevo de la clase registrada (o del alumno) se conserva en source_extras: si NO está ahí, se detecta por comparación
  const lesson = clone(SOURCE);
  ((lesson.pedagogicalLessons as Row[])[0].form as Row).campoNuevo = "ZQ-form";
  const c2 = compare(undefined, lesson);
  assert.equal(field(c2, "Clases registradas", "reserva, cronómetro, puntualidad, importes por alumno y campos nuevos (source_extras)")?.mismatched, 1);
});

test("fila faltante, duplicada u omitida por el adaptador: se informa por identificador de origen y el veredicto no es completo", () => {
  const lost = compare((d) => {
    d.payments = d.payments.filter((p) => p.legacy_mobile_id !== "pay-2");
  });
  assert.deepEqual(lost.entities.find((e) => e.entity === "Pagos")?.missing, ["pay-2"]);
  assert.equal(lost.verdict.complete, false);

  const dup = compare((d) => {
    d.students.push({ ...byLegacy(d.students, "stu-1"), id: "00000000-0000-4000-8000-00000000dead" });
  });
  assert.deepEqual(dup.duplicates, [{ table: "students", legacyId: "stu-1", count: 2 }]);

  const dump = clone(GOLDEN);
  const omitted = compareTransfer(SOURCE, dump, { phoneExtraction: PHONE, adapterOmitted: [{ collection: "paymentCharges", id: "chg-1" }] });
  assert.equal(omitted.omittedByAdapter, 1);
  assert.equal(omitted.entities.find((e) => e.entity === "Cobros")?.ok, false, "una fila omitida NO se da por correcta aunque el destino coincida con el resto");
  assert.equal(omitted.verdict.complete, false);
});

test("fechas originales reemplazadas por la fecha de la importación: se detectan (creación de cobros, registro de pagos, creación de clases)", () => {
  const c = compare((d) => {
    byLegacy(d.payments, "pay-1").recorded_at = "2026-10-19T00:00:00+00:00";
    byLegacy(d.payment_charges, "chg-1").created_at = "2026-10-19T00:00:00+00:00";
    byLegacy(d.lesson_registrations, "les-1").created_at = "2026-10-19T00:00:00+00:00";
  });
  assert.equal(field(c, "Pagos", "recordedAt")?.mismatched, 1);
  assert.equal(field(c, "Cobros", "createdAt")?.mismatched, 1);
  assert.equal(field(c, "Clases registradas", "createdAt")?.mismatched, 1);
});

test("estado de registros grupales reiniciado (todos «pendiente») o registro «en curso» convertido en finalizado: se detecta", () => {
  const reset = compare((d) => {
    for (const p of d.lesson_registration_students) p.participant_status = "pending";
  });
  assert.ok((field(reset, "Integrantes de registros", "estado del participante")?.mismatched ?? 0) >= 1);
  const finished = compare((d) => {
    byLegacy(d.lesson_registrations, "les-2").status = "completed";
  });
  assert.equal(field(finished, "Clases registradas", "registrationStatus")?.mismatched, 1);
});

test("notas: se verifica la nota válida Y el valor original; perder el original (o la bandera de revisión) no pasa", () => {
  const c = compare((d) => {
    for (const e of d.lesson_registration_evaluations) e.source_grades = null;
  });
  assert.ok((field(c, "Evaluaciones", "generalGrade ORIGINAL (source_grades)")?.mismatched ?? 0) >= 1);
  assert.ok((field(c, "Evaluaciones", "notas a revisar (flags)")?.mismatched ?? 0) >= 1);
  const wrong = compare((d) => {
    const ev = (d.lesson_registration_evaluations as Row[]).find((e) => (e.source_grades as Row | null)?.generalGrade === 12) as Row;
    ev.general_grade = 10; // «arreglar» la nota 12 a 10 en silencio
  });
  assert.equal(field(wrong, "Evaluaciones", "generalGrade (válida 1–10)")?.mismatched, 1);
});

test("reportes: el snapshot ORIGINAL completo tiene que estar dentro del reporte de la web", () => {
  const c = compare((d) => {
    const r = d.report_records[0] as Row;
    (r.snapshot as Row)._mobileRecord = { snapshot: null, permanentPdfUri: null };
  });
  assert.equal(field(c, "Reportes generados", "snapshot ORIGINAL completo")?.mismatched, 1);
  assert.equal(field(c, "Reportes generados", "ruta original del PDF")?.mismatched, 1);
});

test("historiales sin identificador (estados, precios, ediciones): se comparan por posición dentro del alumno o la clase", () => {
  const c = compare((d) => {
    const row = d.student_status_history[0] as Row;
    row.reason = "otro motivo";
    (d.student_price_history[1] as Row).price = 1;
    (d.lesson_registration_edit_history[0] as Row).previous_snapshot = { _format: "mobile_v1", previousForm: {} };
  });
  assert.equal(field(c, "Historial de estados", "reason")?.mismatched, 1);
  assert.equal(field(c, "Historial de precios", "price")?.mismatched, 1);
  assert.equal(field(c, "Historial de ediciones", "versión anterior de la clase")?.mismatched, 1);
});

test("archivos: «disponible» sólo con archivo registrado y huella; sin eso figura como pendiente y el veredicto no es completo", () => {
  const done = compare();
  assert.deepEqual(done.files.map((f) => [f.kind, f.total, f.available, f.pending]), [["adjunto", 1, 1, 0], ["material", 2, 2, 0], ["reporte_pdf", 1, 1, 0]]);

  const none = compare((d) => {
    const a = d.lesson_attachments[0] as Row;
    a.file_status = "pendiente";
    a.storage_path = null;
    a.sha256 = null;
    (d.report_records[0] as Row).pdf_url = null;
    d.material_library_items = [];
  });
  assert.deepEqual(none.files.map((f) => [f.kind, f.pending]), [["adjunto", 1], ["material", 2], ["reporte_pdf", 1]]);
  assert.equal(none.verdict.complete, false);
  assert.equal(none.verdict.reasons.filter((r) => r.startsWith("Archivos")).length, 3);

  // un archivo que el teléfono ya no tiene se DECLARA (no se espera), pero lo declara la extracción, nunca el comparador por su cuenta
  const declared = compareTransfer(SOURCE, (() => {
    const d = clone(GOLDEN);
    (d.report_records[0] as Row).pdf_url = null;
    return d;
  })(), { phoneExtraction: { ...PHONE, missingAtOrigin: ["report:rep-1"] } });
  assert.deepEqual(declared.files.find((f) => f.kind === "reporte_pdf"), { kind: "reporte_pdf", total: 1, available: 0, pending: 0, unavailableAtOrigin: 1, examples: [] });
  assert.equal(declared.verdict.complete, true);
  assert.equal(declared.verdict.absentAtOrigin, 1, "pero el veredicto lo informa SIEMPRE aparte: ese archivo no está migrado en ningún lado");
  assert.equal(declared.files.find((f) => f.kind === "reporte_pdf")?.available, 0, "ausente ≠ disponible");
  assert.equal(done.verdict.absentAtOrigin, 0);
});

test("con datos reales los ejemplos NO llevan valores (ni nombres, ni teléfonos, ni importes): sólo identificador, tipo, largo y huella", () => {
  const dump = clone(GOLDEN);
  const a = byLegacy(dump.students, "stu-1");
  const b = byLegacy(dump.students, "stu-2");
  [a.phone, b.phone] = [b.phone, a.phone];
  (byLegacy(dump.payment_charges, "chg-1").original_amount as number) += 1;
  const c = compareTransfer(SOURCE, dump, { phoneExtraction: PHONE });
  const text = JSON.stringify(c);
  for (const secret of ["+54 9 11 5550-0001", "+54 9 11 5550-0002", "41000.37", "ZQ Alumna Uno", "ZQ nota privada"]) assert.equal(text.includes(secret), false, secret);
  assert.match(field(c, "Alumnos", "phone")!.examples[0].source, new RegExp("^«texto, [0-9]+ car[.], #[0-9a-f]{8}»$"));
  assert.notEqual(field(c, "Alumnos", "phone")!.examples[0].source, field(c, "Alumnos", "phone")!.examples[0].destination);
});

test("el comparador no escribe ni modifica nada: el volcado de entrada queda igual", () => {
  const before = JSON.stringify(GOLDEN);
  compare();
  assert.equal(JSON.stringify(GOLDEN), before);
});
