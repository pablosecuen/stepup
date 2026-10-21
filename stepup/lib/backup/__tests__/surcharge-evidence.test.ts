import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAllExcesses, classifyChargeExcess, dueStage, historicalSurchargeAmount, tierValuesFor, type PaymentInput } from "../surcharge-evidence.ts";
import { adaptMobileBackup } from "../mobile-adapter.ts";
import { compareTransfer, type DestinationDump } from "../transfer-compare.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Exceso pagado sobre el importe base: se separa SIEMPRE, y sólo se llama «recargo confirmado» cuando el cálculo de recargos de la app (el que regía hasta el 16/09/2026) lo explica
 * exactamente. Coincidir con un porcentaje NO alcanza. Datos ANONIMIZADOS.
 */

const TIER = { enabled: true, graceDay: 10, firstLateDay: 11, firstLatePercentage: 10, secondLateDay: 19, secondLatePercentage: 15, lastLateDay: 27, lastLatePercentage: 20 };
const SETTINGS = { current: TIER, pending: null, pendingEffectiveFrom: null };
const charge = (over: Record<string, unknown> = {}) => ({ id: "chg", type: "mensual", originalAmount: 1000, dueDate: "2026-07-10", billingPeriod: "2026-07", voidedAt: null, ...over }) as Parameters<typeof classifyChargeExcess>[0];
const pay = (id: string, paidAt: string, over: Partial<PaymentInput> = {}): [string, PaymentInput] => [id, { id, paidAt, recordedAt: `${paidAt}T12:00:00.000Z`, voidedAt: null, ...over }];
const payments = (...list: Array<[string, PaymentInput]>) => new Map(list);
const alloc = (id: string, paymentId: string, amount: number) => ({ id, chargeId: "chg", paymentId, amount });

test("el motor de la app: etapas por días desde el vencimiento y recargo redondeado al entero, sólo si la configuración está habilitada", () => {
  assert.equal(dueStage("mensual", "2026-07-10", "2026-07-19", TIER), "on_time", "día 10 desde el vencimiento: en término");
  assert.equal(dueStage("mensual", "2026-07-10", "2026-07-20", TIER), "first_late");
  assert.equal(dueStage("mensual", "2026-07-10", "2026-07-28", TIER), "second_late");
  assert.equal(dueStage("mensual", "2026-07-10", "2026-08-05", TIER), "last_late");
  assert.equal(dueStage("por_clase", "2026-07-10", "2026-07-17", TIER), "first_late");
  assert.equal(historicalSurchargeAmount(1000, "second_late", TIER), 150);
  assert.equal(historicalSurchargeAmount(1001, "first_late", TIER), 100, "se redondea al entero como la app");
  assert.equal(historicalSurchargeAmount(1000, "last_late", { ...TIER, enabled: false }), 0);
  assert.equal(tierValuesFor({ current: TIER, pending: { ...TIER, enabled: false }, pendingEffectiveFrom: "2026-08" }, "2026-07")?.enabled, true);
  assert.equal(tierValuesFor({ current: TIER, pending: { ...TIER, enabled: false }, pendingEffectiveFrom: "2026-08" }, "2026-08")?.enabled, false);
});

test("sin exceso (pago exacto, parcial o con un pago anulado de por medio) no hay nada que clasificar", () => {
  assert.equal(classifyChargeExcess(charge(), [alloc("a1", "p1", 1000)], payments(pay("p1", "2026-07-12")), false, SETTINGS), null);
  assert.equal(classifyChargeExcess(charge(), [alloc("a1", "p1", 400)], payments(pay("p1", "2026-07-12")), false, SETTINGS), null);
  const voided = classifyChargeExcess(charge(), [alloc("a1", "p1", 1000), alloc("a2", "p2", 1000)], payments(pay("p1", "2026-07-12", { voidedAt: "2026-07-13T00:00:00.000Z" }), pay("p2", "2026-07-14")), false, SETTINGS);
  assert.equal(voided, null, "la asignación de un pago anulado no cuenta");
});

