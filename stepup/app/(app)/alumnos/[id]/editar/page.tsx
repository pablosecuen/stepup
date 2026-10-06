import Link from "@/components/nav/private-link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { ErrorState } from "@/components/ui/states";
import { EditStudentForm } from "./edit-student-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar alumno · TeacherFlow" };

export default async function EditarAlumnoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
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
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar este alumno. Volvé a intentarlo." />
      </div>
    );
  }

  if (!student) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href={`/alumnos/${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-brandBlue hover:underline">
        ← Volver a la ficha
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Editar a {student.name}</h1>

      <div className="mt-7">
        <EditStudentForm student={student} customLevels={customLevels} />
      </div>
    </div>
  );
}
