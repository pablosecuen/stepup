// Circuito WEB de «Comportamiento de pago»: registros con la forma de la base → 12 meses de alumnos únicos por categoría, con el motor del original.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../../repositories/payments-mapping.ts";
import { buildPaymentBehavior, PAYMENT_BEHAVIOR_SEGMENTS } from "../payment-behavior.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-28";

function charge(id: string, studentId: string, period: string, over: Partial<PaymentChargeRecord> = {}): PaymentChargeRecord {
  return { id, studentId, chargeType: "mensual", originalAmount: 50000, dueDate: `${period}-10`, billingPeriod: period, savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: `${period}-01T12:00:00Z`, voidedAt: null, voidReason: null, ...over };
}
const pay = (id: string, studentId: string, paidAt: string, amount = 50000): PaymentRecord => ({ id, studentId, amount, method: "efectivo", paidAt, recordedAt: `${paidAt}T15:00:00Z`, notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, operationId: null });
const alloc = (id: string, paymentId: string, chargeId: string, studentId: string, amount = 50000): PaymentAllocationRecord => ({ id, paymentId, chargeId, studentId, amount, excessAmount: 0, excessStatus: null });
const month = (months: ReturnType<typeof buildPaymentBehavior>, period: string) => months.find((entry) => entry.period === period)!;

test("siempre devuelve 12 meses consecutivos, el último es el mes actual, y sin datos todo es cero", () => {
  const months = buildPaymentBehavior({ charges: [], payments: [], allocations: [], todayDateKey: TODAY });
  assert.equal(months.length, 12);
  assert.equal(months[0].period, "2025-11");
  assert.equal(months[11].period, "2026-10");
  assert.ok(months.every((entry) => entry.totalUniqueStudentsEvaluated === 0));
});

test("un alumno que pagó antes del vencimiento cuenta «en término»; el que sigue sin pagar un mes vencido cuenta «mantiene deuda»", () => {
  const months = buildPaymentBehavior({
    charges: [charge("c1", "a", "2026-09"), charge("c2", "b", "2026-09")],
    payments: [pay("p1", "a", "2026-09-05")],
    allocations: [alloc("a1", "p1", "c1", "a")],
    todayDateKey: TODAY,
  });
  const september = month(months, "2026-09");
  assert.equal(september.studentsOnTime, 1);
  assert.equal(september.studentsInDebt, 1);
  assert.equal(september.totalUniqueStudentsEvaluated, 2);
});

test("cada alumno cuenta UNA sola vez por mes, en su peor situación; las categorías suman el total", () => {
  const months = buildPaymentBehavior({
    charges: [charge("c1", "a", "2026-09"), charge("c2", "a", "2026-09", { chargeType: "semanal", billingPeriod: "2026-W38", dueDate: "2026-09-20" })],
    payments: [pay("p1", "a", "2026-09-05")],
    allocations: [alloc("a1", "p1", "c1", "a")],
    todayDateKey: TODAY,
  });
  const september = month(months, "2026-09");
  assert.equal(september.totalUniqueStudentsEvaluated, 1, "un único alumno");
  const sum = PAYMENT_BEHAVIOR_SEGMENTS.reduce((total, segment) => total + september[segment.key], 0);
  assert.equal(sum, september.totalUniqueStudentsEvaluated);
});

test("un cobro anulado no cuenta; un cobro que todavía no venció no perjudica ni beneficia", () => {
  const months = buildPaymentBehavior({
    charges: [charge("c1", "a", "2026-09", { voidedAt: "2026-09-02T10:00:00Z", voidReason: "error" }), charge("c2", "b", "2026-10")],
    payments: [],
    allocations: [],
    todayDateKey: "2026-10-05",
  });
  assert.equal(month(months, "2026-09").totalUniqueStudentsEvaluated, 0, "anulado: fuera");
  assert.equal(month(months, "2026-10").totalUniqueStudentsEvaluated, 0, "vence el 10: todavía no venció el 5");
});

test("el pago anulado no cuenta como pagado", () => {
  const voidedPay: PaymentRecord = { ...pay("p1", "a", "2026-09-05"), voidedAt: "2026-09-06T10:00:00Z", voidReason: "error de carga" };
  const months = buildPaymentBehavior({ charges: [charge("c1", "a", "2026-09")], payments: [voidedPay], allocations: [alloc("a1", "p1", "c1", "a")], todayDateKey: TODAY });
  assert.equal(month(months, "2026-09").studentsInDebt, 1);
  assert.equal(month(months, "2026-09").studentsOnTime, 0);
});

test("cableado: la pantalla es de sólo lectura, deja afuera los datos de prueba, muestra los números en texto y se llega desde Resumen financiero", () => {
  const page = read("app/(app)/resumen-financiero/comportamiento-de-pago/page.tsx");
  assert.match(page, /buildPaymentBehavior\(/);
  assert.match(page, /excluded\.has\(row\.studentId\)/);
  assert.match(page, /\$\{segment\.label\}: \$\{month\[segment\.key\]\}/, "las cantidades salen como texto, no sólo como color");
  assert.doesNotMatch(page, /\.rpc\(|\.insert\(|\.update\(|use server/);
  assert.match(read("components/finance/financial-overview-view.tsx"), /href="\/resumen-financiero\/comportamiento-de-pago"/);
});