test("recargo CONFIRMADO: el exceso coincide exactamente con lo que la app calculaba el día en que el cobro quedó saldado", () => {
  const r = classifyChargeExcess(charge(), [alloc("a1", "p1", 1150)], payments(pay("p1", "2026-07-28")), false, SETTINGS);
  assert.ok(r);
  assert.equal(r.status, "recargo_confirmado");
  assert.equal(r.excessTotal, 150);
  assert.deepEqual(r.allocations, [{ allocationId: "a1", paymentId: "p1", excessAmount: 150 }]);
  assert.equal(r.evidence.etapaAlSaldar, "second_late");
  assert.equal(r.evidence.recargoCalculadoAlSaldar, 150);
});

test("coincidir con un porcentaje NO alcanza: otro día, otro monto, configuración deshabilitada o condonación → pendiente de clasificación, sin inventar causa", () => {
  // 20 % pagado en etapa de 15 %
  const wrongStage = classifyChargeExcess(charge(), [alloc("a1", "p1", 1200)], payments(pay("p1", "2026-07-28")), false, SETTINGS);
  assert.equal(wrongStage?.status, "pendiente_de_clasificacion");
  assert.equal(wrongStage?.excessTotal, 200);
  // 10 % pagado en término (la app no cobraba recargo ese día)
  const onTime = classifyChargeExcess(charge(), [alloc("a1", "p1", 1100)], payments(pay("p1", "2026-07-15")), false, SETTINGS);
  assert.equal(onTime?.status, "pendiente_de_clasificacion");
  // el porcentaje correcto pero la configuración de ese período estaba deshabilitada
  const disabled = classifyChargeExcess(charge(), [alloc("a1", "p1", 1150)], payments(pay("p1", "2026-08-05")), false, { current: TIER, pending: { ...TIER, enabled: false }, pendingEffectiveFrom: "2026-08" });
  assert.equal(disabled?.status, "pendiente_de_clasificacion");
  // condonado: ningún recargo puede explicar el exceso
  const waived = classifyChargeExcess(charge(), [alloc("a1", "p1", 1150)], payments(pay("p1", "2026-07-28")), true, SETTINGS);
  assert.equal(waived?.status, "pendiente_de_clasificacion");
  // sin configuración de recargos en el respaldo
  const noSettings = classifyChargeExcess(charge(), [alloc("a1", "p1", 1150)], payments(pay("p1", "2026-07-28")), false, undefined);
  assert.equal(noSettings?.status, "pendiente_de_clasificacion");
  assert.equal(noSettings?.evidence.configuracionEncontrada, false);
  for (const r of [wrongStage, onTime, disabled, waived, noSettings]) assert.match(String(r?.evidence.conclusion), /no explica el exceso; se conserva sin atribuirle una causa/);
});

test("el exceso se atribuye a la asignación que supera el importe base (orden cronológico) y los importes no se tocan", () => {
  const r = classifyChargeExcess(charge(), [alloc("a-late", "p2", 900), alloc("a-early", "p1", 400)], payments(pay("p1", "2026-07-12"), pay("p2", "2026-07-30")), false, SETTINGS);
  assert.ok(r);
  assert.equal(r.activeTotal, 1300);
  assert.deepEqual(r.allocations, [{ allocationId: "a-late", paymentId: "p2", excessAmount: 300 }], "400 base + 600 de la segunda; los otros 300 son exceso de la segunda");
});

test("adaptador: la asignación lleva el exceso separado y su monto original intacto; los importes de pagos y cobros no cambian", () => {
  const doc = buildMobileBackup() as Record<string, any>;
  doc.payments.push({ id: "pay-x", studentId: "stu-1", amount: 100, currency: "ARS", method: "transferencia", paidAt: "2026-10-20", recordedAt: "2026-10-20T10:00:00.000Z", notes: null, voidedAt: null, voidReason: null });
  doc.paymentAllocations.push({ id: "alo-x", paymentId: "pay-x", chargeId: "chg-1", studentId: "stu-1", amount: 100 });
  const before = adaptMobileBackup(buildMobileBackup());
  const after = adaptMobileBackup(doc);
  const allocation = (after.payload.paymentAllocations as any[]).find((a) => a.id === "alo-x");
  assert.equal(allocation.amount, 100);
  assert.equal(allocation.excess.amount, 100);
  assert.equal(allocation.excess.status, "pendiente_de_clasificacion");
  assert.deepEqual(after.payload.paymentCharges, before.payload.paymentCharges, "ningún cobro cambia");
  assert.deepEqual((after.payload.payments as any[]).slice(0, (before.payload.payments as any[]).length), before.payload.payments, "ningún pago cambia");
  assert.equal(after.report.conversions.find((c) => c.code === "excess_pending_classification")?.count, 1);
  assert.equal(classifyAllExcesses(doc).get("alo-x")?.excessAmount, 100);
});

