import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadFinancialOverviewData } from "@/lib/dashboard/load-financial-overview";
import { FINANCIAL_PRESETS, FinancialOverviewErrorView, FinancialOverviewView } from "@/components/finance/financial-overview-view";
import type { FinancialPeriodPreset } from "@/lib/reports/period";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resumen financiero · TeacherFlow" };

export default async function ResumenFinancieroPage({ searchParams }: { searchParams: Promise<{ preset?: string; anio?: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const { preset: rawPreset, anio } = await searchParams;
  const preset: FinancialPeriodPreset = FINANCIAL_PRESETS.includes(rawPreset as FinancialPeriodPreset) ? (rawPreset as FinancialPeriodPreset) : "current_month";

  let data: Awaited<ReturnType<typeof loadFinancialOverviewData>>;
  try {
    const ctx = await requireAuthenticatedDbContext();
    data = await loadFinancialOverviewData(ctx, preset, anio);
  } catch {
    return <FinancialOverviewErrorView />;
  }

  return <FinancialOverviewView data={data} preset={preset} />;
}
