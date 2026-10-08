import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { ErrorState } from "@/components/ui/states";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { StudentFormPage } from "@/components/students/student-form-page";
import { NewStudentForm } from "./new-student-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo alumno · TeacherFlow" };

/**
 * CARGA DE SÓLO LECTURA: abrir, recargar o precargar esta página nunca escribe nada (hasta 2026-10-05 reclamaba un borrador
 * `student_creation_claims` en el GET y redirigía a `?draft=`, dejando filas huérfanas por cada visita).
 * La identidad de la operación de alta (`operationId`) la genera el NAVEGADOR una vez por borrador (sessionStorage, mismo
 * patrón que Calendario) y viaja al enviar; el claim nace recién entonces, dentro de la RPC atómica
 * `create_student_with_operation`. Un `?draft=` viejo (pestañas abiertas con la versión anterior) simplemente se ignora.
 */
export default async function NuevoAlumnoPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let customLevels;
  try {
    const ctx = await requireAuthenticatedDbContext();
    customLevels = await listCustomLevels(ctx);
  } catch {
    return (
      <div className={PAGE_WIDTH.narrow}>
        <PageTitle>Nuevo alumno</PageTitle>
        <div className="mt-5">
          <ErrorState message="No pudimos cargar el formulario. Volvé a intentarlo." />
        </div>
      </div>
    );
  }

  return (
    <StudentFormPage backHref="/alumnos" backLabel="Volver a Alumnos" title="Nuevo alumno" subtitle="Completá los datos básicos — podés ajustar el resto después desde su ficha.">
      <NewStudentForm customLevels={customLevels} />
    </StudentFormPage>
  );
}
