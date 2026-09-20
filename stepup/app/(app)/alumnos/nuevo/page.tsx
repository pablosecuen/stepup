import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { ErrorState } from "@/components/ui/states";
import { NewStudentForm } from "./new-student-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo alumno · TeacherFlow" };

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
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar el formulario. Volvé a intentarlo." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/alumnos" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Alumnos
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Nuevo alumno</h1>
      <p className="mt-1.5 text-sm text-textMuted">Completá los datos básicos — podés ajustar el resto después desde su ficha.</p>

      <div className="mt-7">
        <NewStudentForm customLevels={customLevels} />
      </div>
    </div>
  );
}
