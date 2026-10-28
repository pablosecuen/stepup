import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable } from "@/lib/db/read";
import type { DecisionLike } from "@/lib/payments/consistency";

interface DecisionRow {
  id: string;
  student_id: string;
  billing_period: string;
  effective_join_date: string;
  criterion: DecisionLike["criterion"];
  classes_remaining: number;
  classes_per_full_period: number;
  permanent_monthly_amount: number;
  charged_amount: number;
  charge_id: string | null;
  created_at: string;
  confirmed_at: string;
  source: "manual" | "automatic" | null;
}

/** Decisiones de primer mes proporcional ya confirmadas (se leen para no reportar como error un primer mes que difiere del plan a propósito). Sólo lectura. */
export async function listFirstMonthProrationDecisions(ctx: AuthenticatedDbContext): Promise<DecisionLike[]> {
  const rows = await readTable<DecisionRow>(ctx.supabase, "first_month_proration_decisions", {
    columns: "id, student_id, billing_period, effective_join_date, criterion, classes_remaining, classes_per_full_period, permanent_monthly_amount, charged_amount, charge_id, created_at, confirmed_at, source",
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  return rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    billingPeriod: row.billing_period,
    effectiveJoinDate: row.effective_join_date,
    criterion: row.criterion,
    classesRemaining: row.classes_remaining,
    classesPerFullPeriod: row.classes_per_full_period,
    permanentMonthlyAmount: Number(row.permanent_monthly_amount),
    chargedAmount: Number(row.charged_amount),
    chargeId: row.charge_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    ...(row.source ? { source: row.source } : {}),
  }));
}
