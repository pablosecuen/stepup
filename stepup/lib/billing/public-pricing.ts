import { listPublicPlans } from "./plans.ts";

/** Referencia diaria de marketing; nunca determina el importe del checkout. */
export function publicPricing() {
  const plans = listPublicPlans();
  const monthly = plans.find(plan => plan.monthsOfAccess === 1)!;
  return plans.map(plan => {
    const days = plan.monthsOfAccess === 12 ? 365 : plan.monthsOfAccess * 30;
    const referenceMinor = monthly.amountMinor * plan.monthsOfAccess;
    return {
      ...plan,
      dailyPesos: Math.round(plan.amountMinor / days) / 100,
      monthlyEquivalentPesos: Math.round(plan.amountMinor / plan.monthsOfAccess) / 100,
      annualSavingPesos: plan.monthsOfAccess === 12 ? (referenceMinor - plan.amountMinor) / 100 : 0,
      annualReferencePesos: referenceMinor / 100,
    };
  });
}