const GOLDEN = JSON.parse(readFileSync(join(import.meta.dirname, "..", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as DestinationDump;

test("comparador: el exceso y su clasificación se verifican en el destino; un exceso perdido o reclasificado se detecta; el balance por entidad cierra", () => {
  const doc = buildMobileBackup() as Record<string, any>;
  doc.payments.push({ id: "pay-x", studentId: "stu-1", amount: 100, currency: "ARS", method: "transferencia", paidAt: "2026-10-20", recordedAt: "2026-10-20T10:00:00.000Z", notes: null, voidedAt: null, voidReason: null });
  doc.paymentAllocations.push({ id: "alo-x", paymentId: "pay-x", chargeId: "chg-1", studentId: "stu-1", amount: 100 });
  const excess = classifyAllExcesses(doc).get("alo-x");
  assert.ok(excess);
  const dump = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  const chargeRow = dump.payment_charges.find((r) => r.legacy_mobile_id === "chg-1") as Record<string, unknown>;
  const studentRow = dump.students.find((r) => r.legacy_mobile_id === "stu-1") as Record<string, unknown>;
  const paymentRow = { ...(dump.payments[0] as Record<string, unknown>), id: "00000000-0000-4000-8000-00000000d001", legacy_mobile_id: "pay-x", amount: 100, paid_at: "2026-10-20", recorded_at: "2026-10-20T10:00:00.000Z", voided_at: null, void_reason: null, notes: null };
  dump.payments.push(paymentRow);
  const allocationRow = { ...(dump.payment_allocations[0] as Record<string, unknown>), id: "00000000-0000-4000-8000-00000000d002", legacy_mobile_id: "alo-x", payment_id: paymentRow.id, charge_id: chargeRow.id, student_id: studentRow.id, amount: 100, excess_amount: 100, excess_status: excess.status, excess_evidence: excess.evidence };
  dump.payment_allocations.push(allocationRow);
  const ok = compareTransfer(doc, dump, { adapterOmitted: [] });
  assert.deepEqual(ok.fields.filter((f) => f.mismatched > 0).map((f) => `${f.entity}·${f.field}`), [], "con el exceso separado y clasificado no hay diferencias");
  assert.equal(ok.reconciliation.balanced, true);
  assert.equal(ok.reconciliation.sourceRows, ok.reconciliation.omittedByAdapter + ok.reconciliation.expectedRows);
  assert.equal(ok.reconciliation.expectedRows, ok.reconciliation.foundRows + ok.reconciliation.missingRows);

  const lost = JSON.parse(JSON.stringify(dump)) as DestinationDump;
  Object.assign(lost.payment_allocations.find((r) => r.legacy_mobile_id === "alo-x") as Record<string, unknown>, { excess_amount: 0, excess_status: null, excess_evidence: null });
  assert.ok(compareTransfer(doc, lost, { adapterOmitted: [] }).fields.some((f) => /excess_amount/.test(f.field) && f.mismatched > 0), "un exceso que se perdió en el destino se detecta");

  const reclassified = JSON.parse(JSON.stringify(dump)) as DestinationDump;
  (reclassified.payment_allocations.find((r) => r.legacy_mobile_id === "alo-x") as Record<string, unknown>).excess_status = "recargo_confirmado";
  assert.ok(compareTransfer(doc, reclassified, { adapterOmitted: [] }).fields.some((f) => /excess_status/.test(f.field) && f.mismatched > 0), "una reclasificación a «recargo confirmado» sin evidencia se detecta");
});
