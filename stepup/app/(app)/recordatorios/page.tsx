import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadHomeData } from "@/lib/dashboard/load-home-data";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { RemindersErrorView, RemindersView } from "@/components/reminders/reminders-view";
import type { RemindersCenterSummary } from "@/lib/dashboard/reminders-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordatorios · TeacherFlow" };

export default async function RecordatoriosPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let summary: RemindersCenterSummary;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const data = await loadHomeData(ctx);
    summary = data.remindersSummary;
  } catch {
    return <RemindersErrorView />;
  }

  return (
    <>
      <ChargeGenerationTrigger />
      <RemindersView summary={summary} />
    </>
  );
}
