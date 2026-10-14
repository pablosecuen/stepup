import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listStudents } from "@/lib/repositories/students";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { SeriesListView } from "@/components/calendar/series-list-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Series · TeacherFlow" };

export default async function SeriesPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  let rules;
  let students;
  try {
    const ctx = await requireAuthenticatedDbContext();
    [rules, students] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx)]);
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Series</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar las series." />
          </div>
          <PrivateButtonLink href="/calendario/series" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  return <SeriesListView rules={rules} students={students} nowIso={new Date().toISOString()} />;
}
