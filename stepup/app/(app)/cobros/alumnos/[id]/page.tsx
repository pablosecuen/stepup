import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { StudentProfileView } from "@/components/students/profile/student-profile-view";
import { ProfileTabBody } from "@/components/students/profile/profile-tab-body";
import { ProfileTabSkeleton } from "@/components/nav/screen-skeleton";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { ReportCleanupTrigger } from "@/components/students/profile/report-cleanup-trigger";
import type { ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobros del alumno · TeacherFlow" };
const TABS: readonly ProfileTabKey[] = ["resumen", "clases", "progreso", "tareas", "cobros", "reportes", "informacion"];

/** The same authenticated profile and payment controls, with an explicit Cobros navigation context. */
export default async function PaymentStudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab = TABS.includes(rawTab as ProfileTabKey) ? rawTab as ProfileTabKey : "cobros";
  const ctx = await requireAuthenticatedDbContext();
  const student = await getStudent(ctx, id);
  if (!student) notFound();
  return <>
    {tab === "cobros" && <ChargeGenerationTrigger />}
    {tab === "reportes" && <ReportCleanupTrigger />}
    <StudentProfileView student={student} tab={tab} fromPayments>
      <Suspense key={tab} fallback={<ProfileTabSkeleton tab={tab} />}>
        <ProfileTabBody ctx={ctx} student={student} tab={tab} fromPayments />
      </Suspense>
    </StudentProfileView>
  </>;
}
