import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH } from "@/components/ui/page-header";
import { AvailabilityEditor } from "./availability-editor";
import { AvailabilityHeader } from "./availability-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disponibilidad · TeacherFlow" };

export default async function DisponibilidadPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  let availability;
  try {
    const ctx = await requireAuthenticatedDbContext();
    availability = await getTeacherAvailability(ctx);
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
        <AvailabilityHeader />
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar tu disponibilidad." />
          </div>
          <PrivateButtonLink href="/calendario/disponibilidad" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  // Ancho de lista (el del Calendario): la pantalla usa el espacio útil del shell; cada bloque decide su propio ancho según su contenido.
  return (
    <div className={PAGE_WIDTH.wide}>
      <AvailabilityHeader subtitle="Bloqueos semanales y excepciones (vacaciones, feriados) — se usan para avisar de conflictos al crear/reprogramar una clase." />
      <div className="mt-6">
        <AvailabilityEditor initial={availability} />
      </div>
    </div>
  );
}
