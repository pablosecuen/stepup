// Historial individual de pagos, estado del mes y pagos declarados de UN alumno: se ejecuta la implementación web (registros de la base → motor del original) con datos sintéticos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStudentCobrosOverview } from "../student-cobros.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../../repositories/payments-mapping.ts";

const TODAY = "2026-10-28";
const PLAN = { type: "monthly", amount: 10000, dueDay: 10 } as const;

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

function charge(studentId: string, period: string, extra: Partial<PaymentChargeRecord> = {}): PaymentChargeRecord {
  return { id: id("c"), studentId, chargeType: "mensual", originalAmount: 10000, dueDate: `${period}-10`, billingPeriod: period, savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: `${period}-01T12:00:00.000Z`, voidedAt: null, voidReason: null, ...extra };
}
function pay(studentId: string, c: PaymentChargeRecord, paidAt: string, extra: Partial<PaymentRecord> = {}): { payment: PaymentRecord; allocation: PaymentAllocationRecord } {
  const payment: PaymentRecord = { id: id("p"), studentId, amount: c.originalAmount, method: "efectivo", paidAt, recordedAt: `${paidAt}T15:00:00.000Z`, notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, operationId: null, ...extra };
  return { payment, allocation: { id: id("a"), paymentId: payment.id, chargeId: c.id, studentId, amount: c.originalAmount, excessAmount: 0, excessStatus: null } };
}

function scenario() {
  const charges = [charge("s1", "2026-06"), charge("s1", "2026-07"), charge("s1", "2026-08"), charge("s1", "2026-09"), charge("s1", "2026-10")];
  const june = pay("s1", charges[0], "2026-06-30"); // saldada tarde
  const july = pay("s1", charges[1], "2026-07-09");
  const august = pay("s1", charges[2], "2026-08-10");
  const payments = [june.payment, july.payment, august.payment];
  const allocations = [june.allocation, july.allocation, august.allocation];
  return { charges, payments, allocations };
}

test("historial de 12 meses, obligaciones en término / fuera de término, deuda actual y racha del alumno", () => {
  const { charges, payments, allocations } = scenario();
  const overview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges, payments, allocations, todayDateKey: TODAY });
  const { history } = overview;
  assert.equal(history.months.length, 12);
  assert.equal(history.months[history.months.length - 1].period, "2026-10", "el último mes es el actual");
  assert.equal(history.months[0].period, "2025-11");
  assert.equal(history.onTimeCount, 2, "julio y agosto en término");
  assert.equal(history.lateCount, 3, "junio saldada tarde y septiembre y octubre vencidas sin saldar");
  assert.equal(history.currentDebt, 20000);
  assert.equal(history.monthlyDebtStreak, 2, "septiembre y octubre con deuda seguidos");
  const byPeriod = new Map(history.months.map((m) => [m.period, m]));
  assert.equal(byPeriod.get("2026-07")?.category, "en_termino");
  assert.equal(byPeriod.get("2026-09")?.category, "mantiene_deuda");
  assert.equal(byPeriod.get("2026-01")?.category, null, "un mes sin obligaciones no es deuda");
  assert.equal(byPeriod.get("2026-09")?.totalPaid, 0);
  assert.equal(byPeriod.get("2026-08")?.totalPaid, 10000);
  assert.notEqual(history.scoring.category, "historial_insuficiente");
  assert.ok(history.scoring.score !== null);
});

test("con menos de 3 obligaciones resueltas el historial es insuficiente y no inventa un puntaje", () => {
  const c1 = charge("s1", "2026-08");
  const c2 = charge("s1", "2026-09");
  const p = pay("s1", c1, "2026-08-10");
  const overview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [c1, c2], payments: [p.payment], allocations: [p.allocation], todayDateKey: TODAY });
  assert.equal(overview.history.scoring.category, "historial_insuficiente");
  assert.equal(overview.history.scoring.score, null);
});

test("sin ninguna obligación no hay datos ni deuda", () => {
  const overview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [], payments: [], allocations: [], todayDateKey: TODAY });
  assert.ok(overview.history.months.every((m) => m.category === null));
  assert.equal(overview.history.currentDebt, 0);
  assert.equal(overview.history.monthlyDebtStreak, 0);
});

