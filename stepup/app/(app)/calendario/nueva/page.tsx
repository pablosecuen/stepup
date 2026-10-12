import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { ErrorState } from "@/components/ui/states";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { FormPage } from "@/components/ui/form-page";
import { NewLessonForm } from "./new-lesson-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nueva clase · TeacherFlow" };

export default async function NuevaClasePage({
  searchParams,
}: {
  searchParams: Promise<{ freedByLessonId?: string; date?: string; hour?: string; minute?: string; duration?: string; modality?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }
  const params = await searchParams;

  let students;
  try {
    const ctx = await requireAuthenticatedDbContext();
    students = await listStudents(ctx);
  } catch {
    return (
      <div className={PAGE_WIDTH.narrow}>
        <PageTitle>Nueva clase</PageTitle>
        <div className="mt-5">
          <ErrorState message="No pudimos cargar el formulario. Volvé a intentarlo." />
        </div>
      </div>
    );
  }

  // Nunca se ofrecen alumnos archivados como candidatos normales — mismo
  // criterio que el móvil.
  const activeStudents = students.filter((student) => student.status === "activo");

  return (
    <FormPage
      backHref="/calendario"
      backLabel="Volver al Calendario"
      title="Nueva clase"
      subtitle={
        params.freedByLessonId
          ? "Este horario reemplaza una clase cancelada — el horario/duración/modalidad ya vienen completados."
          : "Elegí si es una clase única o una serie recurrente."
      }
    >
      <NewLessonForm activeStudents={activeStudents} presetFromReplacement={params} />
    </FormPage>
  );
}
