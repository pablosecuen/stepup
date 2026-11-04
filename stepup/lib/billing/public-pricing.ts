import { listPublicPlans } from "./plans.ts";

/** Presentación por mes; el checkout cobra siempre el total del período. */
export function publicPricing() {
  const plans = listPublicPlans();
  const monthly = plans.find(plan => plan.monthsOfAccess === 1)!;
  return plans.map(plan => {
    const referenceMinor = monthly.amountMinor * plan.monthsOfAccess;
    return {
      ...plan,
      monthlyEquivalentPesos: Math.round(plan.amountMinor / plan.monthsOfAccess) / 100,
      savingPesos: (referenceMinor - plan.amountMinor) / 100,
      savingPercent: Math.round((referenceMinor - plan.amountMinor) * 100 / referenceMinor),
      referenceMonthlyPesos: monthly.amountPesos,
    };
  });
}
