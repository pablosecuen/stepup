import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFinancialPeriodRange, comparePeriodValues, previousComparableRange, dateKeyInRange } from "../period.ts";

test("resolveFinancialPeriodRange: current_month usa el mes real de evaluationDate", () => {
  assert.deepEqual(resolveFinancialPeriodRange("current_month", "2026-09-22"), { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" });
});

test("resolveFinancialPeriodRange: last_3_months incluye el mes actual como el más reciente de los 3", () => {
  assert.deepEqual(resolveFinancialPeriodRange("last_3_months", "2026-09-22"), { rangeStart: "2026-07-01", rangeEnd: "2026-09-30" });
});

test("resolveFinancialPeriodRange: last_6_months cruza diciembre/enero correctamente (evaluado en febrero)", () => {
  assert.deepEqual(resolveFinancialPeriodRange("last_6_months", "2026-02-15"), { rangeStart: "2025-09-01", rangeEnd: "2026-02-28" });
});

test("resolveFinancialPeriodRange: current_year / previous_year", () => {
  assert.deepEqual(resolveFinancialPeriodRange("current_year", "2026-09-22"), { rangeStart: "2026-01-01", rangeEnd: "2026-12-31" });
  assert.deepEqual(resolveFinancialPeriodRange("previous_year", "2026-09-22"), { rangeStart: "2025-01-01", rangeEnd: "2025-12-31" });
});

test("resolveFinancialPeriodRange: current_month en febrero de año bisiesto termina el 29", () => {
  assert.deepEqual(resolveFinancialPeriodRange("current_month", "2028-02-10"), { rangeStart: "2028-02-01", rangeEnd: "2028-02-29" });
});

test("resolveFinancialPeriodRange: current_month en febrero de año NO bisiesto termina el 28", () => {
  assert.deepEqual(resolveFinancialPeriodRange("current_month", "2026-02-10"), { rangeStart: "2026-02-01", rangeEnd: "2026-02-28" });
});

test("comparePeriodValues: período anterior en cero nunca divide por cero, percentChange null", () => {
  assert.deepEqual(comparePeriodValues(50000, 0), { current: 50000, previous: 0, percentChange: null });
});

test("comparePeriodValues: calcula el porcentaje real cuando el previo no es cero", () => {
  const result = comparePeriodValues(150000, 100000);
  assert.equal(result.percentChange, 50);
});

test("comparePeriodValues: ambos en cero -> percentChange null, nunca NaN", () => {
  assert.deepEqual(comparePeriodValues(0, 0), { current: 0, previous: 0, percentChange: null });
});

test("previousComparableRange: rango de igual duración, inmediatamente anterior — nunca 'el mes calendario anterior' a secas", () => {
  const range = { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" }; // 30 días
  assert.deepEqual(previousComparableRange(range), { rangeStart: "2026-08-02", rangeEnd: "2026-08-31" });
});

test("previousComparableRange: cruza diciembre/enero hacia atrás", () => {
  const range = { rangeStart: "2027-01-01", rangeEnd: "2027-01-05" };
  assert.deepEqual(previousComparableRange(range), { rangeStart: "2026-12-27", rangeEnd: "2026-12-31" });
});

test("dateKeyInRange: bordes inclusive", () => {
  assert.equal(dateKeyInRange("2026-09-01", "2026-09-01", "2026-09-30"), true);
  assert.equal(dateKeyInRange("2026-09-30", "2026-09-01", "2026-09-30"), true);
  assert.equal(dateKeyInRange("2026-10-01", "2026-09-01", "2026-09-30"), false);
});
