"use server";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { financialRepairPlan, reconcileFinancialFacts } from "@/lib/repositories/financial-reconciliation";
import { actionErrorMessage } from "@/lib/errors/action-error";

export async function previewFinancialRepairsAction() {
  try { const plan = await financialRepairPlan(await requireAuthenticatedDbContext()); return { count: plan.patches.length, needsReview: plan.needsReview }; }
  catch (error) { return { error: actionErrorMessage("financial-repair-preview", error) }; }
}
export async function repairFinancialConsistencyAction(): Promise<{ error?: string; repaired?: number; needsReview?: number }> {
  try {
    const result = await reconcileFinancialFacts(await requireAuthenticatedDbContext());
    for (const path of ["/inicio", "/cobros", "/alumnos", "/resumen-financiero", "/configuracion/consistencia"]) revalidatePath(path);
    return result;
  } catch (error) { return { error: actionErrorMessage("financial-repair", error) }; }
}
