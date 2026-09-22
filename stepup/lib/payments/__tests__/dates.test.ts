import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingPeriodOfDateKey,
  clampDayToBillingPeriod,
  daysBetweenDateKeys,
  isValidBillingPeriod,
  lastDayOfBillingPeriod,
  nextBillingPeriod,
  nextBusinessDay,
  resolveMonthlyDueDate,
} from "../dates.ts";

test("lastDayOfBillingPeriod: respeta febrero y meses cortos/largos", () => {
  assert.equal(lastDayOfBillingPeriod("2026-02"), 28);
  assert.equal(lastDayOfBillingPeriod("2028-02"), 29); // bisiesto
  assert.equal(lastDayOfBillingPeriod("2026-04"), 30);
  assert.equal(lastDayOfBillingPeriod("2026-01"), 31);
});

test("isValidBillingPeriod: rechaza meses imposibles", () => {
  assert.equal(isValidBillingPeriod("2026-13"), false);
  assert.equal(isValidBillingPeriod("2026-00"), false);
  assert.equal(isValidBillingPeriod("2026-09"), true);
});

test("clampDayToBillingPeriod: día 31 en febrero se recorta al último día real", () => {
  assert.equal(clampDayToBillingPeriod(31, "2026-02"), 28);
  assert.equal(clampDayToBillingPeriod(10, "2026-09"), 10);
});

test("nextBusinessDay: corre fin de semana al lunes siguiente", () => {
  assert.equal(nextBusinessDay("2026-09-19"), "2026-09-21"); // sábado -> lunes
  assert.equal(nextBusinessDay("2026-09-20"), "2026-09-21"); // domingo -> lunes
  assert.equal(nextBusinessDay("2026-09-21"), "2026-09-21"); // lunes ya hábil
});

test("resolveMonthlyDueDate: día configurado + corrimiento de fin de semana", () => {
  assert.equal(resolveMonthlyDueDate("2026-09", 10), "2026-09-10"); // jueves, hábil
  assert.equal(resolveMonthlyDueDate("2026-08", 1), "2026-08-03"); // 1/8/2026 es sábado -> lunes 3
});

test("nextBillingPeriod: cruza diciembre -> enero", () => {
  assert.equal(nextBillingPeriod("2026-12"), "2027-01");
  assert.equal(nextBillingPeriod("2026-09"), "2026-10");
});

test("billingPeriodOfDateKey / daysBetweenDateKeys", () => {
  assert.equal(billingPeriodOfDateKey("2026-09-23"), "2026-09");
  assert.equal(daysBetweenDateKeys("2026-09-01", "2026-09-10"), 9);
  assert.equal(daysBetweenDateKeys("2026-09-10", "2026-09-01"), -9);
});
