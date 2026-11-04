import { test } from "node:test";
import assert from "node:assert/strict";
import { publicPricing } from "../public-pricing.ts";
import { listPublicPlans } from "../plans.ts";

test("precios públicos: mensual comparable, total del período y ahorro calculados desde el catálogo", () => {
  const plans = publicPricing();
  assert.deepEqual(plans.map(p => p.amountMinor), listPublicPlans().map(p => p.amountMinor));
  assert.deepEqual(plans.map(p => p.monthlyEquivalentPesos), [25900, 23300, 21900, 19900]);
  assert.deepEqual(plans.map(p => p.savingPesos), [0, 7800, 24000, 72000]);
  assert.deepEqual(plans.map(p => p.savingPercent), [0, 10, 15, 23]);
  const annual = plans.find(p => p.monthsOfAccess === 12)!;
  assert.ok(annual.amountMinor < plans[0].amountMinor * 10, "12 meses cuestan menos que 10 pagos mensuales");
  assert.equal(annual.amountPesos, 238800);
  assert.equal(annual.savingPesos, 72000);
  assert.ok(plans.every(p => !("dailyPesos" in p)), "sin presentación por día");
});
