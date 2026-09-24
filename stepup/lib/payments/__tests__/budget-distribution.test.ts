import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUDGET_DISTRIBUTION,
  adjustNeeds,
  adjustSavings,
  adjustWants,
  normalizeBudgetDistribution,
  resetBudgetDistribution,
} from "../budget-distribution.ts";

function sum(d: { needs: number; wants: number; savings: number }): number {
  return d.needs + d.wants + d.savings;
}

test("normalizeBudgetDistribution: ya válida (suma 100) es idempotente", () => {
  const d = { needs: 50, wants: 30, savings: 20 };
  assert.deepEqual(normalizeBudgetDistribution(d), d);
  assert.deepEqual(normalizeBudgetDistribution(normalizeBudgetDistribution(d)), d);
});

test("normalizeBudgetDistribution: los tres en cero cae al default 50/30/20", () => {
  assert.deepEqual(normalizeBudgetDistribution({ needs: 0, wants: 0, savings: 0 }), DEFAULT_BUDGET_DISTRIBUTION);
});

test("normalizeBudgetDistribution: negativos se tratan como 0 antes de normalizar", () => {
  const result = normalizeBudgetDistribution({ needs: -10, wants: 30, savings: 20 });
  assert.equal(sum(result), 100);
  assert.equal(result.needs, 0);
});

test("normalizeBudgetDistribution: todos negativos (total <=0) cae al default", () => {
  assert.deepEqual(normalizeBudgetDistribution({ needs: -5, wants: -5, savings: -5 }), DEFAULT_BUDGET_DISTRIBUTION);
});

test("normalizeBudgetDistribution: NaN se sanea a 0", () => {
  const result = normalizeBudgetDistribution({ needs: Number.NaN, wants: 60, savings: 40 });
  assert.equal(sum(result), 100);
  assert.equal(result.needs, 0);
});

test("normalizeBudgetDistribution: decimales preservan proporción y suman exacto 100", () => {
  const result = normalizeBudgetDistribution({ needs: 33.3, wants: 33.3, savings: 33.4 });
  assert.equal(sum(result), 100);
  // Proporciones casi iguales -> los tres valores deben quedar muy cerca de 33/34.
  assert.ok(Math.abs(result.needs - result.wants) <= 1);
});

test("normalizeBudgetDistribution: suma > 100 se reescala manteniendo proporciones y suma exacto 100", () => {
  const result = normalizeBudgetDistribution({ needs: 500, wants: 300, savings: 200 });
  assert.deepEqual(result, DEFAULT_BUDGET_DISTRIBUTION);
});

test("normalizeBudgetDistribution: suma < 100 se reescala hacia arriba manteniendo suma exacto 100", () => {
  const result = normalizeBudgetDistribution({ needs: 5, wants: 3, savings: 2 });
  assert.deepEqual(result, DEFAULT_BUDGET_DISTRIBUTION);
});

test("normalizeBudgetDistribution: empate exacto de partes fraccionarias reparte sin perder ni ganar unidades", () => {
  // 1/3 cada uno -> fracciones idénticas (0.333... cada una) -> debe repartir
  // el leftover de forma determinística y seguir sumando 100.
  const result = normalizeBudgetDistribution({ needs: 1, wants: 1, savings: 1 });
  assert.equal(sum(result), 100);
});

test("normalizeBudgetDistribution: valores extremos (uno domina casi todo)", () => {
  const result = normalizeBudgetDistribution({ needs: 1_000_000, wants: 1, savings: 1 });
  assert.equal(sum(result), 100);
  assert.ok(result.needs >= 99);
});

test("normalizeBudgetDistribution: Infinity se sanea a 0 (no propaga NaN/Infinity al resultado)", () => {
  const result = normalizeBudgetDistribution({ needs: Number.POSITIVE_INFINITY, wants: 30, savings: 20 });
  assert.equal(sum(result), 100);
  assert.ok(Number.isFinite(result.needs));
});

test("adjustNeeds: mover Necesidades reparte el resto proporcionalmente y suma 100", () => {
  const result = adjustNeeds({ needs: 50, wants: 30, savings: 20 }, 80);
  assert.equal(sum(result), 100);
  assert.equal(result.needs, 80);
});

test("adjustNeeds: clampea fuera de rango [0,100]", () => {
  assert.equal(adjustNeeds({ needs: 50, wants: 30, savings: 20 }, 150).needs, 100);
  assert.equal(adjustNeeds({ needs: 50, wants: 30, savings: 20 }, -20).needs, 0);
});

test("adjustWants: Necesidades fija, Ahorro absorbe la diferencia, suma 100", () => {
  const result = adjustWants({ needs: 50, wants: 30, savings: 20 }, 10);
  assert.equal(result.needs, 50);
  assert.equal(result.wants, 10);
  assert.equal(sum(result), 100);
});

test("adjustSavings: reparte la diferencia en partes iguales entre Necesidades y Gustos, suma 100", () => {
  const result = adjustSavings({ needs: 50, wants: 30, savings: 20 }, 40);
  assert.equal(result.savings, 40);
  assert.equal(sum(result), 100);
});

test("adjustSavings: diferencia impar no pierde ni gana unidades (floor/ceil)", () => {
  const result = adjustSavings({ needs: 50, wants: 30, savings: 20 }, 21);
  assert.equal(sum(result), 100);
});

test("resetBudgetDistribution: siempre vuelve a 50/30/20", () => {
  assert.deepEqual(resetBudgetDistribution(), DEFAULT_BUDGET_DISTRIBUTION);
});
