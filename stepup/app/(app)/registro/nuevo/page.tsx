import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { ErrorState } from "@/components/ui/states";
import { NuevoRegistroForm } from "./nuevo-registro-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clase no programada · TeacherFlow" };

/**
 * Registro de una clase SIN reserva previa de Calendario — puerto real de
 * `NewClassScreen.tsx` (móvil). Sólo alumnos ACTIVOS son seleccionables,
 * mismo criterio que `StudentOrGroupPicker.tsx`.
 */
export default async function RegistroNuevoPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let activeStudents: { id: string; name: string; level: string }[] = [];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const students = await listStudents(ctx);
    activeStudents = students.filter((s) => s.status === "activo").map((s) => ({ id: s.id, name: s.name, level: s.levels[0] ?? "" }));
  } catch {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar los alumnos activos." />
        <Link href="/registro" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/registro" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Clases por registrar
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Clase no programada</h1>
      <p className="mt-1.5 text-sm text-textMuted">
        Para una clase que diste sin reservarla antes en el Calendario — nunca crea ninguna reserva, sólo el registro pedagógico.
      </p>

      <div className="mt-6">
        <NuevoRegistroForm students={activeStudents} />
      </div>
    </div>
  );
}
