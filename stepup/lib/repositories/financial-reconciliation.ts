import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { StudentRow, PaymentChargeRow, PaymentRow, PaymentAllocationRow } from "@/lib/db/database.types";
import { toStudentRecord } from "@/lib/repositories/students-mapping";
import { toPaymentChargeRecord, toPaymentRecord, toPaymentAllocationRecord } from "@/lib/repositories/payments-mapping";
import type { DecisionLike } from "@/lib/payments/consistency";
import { buildFinancialRepairPlan } from "@/lib/payments/reconciliation";
import { todayInArgentina } from "@/lib/format/date-format";

type DecisionRow = { id: string; student_id: string; billing_period: string; effective_join_date: string; criterion: DecisionLike["criterion"]; classes_remaining: number; classes_per_full_period: number; permanent_monthly_amount: number; charged_amount: number; charge_id: string | null; created_at: string; confirmed_at: string };
interface Snapshot {
  token: string; students: StudentRow[]; payment_charges: PaymentChargeRow[]; payments: PaymentRow[]; payment_allocations: PaymentAllocationRow[];
  first_month_proration_decisions: DecisionRow[]; lesson_registrations: { id: string; activity_kind: string }[];
}

export async function financialRepairPlan(ctx: AuthenticatedDbContext) {
  const { data, error } = await ctx.supabase.rpc("financial_reconciliation_snapshot");
  if (error) throw error;
  const snapshot = data as Snapshot;
  const decisions: DecisionLike[] = snapshot.first_month_proration_decisions.map(d => ({ id: d.id, studentId: d.student_id, billingPeriod: d.billing_period, effectiveJoinDate: d.effective_join_date, criterion: d.criterion, classesRemaining: d.classes_remaining, classesPerFullPeriod: d.classes_per_full_period, permanentMonthlyAmount: Number(d.permanent_monthly_amount), chargedAmount: Number(d.charged_amount), chargeId: d.charge_id, createdAt: d.created_at, confirmedAt: d.confirmed_at }));
  return { token: snapshot.token, ...buildFinancialRepairPlan({
    students: snapshot.students.map(toStudentRecord), charges: snapshot.payment_charges.map(toPaymentChargeRecord),
    payments: snapshot.payments.map(toPaymentRecord), allocations: snapshot.payment_allocations.map(toPaymentAllocationRecord),
    decisions, todayDateKey: todayInArgentina(), nowIso: new Date().toISOString(),
    trainingRegistrationIds: new Set(snapshot.lesson_registrations.filter(r => r.activity_kind === "training").map(r => r.id)),
  }) };
}

export async function reconcileFinancialFacts(ctx: AuthenticatedDbContext) {
  const plan = await financialRepairPlan(ctx);
  if (!plan.patches.length) return { repaired: 0, needsReview: plan.needsReview };
  const { data, error } = await ctx.supabase.rpc("apply_financial_reconciliation", { p_token: plan.token, p_patches: plan.patches });
  if (error) throw error;
  return { repaired: Number(data), needsReview: plan.needsReview };
}
