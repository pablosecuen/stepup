import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptMobileBackup } from "../mobile-adapter.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";

/**
 * Filas financieras que el modelo anterior de la web no podía guardar (importe 0, correcciones con alumno o pagos que ya no existían): ahora se CONSERVAN completas, con la referencia original
 * faltante como incidencia explícita; nunca se crea un pago ni un alumno ficticio ni se altera un saldo. Datos ANONIMIZADOS.
 */

const base = () => buildMobileBackup() as Record<string, any>;

test("un cobro de importe 0 y su condonación se importan (no se omiten) y no cambian ningún otro cobro", () => {
  const before = adaptMobileBackup(base());
  const doc = base();
  doc.paymentCharges.push({ id: "chg-zero", studentId: "stu-1", type: "por_clase", savedLessonId: "les-5", originalAmount: 0, currency: "ARS", dueDate: "2026-10-12", createdAt: "2026-10-12T10:00:00.000Z", billingPeriod: "2026-10", voidedAt: null, voidReason: null });
  doc.paymentAdjustments = [...(doc.paymentAdjustments ?? []), { id: "adj-zero", chargeId: "chg-zero", studentId: "stu-1", reason: "Recargo condonado automáticamente", createdAt: "2026-10-12T10:00:00.000Z", voidedAt: null, voidReason: null }];
  const after = adaptMobileBackup(doc);
  assert.deepEqual(after.report.omitted, before.report.omitted, "no hay omisiones nuevas");
  const charges = after.payload.paymentCharges as any[];
  assert.equal(charges.find((c) => c.id === "chg-zero").originalAmount, 0, "el importe 0 se conserva tal cual (no se inventa ni se sube)");
  assert.equal((after.payload.paymentAdjustments as any[]).some((a) => a.id === "adj-zero"), true);
  assert.deepEqual(charges.filter((c) => c.id !== "chg-zero"), before.payload.paymentCharges, "los demás cobros no cambian");
  assert.equal(after.report.perCollection.paymentCharges?.omitted, 0);
});

test("una corrección de recargo con alumno y pagos inexistentes se conserva: relaciones vacías, referencias originales guardadas, incidencias explícitas y sin inventar nada", () => {
  const doc = base();
  const common = { billingPeriod: "2026-10", previousSurchargeAmount: 100, correctedAt: "2026-10-13T10:00:00.000Z", reason: "Corrección automática de situación inicial" };
  doc.initialPaidSurchargeCorrections = [
    { id: "isc-ok", studentId: "stu-1", ...common, voidedPaymentId: "pay-1", newPaymentId: "pay-2" },
    { id: "isc-orphan", studentId: "stu-borrado", ...common, voidedPaymentId: "pay-inexistente-1", newPaymentId: "pay-inexistente-2" },
    { id: "isc-half", studentId: "stu-1", ...common, voidedPaymentId: "pay-1", newPaymentId: "pay-inexistente-3" },
  ];
  const result = adaptMobileBackup(doc);
  const rows = result.payload.initialPaidSurchargeCorrections as any[];
  assert.equal(rows.length, 3, "ninguna se descarta");
  assert.deepEqual(rows.find((r) => r.id === "isc-ok"), { id: "isc-ok", studentId: "stu-1", studentMissingRef: null, billingPeriod: "2026-10", previousSurchargeAmount: 100, voidedPaymentId: "pay-1", newPaymentId: "pay-2", voidedPaymentMissingRef: null, newPaymentMissingRef: null, correctedAt: common.correctedAt, reason: common.reason });
  const orphan = rows.find((r) => r.id === "isc-orphan");
  assert.deepEqual([orphan.studentId, orphan.studentMissingRef, orphan.voidedPaymentId, orphan.voidedPaymentMissingRef, orphan.newPaymentId, orphan.newPaymentMissingRef], [null, "stu-borrado", null, "pay-inexistente-1", null, "pay-inexistente-2"]);
  const half = rows.find((r) => r.id === "isc-half");
  assert.deepEqual([half.voidedPaymentId, half.newPaymentId, half.newPaymentMissingRef], ["pay-1", null, "pay-inexistente-3"]);
  assert.equal(result.report.omitted.some((o) => o.collection === "initialPaidSurchargeCorrections"), false);
  assert.equal((result.payload.payments as any[]).length, (adaptMobileBackup(base()).payload.payments as any[]).length, "no se crea ningún pago");
  const incidents = (result.payload.originIncidents as any[]).filter((i) => i.entity === "initialPaidSurchargeCorrections").map((i) => `${i.rowId}:${i.field}:${i.originalReference}`).sort();
  assert.deepEqual(incidents, ["isc-half:newPaymentId:pay-inexistente-3", "isc-orphan:newPaymentId:pay-inexistente-2", "isc-orphan:studentId:stu-borrado", "isc-orphan:voidedPaymentId:pay-inexistente-1"]);
});

test("las incidencias no se duplican al volver a adaptar un respaldo ya adaptado (idempotente)", () => {
  const doc = base();
  doc.paymentCharges[1].calendarLessonId = "calendar_recurrence_inexistente_w1";
  const once = adaptMobileBackup(doc);
  const twice = adaptMobileBackup(once.payload);
  assert.deepEqual(twice.payload.originIncidents, once.payload.originIncidents);
});
