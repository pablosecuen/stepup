import { test } from "node:test";
import assert from "node:assert/strict";
import { publicPricing } from "../public-pricing.ts";
import { listPublicPlans } from "../plans.ts";

test("precios públicos: el total es siempre el del catálogo, el diario es sólo una referencia", () => {
  const plans = publicPricing();
  assert.deepEqual(plans.map(p => p.amountMinor), listPublicPlans().map(p => p.amountMinor));
  assert.deepEqual(plans.map(p => p.dailyPesos), [830, 776.67, 743.89, 682.19]);
  const annual = plans.find(p => p.monthsOfAccess === 12)!;
  assert.equal(annual.amountMinor, plans[0].amountMinor * 10, "12 meses por 10 es una oferta comprobable");
  assert.equal(annual.annualSavingPesos, 49800);
  assert.equal(annual.monthlyEquivalentPesos, 20750);
  assert.ok(plans.filter(p => p.monthsOfAccess !== 12).every(p => p.annualSavingPesos === 0));
});
