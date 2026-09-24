import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { BudgetDistributionSettingsRow } from "@/lib/db/database.types";
import {
  DEFAULT_BUDGET_DISTRIBUTION_SETTINGS,
  normalizeBudgetDistribution,
  type BudgetDistributionSettings,
} from "@/lib/payments/budget-distribution";

/**
 * Repositorio de la preferencia 50/30/20 — una única fila por profesor
 * (`budget_distribution_settings.owner_id` es la PK, con
 * `check (needs+wants+savings = 100)` real en la base). La app SIEMPRE
 * normaliza con `normalizeBudgetDistribution` antes del round-trip — el
 * constraint de la base es el respaldo real, nunca la única defensa.
 */

function toRecord(row: BudgetDistributionSettingsRow): BudgetDistributionSettings {
  return {
    distribution: { needs: row.needs_percent, wants: row.wants_percent, savings: row.savings_percent },
    savingsGoal: {
      enabled: row.savings_goal_enabled,
      targetAmount: row.savings_goal_target_amount,
      targetDate: row.savings_goal_target_date,
    },
  };
}

export async function getBudgetDistributionSettings(ctx: AuthenticatedDbContext): Promise<BudgetDistributionSettings> {
  const { data, error } = await ctx.supabase
    .from("budget_distribution_settings")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_BUDGET_DISTRIBUTION_SETTINGS };
  return toRecord(data as BudgetDistributionSettingsRow);
}

export async function saveBudgetDistributionSettings(
  ctx: AuthenticatedDbContext,
  settings: BudgetDistributionSettings
): Promise<BudgetDistributionSettings> {
  const distribution = normalizeBudgetDistribution(settings.distribution);
  const { data, error } = await ctx.supabase
    .from("budget_distribution_settings")
    .upsert({
      owner_id: ctx.ownerId,
      needs_percent: distribution.needs,
      wants_percent: distribution.wants,
      savings_percent: distribution.savings,
      savings_goal_enabled: settings.savingsGoal.enabled,
      savings_goal_target_amount: settings.savingsGoal.targetAmount,
      savings_goal_target_date: settings.savingsGoal.targetDate,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toRecord(data as BudgetDistributionSettingsRow);
}
