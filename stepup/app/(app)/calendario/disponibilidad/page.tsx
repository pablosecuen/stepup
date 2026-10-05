import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { ErrorState } from "@/components/ui/states";
import { AvailabilityEditor } from "./availability-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disponibilidad · TeacherFlow" };

export default async function DisponibilidadPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  let availability;
  try {
    const ctx = await requireAuthenticatedDbContext();
    availability = await getTeacherAvailability(ctx);
  } catch {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar tu disponibilidad." />
        <Link href="/calendario/disponibilidad" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/calendario" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver al Calendario
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Disponibilidad</h1>
      <p className="mt-1.5 text-sm text-textMuted">Bloqueos semanales y excepciones (vacaciones, feriados) — se usan para avisar de conflictos al crear/reprogramar una clase.</p>

      <div className="mt-7">
        <AvailabilityEditor initial={availability} />
      </div>
    </div>
  );
}