test("los datos son SÓLO del alumno: cobros, pagos y asignaciones de otro no cuentan", () => {
  const { charges, payments, allocations } = scenario();
  const other = [charge("s2", "2026-09"), charge("s2", "2026-10")];
  const otherPay = pay("s2", other[0], "2026-09-05");
  const mixed = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [...charges, ...other], payments: [...payments, otherPay.payment], allocations: [...allocations, otherPay.allocation], todayDateKey: TODAY });
  const alone = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges, payments, allocations, todayDateKey: TODAY });
  assert.deepEqual(mixed.history, alone.history);
  assert.equal(mixed.history.currentDebt, 20000);
});

test("un pago anulado y un cobro anulado no cuentan como pagado ni como deuda", () => {
  const c1 = charge("s1", "2026-08");
  const c2 = charge("s1", "2026-09", { voidedAt: "2026-09-12T10:00:00.000Z", voidReason: "error" });
  const voided = pay("s1", c1, "2026-08-10", { voidedAt: "2026-08-11T10:00:00.000Z", voidReason: "error" });
  const overview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [c1, c2], payments: [voided.payment], allocations: [voided.allocation], todayDateKey: TODAY });
  assert.equal(overview.history.currentDebt, 10000, "sólo agosto, que volvió a quedar sin pagar");
  const byPeriod = new Map(overview.history.months.map((m) => [m.period, m]));
  assert.equal(byPeriod.get("2026-09")?.category, null);
  assert.equal(byPeriod.get("2026-08")?.totalPaid, 0);
});

test("estado del mes actual, importe sugerido y pagos declarados (sólo del mes actual y vigentes)", () => {
  const current = charge("s1", "2026-10");
  const previous = charge("s1", "2026-09");
  const declared = pay("s1", current, "2026-10-10", { source: "initial_student_setup" });
  const olderDeclared = pay("s1", previous, "2026-09-10", { source: "initial_student_setup" });
  const voidedDeclared = pay("s1", current, "2026-10-12", { source: "initial_student_setup", voidedAt: "2026-10-13T10:00:00.000Z", voidReason: "x" });
  const overview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [previous, current], payments: [declared.payment, olderDeclared.payment, voidedDeclared.payment], allocations: [declared.allocation, olderDeclared.allocation, voidedDeclared.allocation], todayDateKey: TODAY });
  assert.deepEqual(overview.declaredInitialPaymentIds, [declared.payment.id]);
  assert.equal(overview.currentMonth?.label, "pagado");
  assert.equal(overview.suggested?.alreadySettled, true);
  assert.equal(overview.suggested?.amount, 0);

  const pending = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [current], payments: [], allocations: [], todayDateKey: TODAY });
  assert.equal(pending.currentMonth?.label, "vencido", "venció el 10 y hoy es 28");
  assert.equal(pending.suggested?.amount, 10000);
  assert.equal(pending.suggested?.alreadySettled, false);

  const partial = pay("s1", current, "2026-10-09");
  partial.allocation.amount = 3000;
  partial.payment.amount = 3000;
  const partialOverview = buildStudentCobrosOverview({ studentId: "s1", plan: PLAN, charges: [current], payments: [partial.payment], allocations: [partial.allocation], todayDateKey: TODAY });
  assert.equal(partialOverview.suggested?.amount, 7000, "propone el saldo real del cargo, no el precio del plan");
});

test("mensualidad que empieza el mes próximo y planes que no son mensuales", () => {
  const notStarted = buildStudentCobrosOverview({ studentId: "s1", plan: { ...PLAN, startPeriod: "2026-11" }, charges: [], payments: [], allocations: [], todayDateKey: TODAY });
  assert.equal(notStarted.currentMonth?.label, "comienza_proximo_mes");
  const perClass = buildStudentCobrosOverview({ studentId: "s1", plan: { type: "per_class", amount: 5000 }, charges: [], payments: [], allocations: [], todayDateKey: TODAY });
  assert.equal(perClass.currentMonth, null);
  assert.equal(perClass.suggested, null);
});
