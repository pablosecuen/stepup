// Circuito WEB de «Revisar consistencia»: registros con la forma de la base → cantidades por categoría, con el analizador del original. Sólo lectura, sin nombres.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../../repositories/payments-mapping.ts";
import type { StudentRecord } from "../../repositories/students-mapping.ts";
import { buildConsistencyReport, CONSISTENCY_MESSAGES, type DecisionLike } from "../consistency.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-28";

function student(id: string, over: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id, name: `Nombre Secreto ${id}`, phone: null, whatsapp: null, email: null, usualDays: [], usualTime: null, notes: null, birthDate: null, levels: ["B1"], initialLevel: "B1", modality: "presencial", status: "activo",
    category: "otro", billingType: "mensual", billingPlan: { type: "monthly", amount: 50000, dueDay: 10 }, dateJoined: "2026-01-01", lastReactivatedAt: null, statusChangeDate: null, usualDurationMinutes: 60,
    weeklyFrequency: 1, price: 50000, pendingHomework: null, alerts: [], currentGoals: [], strengths: [], areasToImprove: [], isFeatured: false, isNew: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}
function charge(id: string, studentId: string, period: string, amount: number, over: Partial<PaymentChargeRecord> = {}): PaymentChargeRecord {
  return { id, studentId, chargeType: "mensual", originalAmount: amount, dueDate: `${period}-10`, billingPeriod: period, savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: `${period}-01T12:00:00Z`, voidedAt: null, voidReason: null, ...over };
}
function pay(id: string, studentId: string, amount: number, over: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id, studentId, amount, method: "efectivo", paidAt: "2026-10-05", recordedAt: "2026-10-05T15:00:00Z", notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, operationId: null, ...over };
}
const alloc = (id: string, paymentId: string, chargeId: string, studentId: string, amount: number): PaymentAllocationRecord => ({ id, paymentId, chargeId, studentId, amount, excessAmount: 0, excessStatus: null });
const counts = (view: ReturnType<typeof buildConsistencyReport>) => Object.fromEntries(view.items.map((item) => [item.category, item.count]));
const empty = { payments: [], allocations: [], decisions: [] as DecisionLike[], todayDateKey: TODAY };

test("una cuenta coherente no tiene hallazgos", () => {
  const view = buildConsistencyReport({ students: [student("a")], charges: [charge("c1", "a", "2026-10", 50000)], payments: [pay("p1", "a", 50000)], allocations: [alloc("a1", "p1", "c1", "a", 50000)], decisions: [], todayDateKey: TODAY });
  assert.equal(view.total, 0);
  assert.deepEqual(view.items, []);
});

test("el cargo de este mes con otro importe que el plan se reporta; los MESES ANTERIORES con otro importe NO (un cargo viejo conserva su precio)", () => {
  const students = [student("a"), student("b")];
  const view = buildConsistencyReport({ ...empty, students, charges: [charge("c1", "a", "2026-10", 45000), charge("c2", "b", "2026-10", 50000), charge("c3", "b", "2026-08", 30000), charge("c4", "b", "2026-09", 40000)] });
  assert.deepEqual(counts(view), { plan_amount_diverges_from_charge: 1 });
});

test("un primer mes con decisión propia (proporcional) no se reporta como error", () => {
  const decision: DecisionLike = { id: "d", studentId: "a", billingPeriod: "2026-10", effectiveJoinDate: "2026-10-15", criterion: "proportional", classesRemaining: 2, classesPerFullPeriod: 4, permanentMonthlyAmount: 50000, chargedAmount: 25000, chargeId: "c1", createdAt: "2026-10-15T10:00:00Z", confirmedAt: "2026-10-15T10:00:00Z", source: "manual" };
  const view = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 25000)], decisions: [decision] });
  assert.equal(view.total, 0);
});

test("alumno mensual activo sin cargo del mes: se reporta sólo pasado el margen; una mensualidad que empieza el mes próximo no", () => {
  const late = buildConsistencyReport({ ...empty, students: [student("a")], charges: [], todayDateKey: "2026-10-28" });
  assert.deepEqual(counts(late), { monthly_student_without_current_charge: 1 });
  const early = buildConsistencyReport({ ...empty, students: [student("a")], charges: [], todayDateKey: "2026-10-02" });
  assert.equal(early.total, 0, "el día 2 todavía está dentro del margen de generación");
  const notStarted = buildConsistencyReport({ ...empty, students: [student("a", { billingPlan: { type: "monthly", amount: 50000, dueDay: 10, startPeriod: "2026-11" } })], charges: [] });
  assert.equal(notStarted.total, 0);
  const inactive = buildConsistencyReport({ ...empty, students: [student("a", { status: "inactivo", statusChangeDate: "2026-09-15" })], charges: [] });
  assert.equal(inactive.total, 0);
});

test("cargos mensuales repetidos, asignaciones huérfanas y pagos de un alumno inexistente se detectan", () => {
  const dup = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 50000), charge("c2", "a", "2026-10", 50000)] });
  assert.equal(counts(dup).duplicate_monthly_charge, 1);
  const orphan = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 50000)], payments: [pay("p9", "fantasma", 100)], allocations: [alloc("a1", "p-no-existe", "c1", "a", 100)] });
  assert.ok(counts(orphan).payment_without_student >= 1);
  assert.ok(counts(orphan).allocation_without_payment >= 1);
});

test("un cargo anulado no cuenta; más dinero asignado que el importe se detecta como saldo negativo", () => {
  const voided = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 50000, { voidedAt: "2026-10-03T10:00:00Z", voidReason: "error" }), charge("c2", "a", "2026-10", 50000)] });
  assert.equal(voided.total, 0, "el anulado no es un duplicado ni deuda");
  const over = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 50000)], payments: [pay("p1", "a", 60000)], allocations: [alloc("a1", "p1", "c1", "a", 60000)] });
  assert.equal(counts(over).negative_balance, 1);
});

test("el informe nunca incluye nombres, ids ni importes: sólo títulos, consejos y cantidades", () => {
  const view = buildConsistencyReport({ ...empty, students: [student("a")], charges: [charge("c1", "a", "2026-10", 45000)] });
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /Nombre Secreto|45000|c1|"a"/);
  for (const message of Object.values(CONSISTENCY_MESSAGES)) {
    assert.ok(message.title.length > 5 && message.advice.length > 5);
    assert.doesNotMatch(message.title + message.advice, /\$|[0-9a-f]{8}-/);
  }
});

test("cableado: la pantalla sólo lee, no ofrece repararlas, y se llega desde Configuración", () => {
  const page = read("app/(app)/configuracion/consistencia/page.tsx");
  assert.match(page, /buildConsistencyReport\(/);
  assert.doesNotMatch(page, /use server|Action\b|\.rpc\(|\.insert\(|\.update\(|\.delete\(|Reparar/);
  assert.match(read("components/account/configuration-view.tsx"), /href="\/configuracion\/consistencia"/);
  assert.match(read("lib/repositories/proration-decisions.ts"), /readTable/);
  assert.doesNotMatch(read("lib/repositories/proration-decisions.ts"), /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
