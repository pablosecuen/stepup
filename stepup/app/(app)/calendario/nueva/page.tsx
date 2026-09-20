import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { ErrorState } from "@/components/ui/states";
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
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar el formulario. Volvé a intentarlo." />
      </div>
    );
  }

  // Nunca se ofrecen alumnos archivados como candidatos normales — mismo
  // criterio que el móvil.
  const activeStudents = students.filter((student) => student.status === "activo");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/calendario" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver al Calendario
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Nueva clase</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        {params.freedByLessonId
          ? "Este horario reemplaza una clase cancelada — el horario/duración/modalidad ya vienen completados."
          : "Elegí si es una clase única o una serie recurrente."}
      </p>

      <div className="mt-7">
        <NewLessonForm activeStudents={activeStudents} presetFromReplacement={params} />
      </div>
    </div>
  );
}
