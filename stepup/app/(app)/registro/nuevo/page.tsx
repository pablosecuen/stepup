import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { FormPage } from "@/components/ui/form-page";
import { NuevoRegistroForm } from "./nuevo-registro-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clase no programada · TeacherFlow" };

/**
 * Registro de una clase SIN reserva previa de Calendario — puerto real de
 * `NewClassScreen.tsx` (móvil). Sólo alumnos ACTIVOS son seleccionables,
 * mismo criterio que `StudentOrGroupPicker.tsx`.
 */
export default async function RegistroNuevoPage({ searchParams }: { searchParams: Promise<{ alumno?: string }> }) {
  const { alumno } = await searchParams;
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  let activeStudents: { id: string; name: string; level: string }[] = [];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [allStudents, excludedStudentIds] = await Promise.all([listStudents(ctx), loadExcludedStudentIds(ctx)]);
    const students = withoutExcludedStudents(allStudents, excludedStudentIds);
    activeStudents = students.filter((s) => s.status === "activo").map((s) => ({ id: s.id, name: s.name, level: s.levels[0] ?? "" }));
  } catch {
    return (
      <div className={PAGE_WIDTH.narrow}>
        <PageTitle>Clase no programada</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar los alumnos activos." />
          </div>
          <PrivateButtonLink href="/registro" variant="secondary">
            Volver
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  return (
    <FormPage
      backHref="/registro"
      backLabel="Volver a Clases por registrar"
      title="Clase no programada"
      subtitle="Para una clase que diste sin reservarla antes en el Calendario — nunca crea ninguna reserva, sólo el registro pedagógico."
    >
      <NuevoRegistroForm students={activeStudents} initialStudentId={activeStudents.some(s => s.id === alumno) ? alumno : undefined} />
    </FormPage>
  );
}
