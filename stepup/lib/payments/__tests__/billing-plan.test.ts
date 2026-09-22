import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveMonthlyAmount, resolveStudentBillingPlan, type MonthlyBillingPlan } from "../billing-plan.ts";

test("resolveStudentBillingPlan: sin billingPlan explícito, deriva de billingType/price", () => {
  assert.deepEqual(resolveStudentBillingPlan({ billingPlan: null, billingType: "mensual", price: 25000 }), {
    type: "monthly",
    amount: 25000,
    dueDay: 10,
  });
  assert.deepEqual(resolveStudentBillingPlan({ billingPlan: null, billingType: "por_clase", price: 5000 }), {
    type: "per_class",
    amount: 5000,
  });
});

test("resolveStudentBillingPlan: billingPlan explícito siempre gana", () => {
  const plan: MonthlyBillingPlan = { type: "monthly", amount: 30000, dueDay: 5 };
  assert.deepEqual(resolveStudentBillingPlan({ billingPlan: plan, billingType: "por_clase", price: 999 }), plan);
});

test("resolveEffectiveMonthlyAmount: sin cambio pendiente devuelve el importe vigente", () => {
  const plan: MonthlyBillingPlan = { type: "monthly", amount: 30000, dueDay: 10 };
  assert.equal(resolveEffectiveMonthlyAmount(plan, "2026-09"), 30000);
});

test("resolveEffectiveMonthlyAmount: cambio 'desde el próximo mes' no altera el período actual ni los anteriores", () => {
  const plan: MonthlyBillingPlan = {
    type: "monthly",
    amount: 30000,
    dueDay: 10,
    pendingAmount: 35000,
    pendingAmountEffectiveFrom: "2026-10",
  };
  assert.equal(resolveEffectiveMonthlyAmount(plan, "2026-09"), 30000);
  assert.equal(resolveEffectiveMonthlyAmount(plan, "2026-10"), 35000);
  assert.equal(resolveEffectiveMonthlyAmount(plan, "2026-11"), 35000);
});
