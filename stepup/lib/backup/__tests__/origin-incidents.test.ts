import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOriginIncidents } from "../origin-incidents.ts";
import { CalendarRefResolver } from "../calendar-refs.ts";
import { compareTransfer, type DestinationDump } from "../transfer-compare.ts";
import { adaptMobileBackup } from "../mobile-adapter.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";

/** Incidencias del origen: se conservan, se verifican en el destino y NO cuentan como defectos del traslado. Datos ANONIMIZADOS. */

const GOLDEN = JSON.parse(readFileSync(join(import.meta.dirname, "..", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as DestinationDump;

function docWithDanglingCharge() {
  const doc = buildMobileBackup() as Record<string, any>;
  doc.paymentCharges.find((c: any) => c.id === "chg-3").calendarLessonId = "calendar_recurrence_inexistente_w2";
  return doc;
}

test("las incidencias tienen identificador estable, la referencia original y el motivo; sin referencias rotas no hay ninguna", () => {
  const clean = buildMobileBackup() as Record<string, any>;
  assert.deepEqual(buildOriginIncidents(clean, new CalendarRefResolver(clean.calendarLessons, clean.pedagogicalLessons)), []);
  const doc = docWithDanglingCharge();
  const incidents = buildOriginIncidents(doc, new CalendarRefResolver(doc.calendarLessons, doc.pedagogicalLessons));
  assert.deepEqual(incidents.map((i) => [i.id, i.entity, i.rowId, i.field, i.originalReference, i.kind]), [["incidencia:paymentCharges:chg-3:calendarLessonId", "paymentCharges", "chg-3", "calendarLessonId", "calendar_recurrence_inexistente_w2", "referencia_inexistente_en_origen"]]);
  assert.match(String(incidents[0].detail.motivo), /no existe en el respaldo/);
});

test("comparador: la incidencia que falta en el destino es un defecto del traslado; con la incidencia presente el cotejo queda completo y se informa aparte", () => {
  const doc = docWithDanglingCharge();
  const adaptation = adaptMobileBackup(doc);
  const incident = (adaptation.payload.originIncidents as any[])[0];
  const missing = compareTransfer(doc, JSON.parse(JSON.stringify(GOLDEN)), { adapterOmitted: [] });
  assert.ok(missing.verdict.reasons.some((r) => /Incidencias del origen/.test(r) && /faltan 1 de 1/.test(r)), "sin la incidencia en el destino, falta");
  assert.equal(missing.reconciliation.missingRows, 1);

  const dump = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  // el cobro con la clase inexistente queda sin enlace en la web (como lo importa la base) y la incidencia queda registrada
  (dump.payment_charges.find((r) => r.legacy_mobile_id === "chg-3") as Record<string, unknown>).calendar_lesson_id = null;
  dump.origin_incidents = [{ id: "00000000-0000-4000-8000-00000000e001", legacy_mobile_id: incident.id, entity: incident.entity, row_legacy_id: incident.rowId, field: incident.field, original_reference: incident.originalReference, kind: incident.kind, detail: incident.detail }];
  const complete = compareTransfer(doc, dump, { adapterOmitted: [] });
  assert.deepEqual(complete.fields.filter((f) => f.mismatched > 0).map((f) => `${f.entity}·${f.field}`), []);
  assert.equal(complete.reconciliation.missingRows, 0);
  assert.equal(complete.reconciliation.balanced, true);
  assert.equal(complete.verdict.originInconsistencies, 1, "se informa como inconsistencia del origen");
  assert.equal(complete.originIncidents.length, 1);
  assert.equal(complete.verdict.reasons.some((r) => /Incidencias/.test(r)), false, "una incidencia conservada no es un motivo de incompletitud");
});

test("sin leer el teléfono, «0 ausentes» NO está comprobado; con la extracción registrada sí", () => {
  const doc = buildMobileBackup() as Record<string, any>;
  const withoutPhone = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  withoutPhone.phone_extraction_results = [];
  assert.equal(compareTransfer(doc, withoutPhone, { adapterOmitted: [] }).verdict.absentAtOriginVerified, false);
  assert.equal(compareTransfer(doc, withoutPhone, { adapterOmitted: [], phoneExtraction: { missingAtOrigin: [], materials: [] } as never }).verdict.absentAtOriginVerified, true);
});
