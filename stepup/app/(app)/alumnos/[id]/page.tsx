import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listStatusHistory, listLevelHistory, listPriceHistory } from "@/lib/repositories/student-history";
import { ErrorState } from "@/components/ui/states";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { ChangeStatusForm } from "@/components/students/change-status-form";
import { ProfileTabsNav, type ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { ResumenTabContent } from "@/components/students/profile/resumen-tab";
import { InformacionTabContent } from "@/components/students/profile/informacion-tab";
import { PendingTabContent } from "@/components/students/profile/pending-tab";

export const dynamic = "force-dynamic";

const VALID_TABS: ProfileTabKey[] = ["resumen", "clases", "progreso", "tareas", "cobros", "reportes", "informacion"];

export default async function AlumnoProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: ProfileTabKey = VALID_TABS.includes(rawTab as ProfileTabKey) ? (rawTab as ProfileTabKey) : "resumen";

  let student;
  let statusHistory: Awaited<ReturnType<typeof listStatusHistory>> = [];
  let levelHistory: Awaited<ReturnType<typeof listLevelHistory>> = [];
  let priceHistory: Awaited<ReturnType<typeof listPriceHistory>> = [];
  try {
    const ctx = await requireAuthenticatedDbContext();
    student = await getStudent(ctx, id);
    if (student && tab === "informacion") {
      [statusHistory, levelHistory, priceHistory] = await Promise.all([
        listStatusHistory(ctx, id),
        listLevelHistory(ctx, id),
        listPriceHistory(ctx, id),
      ]);
    }
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar este alumno." />
        <a href={`/alumnos/${id}`} className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </a>
      </div>
    );
  }

  if (!student) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/alumnos" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Alumnos
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">{student.name}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StudentStatusBadge status={student.status} />
            <span className="text-sm text-textMuted">{student.levels.length > 0 ? student.levels.join(", ") : "Sin nivel"}</span>
          </div>
        </div>
        <Link
          href={`/alumnos/${id}/editar`}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-textPrimary shadow-card transition-colors duration-150 ease-premium hover:border-brandBlue/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          Editar alumno
        </Link>
      </div>

      <div className="mt-6">
        <ProfileTabsNav studentId={id} active={tab} />
      </div>

      <div className="mt-5">
        {tab === "resumen" && (
          <div className="flex flex-col gap-5">
            <ResumenTabContent student={student} />
            <ChangeStatusForm studentId={id} currentStatus={student.status} />
          </div>
        )}
        {tab === "clases" && <PendingTabContent title="Clases" dependsOn="Registro de clases (Fase 4)" />}
        {tab === "progreso" && <PendingTabContent title="Progreso" dependsOn="Registro de clases y evaluaciones (Fase 4)" />}
        {tab === "tareas" && <PendingTabContent title="Tareas" dependsOn="Registro de clases (Fase 4)" />}
        {tab === "cobros" && <PendingTabContent title="Cobros" dependsOn="el motor de cobros (Fase 5)" />}
        {tab === "reportes" && <PendingTabContent title="Reportes" dependsOn="Registro de clases y Cobros (Fases 4/5)" />}
        {tab === "informacion" && (
          <InformacionTabContent student={student} statusHistory={statusHistory} levelHistory={levelHistory} priceHistory={priceHistory} />
        )}
      </div>
    </div>
  );
}
