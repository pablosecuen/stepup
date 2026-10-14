import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { ErrorState } from "@/components/ui/states";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { StudentFormPage } from "@/components/students/student-form-page";
import { EditStudentForm } from "./edit-student-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar alumno · TeacherFlow" };

export default async function EditarAlumnoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const { id } = await params;

  let student;
  let customLevels;
  try {
    const ctx = await requireAuthenticatedDbContext();
    // `getStudent` ya filtra por owner_id — un id ajeno o inexistente
    // devuelve `null` en ambos casos (nunca distingue "no existe" de "no
    // autorizado" en la respuesta, mismo criterio anti-enumeración que el
    // resto de la app), y acá se traduce a un 404 real.
    [student, customLevels] = await Promise.all([getStudent(ctx, id), listCustomLevels(ctx)]);
  } catch {
    return (
      <div className={PAGE_WIDTH.narrow}>
        <PageTitle>Editar alumno</PageTitle>
        <div className="mt-5">
          <ErrorState message="No pudimos cargar este alumno. Volvé a intentarlo." />
        </div>
      </div>
    );
  }

  if (!student) notFound();

  return (
    <StudentFormPage backHref={`/alumnos/${id}`} backLabel="Volver a la ficha" title={`Editar a ${student.name}`}>
      <EditStudentForm student={student} customLevels={customLevels} />
    </StudentFormPage>
  );
}
