import { planDuplicateMonthlyChargeRepair, planMonthlyAmountReconciliationRepair, planInactiveStudentIneligibleChargeRepair, planIncompatiblePerClassChargeRepair, planMonthlyDueDateRepair } from "./engine/features/payments/utils/financialReconciliation.ts";
import { DEFAULT_SURCHARGE_SETTINGS } from "./engine/features/payments/utils/surchargeSettings.ts";
import { buildFirstPeriodJoinDateByChargeId } from "./engine/features/payments/utils/firstPeriodDueDate.ts";
import { toEnginePaymentsState } from "../students/list-status.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "./billing-plan.ts";
import type { StudentBillingPlan as EnginePlan } from "./engine/features/student-profile/types/index.ts";
import type { buildConsistencyReport } from "./consistency.ts";

export interface FinancialRepairPatch {
  id: string; amount: number; dueDate: string; voidedAt: string | null; voidReason: string | null;
  reason: "duplicate" | "monthly_amount" | "inactive" | "monthly_coverage" | "first_due_date";
}

/** Los planificadores son los originales. La única exclusión adicional es el
 * entrenamiento: su cobertura pertenece al acuerdo propio, nunca al plan individual. */
export function buildFinancialRepairPlan(input: Parameters<typeof buildConsistencyReport>[0] & { trainingRegistrationIds: ReadonlySet<string>; nowIso: string }) {
  let state = toEnginePaymentsState(input);
  const patches = new Map<string, FinancialRepairPatch>();
  const plans = new Map(input.students.map(s => [s.id, resolveStudentBillingPlan({ billingPlan: s.billingPlan as StudentBillingPlan | null, billingType: s.billingType, price: s.price }) as EnginePlan]));
  const resolvePlan = (id: string) => {
    const p = plans.get(id);
    return p?.type === "monthly" && p.startPeriod && p.startPeriod > input.todayDateKey.slice(0, 7) ? null : p ?? null;
  };
  function apply(charges: typeof state.charges, reason: FinancialRepairPatch["reason"]) {
    const old = new Map(state.charges.map(c => [c.id, c]));
    for (const c of charges) {
      const before = old.get(c.id);
      if (before && (before.originalAmount !== c.originalAmount || before.dueDate !== c.dueDate || before.voidedAt !== c.voidedAt)) {
        // Toda asignación, incluso de un pago anulado, exige revisión humana.
        if (c.voidedAt && state.allocations.some(a => a.chargeId === c.id)) continue;
        patches.set(c.id, { id: c.id, amount: c.originalAmount, dueDate: c.dueDate, voidedAt: c.voidedAt, voidReason: c.voidReason, reason });
      }
    }
    state = { ...state, charges: state.charges.map(c => { const p = patches.get(c.id); return p ? { ...c, originalAmount: p.amount, dueDate: p.dueDate, voidedAt: p.voidedAt, voidReason: p.voidReason } : c; }) };
  }
  const duplicate = planDuplicateMonthlyChargeRepair({ state, voidedAt: input.nowIso });
  apply(duplicate.updatedCharges, "duplicate");
  const monthly = planMonthlyAmountReconciliationRepair({ state, students: [...input.students], resolvePlan, evaluationDate: input.todayDateKey, firstMonthProrationDecisions: [...input.decisions], surchargeSettings: DEFAULT_SURCHARGE_SETTINGS });
  apply(monthly.updatedCharges, "monthly_amount");
  const inactive = planInactiveStudentIneligibleChargeRepair({ state, students: [...input.students], voidedAt: input.nowIso });
  apply(inactive.updatedCharges, "inactive");
  const covered = planIncompatiblePerClassChargeRepair({ state: { ...state, charges: state.charges.filter(c => !c.savedLessonId || !input.trainingRegistrationIds.has(c.savedLessonId)) }, students: [...input.students], resolvePlan, evaluationDate: input.todayDateKey, voidedAt: input.nowIso });
  apply(covered.updatedCharges, "monthly_coverage");
  const due = planMonthlyDueDateRepair({ state, firstPeriodJoinDateByChargeId: buildFirstPeriodJoinDateByChargeId(input.decisions) });
  apply(due.updatedCharges, "first_due_date");
  return { patches: [...patches.values()], needsReview: duplicate.ambiguousGroups.length + monthly.needsReview.length + inactive.needsReview.length + covered.needsReview.length + due.reviewNeeded.length };
}
