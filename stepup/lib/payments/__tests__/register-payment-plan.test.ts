import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAssignableDebt, planOldestFirstAllocation } from "../register-payment-plan.ts";
import type { PaymentAllocationLike, PaymentChargeLike } from "../types.ts";

function charge(overrides: Partial<PaymentChargeLike> = {}): PaymentChargeLike {
  return { id: "c1", chargeType: "mensual", originalAmount: 30000, dueDate: "2026-09-10", voidedAt: null, ...overrides };
}

test("planOldestFirstAllocation: reparte empezando por la obligación de vencimiento MÁS ANTIGUO", () => {
  const charges = [
    charge({ id: "c-agosto", dueDate: "2026-08-10", originalAmount: 30000 }),
    charge({ id: "c-septiembre", dueDate: "2026-09-10", originalAmount: 30000 }),
  ];
  const plan = planOldestFirstAllocation({ amount: 40000, charges, allocations: [] });
  assert.deepEqual(plan, [
    { chargeId: "c-agosto", amount: 30000 },
    { chargeId: "c-septiembre", amount: 10000 },
  ]);
});

test("planOldestFirstAllocation: nunca asigna a un cargo anulado", () => {
  const charges = [charge({ id: "c-anulado", voidedAt: "2026-09-01T00:00:00Z", dueDate: "2026-08-01" }), charge({ id: "c-vigente", dueDate: "2026-09-10" })];
  const plan = planOldestFirstAllocation({ amount: 10000, charges, allocations: [] });
  assert.deepEqual(plan, [{ chargeId: "c-vigente", amount: 10000 }]);
});

test("planOldestFirstAllocation: rechaza la operación COMPLETA si el importe supera lo asignable (nunca saldo a favor)", () => {
  const charges = [charge({ id: "c1", originalAmount: 10000 })];
  assert.throws(() => planOldestFirstAllocation({ amount: 15000, charges, allocations: [] }), RangeError);
});

test("planOldestFirstAllocation: descuenta asignaciones ya vigentes antes de calcular capacidad", () => {
  const charges = [charge({ id: "c1", originalAmount: 30000 })];
  const allocations: PaymentAllocationLike[] = [{ chargeId: "c1", amount: 20000, paymentVoidedAt: null }];
  const plan = planOldestFirstAllocation({ amount: 10000, charges, allocations });
  assert.deepEqual(plan, [{ chargeId: "c1", amount: 10000 }]);
});

test("calculateAssignableDebt: suma la capacidad de TODAS las obligaciones vigentes del alumno", () => {
  const charges = [charge({ id: "c1", originalAmount: 30000 }), charge({ id: "c2", originalAmount: 20000 })];
  assert.equal(calculateAssignableDebt({ charges, allocations: [] }), 50000);
});
