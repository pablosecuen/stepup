import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCoveredByTrainingPlan } from "../training-coverage.ts";
import { summarizeRegistrationCharge } from "../registration-charge-status.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("el cobro depende de la actividad: un entrenamiento con acuerdo mensual está cubierto; una clase, o un entrenamiento sin acuerdo, no", () => {
  assert.equal(isCoveredByTrainingPlan({ activityKind: "training", trainingBillingAgreementId: "a1" }), true);
  assert.equal(isCoveredByTrainingPlan({ activityKind: "class", trainingBillingAgreementId: "a1" }), false, "una clase nunca está cubierta por un entrenamiento");
  assert.equal(isCoveredByTrainingPlan({ activityKind: "training", trainingBillingAgreementId: null }), false, "sin acuerdo no se pierde el cobro");
  assert.equal(isCoveredByTrainingPlan({ activityKind: undefined, trainingBillingAgreementId: "a1" }), false);
});

test("situación real del cobro de UNA clase: pagada, parcial o pendiente con sus pagos; los pagos anulados y los de otra clase no cuentan", () => {
  const payments = new Map([["p1", { paidAt: "2026-10-20", voidedAt: null }], ["p2", { paidAt: "2026-10-21", voidedAt: null }], ["anulado", { paidAt: "2026-10-22", voidedAt: "2026-10-23T00:00:00Z" }]]);
  const pendiente = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [], payments });
  assert.deepEqual([pendiente.state, pendiente.paid, pendiente.balance], ["pendiente", 0, 27500]);
  const parcial = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [{ paymentId: "p1", amount: 10000 }, { paymentId: "anulado", amount: 17500 }], payments });
  assert.deepEqual([parcial.state, parcial.paid, parcial.balance], ["parcial", 10000, 17500], "el pago anulado no cuenta");
  const pagada = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [{ paymentId: "p2", amount: 17500 }, { paymentId: "p1", amount: 10000 }], payments });
  assert.deepEqual([pagada.state, pagada.balance], ["pagada", 0]);
  assert.deepEqual(pagada.payments.map((p) => p.paidAt), ["2026-10-20", "2026-10-21"], "del más viejo al más nuevo");
});

test("cableado: el cobro por clase usa la actividad (cubierto por la cuota mensual = sin cobro suelto) y la pantalla del registro muestra el cobro de ESA clase", () => {
  const action = read("lib/actions/lesson-registrations.ts");
  assert.match(action, /isCoveredByTrainingPlan\(\{ activityKind: detail\.registration\.activityKind, trainingBillingAgreementId: seriesRule\?\.trainingBillingAgreementId \?\? null, hasTrainingChargeForPeriod: studentsWithMonthlyTraining\.has\(studentId\) \}\)/);
  assert.match(action, /const amount = isCovered\(p\.studentId\) \? 0 : computePerClassBilledAmount\(/);
  assert.match(read("app/(app)/registro/[calendarLessonId]/page.tsx"), /<RegistrationChargeCard lines=\{chargeLines\} coveredByTrainingPlan=\{coveredByTrainingPlan\} \/>/);
  const repo = read("lib/repositories/payments.ts");
  const fn = repo.slice(repo.indexOf("export async function listChargeStatusForRegistration"), repo.indexOf("export async function listAllAllocations"));
  assert.match(fn, /eq\("saved_lesson_id", registrationId\)\.eq\("charge_type", "por_clase"\)\.is\("voided_at", null\)/, "sólo el cobro por clase de ESE registro");
});
