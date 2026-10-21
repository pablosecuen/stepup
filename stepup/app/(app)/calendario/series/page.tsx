import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedRules, withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
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
    const [allRules, allStudents, excludedStudentIds] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx), loadExcludedStudentIds(ctx)]);
    // Datos de prueba ocultos (R16): sólo se oculta una serie cuando TODOS sus participantes son de prueba.
    rules = withoutExcludedRules(allRules, excludedStudentIds);
    students = withoutExcludedStudents(allStudents, excludedStudentIds);
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
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
