import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, type AuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { ErrorState } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { type ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { StudentProfileView } from "@/components/students/profile/student-profile-view";
import { ProfileTabBody } from "@/components/students/profile/profile-tab-body";
import { ProfileTabSkeleton } from "@/components/nav/screen-skeleton";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { ReportCleanupTrigger } from "@/components/students/profile/report-cleanup-trigger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfil del alumno · TeacherFlow" };

const VALID_TABS: ProfileTabKey[] = ["resumen", "clases", "progreso", "tareas", "cobros", "reportes", "informacion"];

export default async function AlumnoProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: ProfileTabKey = VALID_TABS.includes(rawTab as ProfileTabKey) ? (rawTab as ProfileTabKey) : "resumen";

  let ctx: AuthenticatedDbContext;
  let student;
  try {
    ctx = await requireAuthenticatedDbContext();
    student = await getStudent(ctx, id);
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Perfil del alumno</PageTitle>
        <div className="mt-5">
          <ErrorState message="No pudimos cargar este alumno." />
        </div>
        <a href={`/alumnos/${id}`} className={`mt-3 ${buttonClass({ variant: "secondary" })}`}>
          Reintentar
        </a>
      </div>
    );
  }

  if (!student) notFound();

  // El encabezado y las pestañas salen apenas llega el alumno; el contenido de la pestaña carga en su propio límite (con `key`, así al cambiar de
  // pestaña se vuelve a mostrar el esqueleto SÓLO del cuerpo y el resto de la ficha queda quieto).
  return (
    <>
      {tab === "cobros" && <ChargeGenerationTrigger />}
      {tab === "reportes" && <ReportCleanupTrigger />}
      <StudentProfileView student={student} tab={tab}>
        <Suspense key={tab} fallback={<ProfileTabSkeleton tab={tab} />}>
          <ProfileTabBody ctx={ctx} student={student} tab={tab} />
        </Suspense>
      </StudentProfileView>
    </>
  );
}
