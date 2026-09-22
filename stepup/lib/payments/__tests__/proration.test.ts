import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProportionalAmount, resolveFirstMonthChargeAmount, type FirstMonthProrationSuggestion } from "../proration.ts";

test("computeProportionalAmount: escalón fijo por CANTIDAD de ocurrencias restantes", () => {
  assert.equal(computeProportionalAmount(80000, 0, 4), 0);
  assert.equal(computeProportionalAmount(80000, 1, 4), 20000); // valor de UNA clase
  assert.equal(computeProportionalAmount(80000, 2, 4), 40000); // 50% exacto
  assert.equal(computeProportionalAmount(80000, 3, 4), 80000); // cuota completa
  assert.equal(computeProportionalAmount(80000, 5, 4), 80000); // nunca supera la cuota completa
});

test("computeProportionalAmount: caso real del commit móvil 2ae2994 — serie semanal, entrenamiento empieza el 19/09", () => {
  // cuota $80.000, queda 1 ocurrencia real en el período -> $80.000/4 = $20.000 (equivalente al caso citado con $40.000/2 clases habituales semanales -> escalado a 4 clases/mes reales: 1 restante -> valor de una clase).
  assert.equal(computeProportionalAmount(80000, 1, 4), 20000);
});

test("computeProportionalAmount: classesPerFullPeriod 0 nunca divide por cero", () => {
  assert.equal(computeProportionalAmount(50000, 0, 0), 0);
});

function suggestion(overrides: Partial<FirstMonthProrationSuggestion> = {}): FirstMonthProrationSuggestion {
  return {
    billingPeriod: "2026-09",
    effectiveJoinDate: "2026-09-19",
    classesRemaining: 1,
    classesPerFullPeriod: 4,
    permanentMonthlyAmount: 80000,
    proportionalAmount: 20000,
    ...overrides,
  };
}

test("resolveFirstMonthChargeAmount: 'proportional'/'full'/'no_charge'", () => {
  assert.equal(resolveFirstMonthChargeAmount(suggestion(), "proportional"), 20000);
  assert.equal(resolveFirstMonthChargeAmount(suggestion(), "full"), 80000);
  assert.equal(resolveFirstMonthChargeAmount(suggestion(), "no_charge"), 0);
});

test("resolveFirstMonthChargeAmount: 'custom' exige un importe positivo", () => {
  assert.equal(resolveFirstMonthChargeAmount(suggestion(), "custom", 15000), 15000);
  assert.throws(() => resolveFirstMonthChargeAmount(suggestion(), "custom", -1), RangeError);
  assert.throws(() => resolveFirstMonthChargeAmount(suggestion(), "custom", undefined), RangeError);
});
